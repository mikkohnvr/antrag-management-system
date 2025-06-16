require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const uuid = require('uuid');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const lifeTimeUUID = uuid.v4();


// In-Memory Datenbank
let antraege = [];
let currentSlideId = null;
let port = 3000;
const adminCredentials = { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD};

// WebSocket Server
wss.on('connection', (ws) => {
    let isAuthenticated = false;

    ws.send(JSON.stringify({
        type: 'INIT',
        antraege,
        currentSlideId
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch(data.type) {
                case 'AUTHENTICATE':
                    if (data.username === adminCredentials.username &&
                        data.password === adminCredentials.password) {
                        isAuthenticated = true;
                        ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', uuid: lifeTimeUUID}));
                    } else {
                        ws.send(JSON.stringify({ type: 'AUTH_FAILED' }));
                    }
                    break;

                case 'COOKIE_CHECK':
                    if(data.uuid === lifeTimeUUID) {
                        isAuthenticated = true;
                        ws.send(JSON.stringify({ type: 'COOKIE_SUCCESS'}));
                    } else {
                        ws.send(JSON.stringify({ type: 'COOKIE_FAILED' }));
                    }
                    break;

                case 'CHANGE_SLIDE':
                    if (antraege.some(a => a.id === data.slideId)) {
                        currentSlideId = data.slideId;
                        broadcast({ type: 'SLIDE_CHANGED', slideId: currentSlideId });
                    }
                    break;

                case 'CREATE_ANTRAG':
                    if (!isAuthenticated || !data.antrag) break;

                    const newId = antraege.length > 0 ? Math.max(...antraege.map(a => a.id)) + 1 : 1;
                    const newAntrag = { ...data.antrag, id: newId };
                    antraege.push(newAntrag);

                    broadcast({ type: 'ANTRAG_ADDED', antrag: newAntrag });
                    break;

                case 'DELETE_ANTRAG':
                    if (!isAuthenticated) break;

                    const index = antraege.findIndex(a => a.id === data.antragId);
                    if (index !== -1) {
                        antraege.splice(index, 1);
                        broadcast({ type: 'ANTRAG_DELETED', antragId: data.antragId });
                    }
                    break;

                case 'EXPORT_REQUEST':
                    if (!isAuthenticated) break;
                    ws.send(JSON.stringify({
                        type: 'EXPORT_DATA',
                        data: antraege,
                        filename: `antraege_${new Date().toISOString().slice(0,10)}.json`
                    }));
                    break;

                case 'MOVE_ANTRAG_UP':
                    const antragID = data.antragId;
                    if(antragID == 1) { break; }
                    antraege = swapAndSortById(antraege, antragID, antragID-1);
                    broadcast({ 
                        type: 'INIT', 
                        antraege, 
                        currentSlideId 
                    });
                    break;
                
                case 'MOVE_ANTRAG_DOWN':
                    const downAntragID = data.antragId;
                    // Find highest current ID to prevent moving the last item down
                    const maxId = Math.max(...antraege.map(a => a.id));
                    if(downAntragID === maxId) { 
                        break; 
                    }
                    antraege = swapAndSortById(antraege, downAntragID, downAntragID + 1);
                    broadcast({ 
                        type: 'INIT', 
                        antraege, 
                        currentSlideId 
                    });
                    break;

                case 'IMPORT_DATA':
                    if (!isAuthenticated || !data.data) break;
                    try {
                        const importedData = data.data;
                        if (!Array.isArray(importedData)) {
                            throw new Error('Invalid data format');
                        }

                        // Validate each antrag
                        const isValid = importedData.every(antrag => 
                            antrag.id && antrag.titel && antrag.beschreibung && antrag.empfehlung
                        );

                        if (!isValid) {
                            throw new Error('Invalid antrag structure');
                        }

                        antraege = importedData;
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
                    break;
            }
        } catch (e) {
            console.error('Fehler:', e);
        }
    });
});

function swapAndSortById(antraegeArray, id1, id2) {

    const antrag1 = antraegeArray.find(a => a.id === id1);
    const antrag2 = antraegeArray.find(a => a.id === id2);

    if (!antrag1 || !antrag2) return antraegeArray;
    [antrag1.id, antrag2.id] = [antrag2.id, antrag1.id];
    return [...antraegeArray].sort((a, b) => a.id - b.id);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Statische Dateien servieren
app.use(express.static('public'));

server.listen(port, '0.0.0.0', () => {
    console.log('Server läuft auf http://<Ihre-IP>:'+port);
});