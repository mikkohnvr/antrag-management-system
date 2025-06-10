const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-Memory Datenbank
let antraege = [];
let currentSlideId = null;
const adminCredentials = { username: 'admin', password: 'partei2025' };

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
                        ws.send(JSON.stringify({ type: 'AUTH_SUCCESS' }));
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
            }
        } catch (e) {
            console.error('Fehler:', e);
        }
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Statische Dateien servieren
app.use(express.static('public'));

server.listen(3000, '0.0.0.0', () => {
    console.log('Server läuft auf http://<Ihre-IP>:3000');
});