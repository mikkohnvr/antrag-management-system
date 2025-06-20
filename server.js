process.env.EXPRESS_PATH_TO_REGEXP = '0'; // Workaround for path-to-regexp issue
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const uuid = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const port = process.env.PORT || 3000;
const publicDir = path.resolve(__dirname, 'public');
//const lifeTimeUUID = uuid.v4();
const lifeTimeUUID = 'asdf'
const adminCredentials = {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD
};

// Debugging - Verify directory structure
console.log('=== Server Startup ===');
console.log('Public Directory:', publicDir);
console.log('Directory exists:', fs.existsSync(publicDir));
if (fs.existsSync(publicDir)) {
    console.log('Directory content:');
    const listFiles = (dir, indent = '') => {
        fs.readdirSync(dir).forEach(file => {
            const fullPath = path.join(dir, file);
            console.log(indent + '-', file);
            if (fs.statSync(fullPath).isDirectory()) {
                listFiles(fullPath, indent + '  ');
            }
        });
    };
    listFiles(publicDir);
}

// Enhanced static file serving with proper MIME types
app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
        // Set proper caching headers
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

// Application state
let antraege = [];
let currentSlideId = null;

// WebSocket Server
wss.on('connection', (ws) => {
    ws.isAuthenticated = false;

    // Send initial state
    ws.send(JSON.stringify({
        type: 'INIT',
        antraege: removeEilAntraege(antraege),
        currentSlideId: currentSlideId
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Authentication handling
            if (data.type === 'AUTHENTICATE') {
                if (data.username === adminCredentials.username &&
                    data.password === adminCredentials.password) {
                    ws.isAuthenticated = true;
                    ws.send(JSON.stringify({
                        type: 'AUTH_SUCCESS',
                        uuid: lifeTimeUUID
                    }));
                     ws.send(JSON.stringify({
                        type: 'INIT',
                        antraege: antraege,
                        currentSlideId: currentSlideId
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'AUTH_FAILED' }));
                }
                return;
            }

            // Cookie check
            if (data.type === 'COOKIE_CHECK') {
                if (data.uuid === lifeTimeUUID) {
                    ws.isAuthenticated = true;
                    ws.send(JSON.stringify({ type: 'COOKIE_SUCCESS' }));
                    ws.send(JSON.stringify({
                        type: 'INIT',
                        antraege: antraege,
                        currentSlideId: currentSlideId
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'COOKIE_FAILED' }));
                }
                return;
            }

            // Only authenticated users can perform actions
            if (!ws.isAuthenticated) {
                return ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: 'Not authenticated'
                }));
            }

            // Handle different message types
            switch(data.type) {
                case 'CHANGE_SLIDE':
                    if (antraege.some(a => a.id === data.slideId)) {
                        currentSlideId = data.slideId;
                        antrag = antraege.find(antrag => antrag.id === data.slideId)
                        if (antrag.eilAntrag) {
                            broadcast({ type: 'ANTRAG_ADDED', antrag: antrag });
                        }
                        broadcast({ type: 'SLIDE_CHANGED', slideId: currentSlideId });
                    }
                    break;

                case 'CREATE_ANTRAG':
                    if (!data.antrag) break;
                    const newAntrag = {
                        ...data.antrag,
                        id: antraege.length > 0 ? Math.max(...antraege.map(a => a.id)) + 1 : 1,
                        antragsteller: data.antrag.antragsteller || '',
                        links: data.antrag.links || []
                    };
                    antraege.push(newAntrag);
                    if (newAntrag.eilAntrag) {
                        broadcastAuth({ type: 'ANTRAG_ADDED', antrag: newAntrag });
                    } else {
                        broadcast({ type: 'ANTRAG_ADDED', antrag: newAntrag });
                    }
                    
                    break;

                case 'DELETE_ANTRAG':
                    antraege = antraege.filter(a => a.id !== data.antragId);
                    broadcast({ type: 'ANTRAG_DELETED', antragId: data.antragId });
                    break;

                case 'EXPORT_REQUEST':
                    ws.send(JSON.stringify({
                        type: 'EXPORT_DATA',
                        data: antraege,
                        filename: `antraege_${new Date().toISOString().slice(0,10)}.json`
                    }));
                    break;

                case 'MOVE_ANTRAG_UP':
                case 'MOVE_ANTRAG_DOWN':
                    handleMoveAntrag(data.antragId, data.type);
                    break;

                case 'IMPORT_DATA':
                    handleImportData(ws, data.data);
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: 'Unknown command type'
                    }));
            }
        } catch (err) {
            console.error('Error processing message:', err);
            ws.send(JSON.stringify({
                type: 'ERROR',
                message: 'Invalid message format'
            }));
        }
    });

   
});

function handleMoveAntrag(antragId, direction) {
    const index = antraege.findIndex(a => a.id === antragId);
    if (index === -1) return;

    const newIndex = direction === 'MOVE_ANTRAG_UP' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= antraege.length) return;

    [antraege[index].id, antraege[newIndex].id] = [antraege[newIndex].id, antraege[index].id];
    antraege.sort((a, b) => a.id - b.id);
    broadcast({
        type: 'INIT',
        antraege,
        currentSlideId
    });
}

function handleImportData(ws, data) {
    try {
        if (!Array.isArray(data)) throw new Error('Invalid data format');

        const isValid = data.every(antrag =>
            antrag.id && antrag.titel && antrag.beschreibung && antrag.empfehlung && antrag.eilAntrag &&
            typeof antrag.antragsteller === 'string' &&
            Array.isArray(antrag.links)
        );

        if (!isValid) throw new Error('Invalid antrag structure');

        antraege = data;
        currentSlideId = null;
        broadcast({
            type: 'INIT',
            antraege,
            currentSlideId
        });
        ws.send(JSON.stringify({ type: 'IMPORT_SUCCESS' }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'IMPORT_ERROR',
            message: error.message
        }));
    }
}

function removeEilAntraege(antraege) {
    return antraege.filter(antrag => 
        !antrag.eilAntrag || antrag.id === currentSlideId
    );
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastAuth(data) {
    wss.clients.forEach(client => {
        if (
            client.readyState === WebSocket.OPEN &&
            client.isAuthenticated
        ) {
            client.send(JSON.stringify(data));
        }
    });
}

// SPA Fallback Route - Using regex to avoid path-to-regexp issues
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
    });
});

// Error Handling
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).send('Internal Server Error');
});

// Start Server
server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
    console.log('WebSocket server ready');
    console.log('Static files served from:', publicDir);
});