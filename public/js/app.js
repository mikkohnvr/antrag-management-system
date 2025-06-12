// WebSocket-Verbindung und State Management
    let socket;
    let antraege = [];
    let currentSlideId = null;
    let isAdmin = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    // DOM Elements
    const pages = {
        antraege: document.getElementById('page-antraege'),
        live: document.getElementById('page-live'),
        admin: document.getElementById('page-admin')
    };

    const navLinks = {
        antraege: document.getElementById('nav-antraege'),
        live: document.getElementById('nav-live'),
        admin: document.getElementById('nav-admin')
    };

    const loginModal = document.getElementById('login-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const loginSubmitBtn = document.getElementById('login-submit');
    const connectionPopup = document.getElementById('connection-lost-popup');
    const reconnectAttemptElement = document.getElementById('reconnect-attempt');
    const maxReconnectElement = document.getElementById('max-reconnect');
    const reloadPageButton = document.getElementById('reload-page');

    // WebSocket Initialisierung
    function initWebSocket() {
        // Anpassen der WebSocket-URL an Ihren Server
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = `${protocol}${window.location.hostname}:3000`;

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('Mit Server verbunden');
            reconnectAttempts = 0;
            connectionPopup.classList.add('hidden');

            // Initiale Daten anfordern
            if (isAdmin) {
                socket.send(JSON.stringify({ type: 'REQUEST_INIT', isAdmin: true }));
            } else {
                socket.send(JSON.stringify({ type: 'REQUEST_INIT' }));
            }

            const sessionToken = getCookie('sessionToken');
        
            if (sessionToken) {
                // Validate token with server
                socket.send(JSON.stringify({ 
                    type: 'COOKIE_CHECK',
                    uuid: sessionToken 
                }));
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (e) {
                console.error('Fehler beim Parsen der Server-Nachricht:', e);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket Fehler:', error);
        };

        socket.onclose = (event) => {
            console.log(`Verbindung getrennt (Code: ${event.code}, Grund: ${event.reason || 'Unbekannt'})`);
            connectionPopup.classList.remove('hidden');
            reconnectAttemptElement.textContent = reconnectAttempts;
            maxReconnectElement.textContent = maxReconnectAttempts;

            if (reconnectAttempts < maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // Exponentielles Backoff
                console.log(`Versuche erneut in ${delay}ms...`);

                setTimeout(() => {
                    reconnectAttempts++;
                    initWebSocket();
                }, delay);
            } else {
                  document.querySelector('.connection-popup-content p').textContent = 'Failed to reconnect. Please reload the page.';
            }
        };
    }

    // Server-Nachrichten verarbeiten
    function handleServerMessage(data) {
        switch(data.type) {
            case 'INIT':
                antraege = data.antraege || [];
                currentSlideId = data.currentSlideId || null;

                renderAntragsliste();
                renderAdminAntragsliste();

                if (currentSlideId && !pages.live.classList.contains('hidden')) {
                    showAntragAsSlide(currentSlideId, false); // Kein Broadcast
                }
                break;

            case 'SLIDE_CHANGED':
                currentSlideId = data.slideId;
                if (!pages.live.classList.contains('hidden')) {
                    showAntragAsSlide(currentSlideId, false); // Kein Broadcast
                }
                break;

            case 'ANTRAG_ADDED':
                // Vermeide Duplikate
                if (!antraege.some(a => a.id === data.antrag.id)) {
                    antraege.push(data.antrag);
                    renderAntragsliste();
                    renderAdminAntragsliste();

                    // Erfolgsmeldung nur für den Admin, der den Antrag erstellt hat
                    if (data.source === 'self' && isAdmin) {
                        alert(`Antrag #${data.antrag.id} erfolgreich erstellt!`);
                    }
                }
                break;

            case 'ANTRAG_DELETED':
                antraege = antraege.filter(a => a.id !== data.antragId);
                renderAntragsliste();
                renderAdminAntragsliste();

                if (currentSlideId === data.antragId) {
                    currentSlideId = null;
                    if (!pages.live.classList.contains('hidden')) {
                        document.getElementById('current-slide').innerHTML = `
                            <h2 class="slide-title">Kein aktiver Antrag</h2>
                            <p>Warten auf Präsentation...</p>
                        `;
                    }
                }

                if (data.source === 'self' && isAdmin) {
                    alert('Antrag erfolgreich gelöscht!');
                }
                break;

            case 'AUTH_REQUIRED':
                if (isAdmin) {
                    loginModal.style.display = 'flex';
                }
                break;

            case 'AUTH_SUCCESS':
                console.log(data.uuid);
                isAdmin = true;
                loginModal.style.display = 'none';
                showPage('admin');
                if (data.uuid) {
                    setCookie('sessionToken', data.uuid, 1);
                }
                break;
            
            case 'AUTH_FAILED':
                alert('Falsche Anmeldedaten!');
                break;

            case 'COOKIE_SUCCESS':
                console.log("Cookie success")
                isAdmin = true;
                break;
                
            case 'COOKIE_FAILED':
                console.log("Cookie failed")
                deleteCookie('sessionToken');
                break;


        case 'EXPORT_DATA':
            // Create download link
            const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.filename || 'antraege.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            break;
            
        case 'IMPORT_SUCCESS':
            alert('Import erfolgreich!');
            break;
            
        case 'IMPORT_ERROR':
            alert('Import fehlgeschlagen: ' + data.message);
            break;

            case 'ERROR':
                console.error('Serverfehler:', data.message);
                if (data.showToUser) {
                    alert(`Fehler: ${data.message}`);
                }
                break;
        }
    }

    // Antragsliste rendern
    function renderAntragsliste() {
        const liste = document.getElementById('antragsliste');
        liste.innerHTML = '';

        antraege.sort((a, b) => a.id - b.id).forEach(antrag => {
            const empfehlungClass = antrag.empfehlung;
            let empfehlungText = '';

            switch(antrag.empfehlung) {
                case 'gruen': empfehlungText = 'Zustimmung'; break;
                case 'rot': empfehlungText = 'Ablehnung'; break;
                case 'gelb': empfehlungText = 'Enthaltung'; break;
            }

            const li = document.createElement('li');
            li.className = `antrag-card ${empfehlungClass}`;
            li.innerHTML = `
                <h3 class="antrag-title">Antrag ${antrag.id}: ${antrag.titel}</h3>
                <p>${antrag.beschreibung}</p>
                <div class="antrag-meta">
                    <span class="badge">#${antrag.id}</span>
                    <div class="abstimmungsempfehlung ${empfehlungClass}" title="${empfehlungText}">
                        ${empfehlungText.charAt(0)}
                    </div>
                </div>
            `;
            liste.appendChild(li);
        });
    }

    // Admin-Antragsliste rendern
    function renderAdminAntragsliste() {
        const liste = document.getElementById('admin-antragsliste');
        liste.innerHTML = '';

        antraege.sort((a, b) => a.id - b.id).forEach(antrag => {
            const empfehlungClass = antrag.empfehlung;

            const div = document.createElement('div');
            div.className = 'admin-list-item';
            div.innerHTML = `
                <div>
                    <strong>Antrag ${antrag.id}:</strong> ${antrag.titel}
                    <div class="abstimmungsempfehlung ${empfehlungClass}" style="margin-top: 0.5rem;"></div>
                </div>
                <div>
                    <button class="button button-outline show-slide-btn" data-id="${antrag.id}">
                        <i class="fas fa-tv"></i> Anzeigen
                    </button>
                    <button class="button button-outline delete-antrag-btn" data-id="${antrag.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            liste.appendChild(div);
        });

        // Event-Listener für die neuen Buttons hinzufügen
        document.querySelectorAll('.show-slide-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-id'));
                showAntragAsSlide(id);
            });
        });

        document.querySelectorAll('.delete-antrag-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-id'));
                deleteAntrag(id);
            });
        });
    }

    // Antrag in der Slideshow anzeigen
    function showAntragAsSlide(id, broadcast = true) {
        const antrag = antraege.find(a => a.id === id);
        if (!antrag) return;

        const slide = document.getElementById('current-slide');
        slide.className = `slide active ${antrag.empfehlung}`;

        let empfehlungText = '';
        switch(antrag.empfehlung) {
            case 'gruen': empfehlungText = 'Empfehlung: Zustimmung'; break;
            case 'rot': empfehlungText = 'Empfehlung: Ablehnung'; break;
            case 'gelb': empfehlungText = 'Empfehlung: Enthaltung'; break;
        }

        slide.innerHTML = `
            <h2 class="slide-title">Antrag ${antrag.id}: ${antrag.titel}</h2>
            <p>${antrag.beschreibung}</p>
            <div class="slide-empfehlung ${antrag.empfehlung}">${empfehlungText}</div>
        `;

        // Änderung an Server senden (wenn nicht durch Server-Update ausgelöst)
        if (broadcast && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'CHANGE_SLIDE',
                slideId: id
            }));
        }
    }

    // Seiten-Navigation
    function showPage(pageName) {
        // Alle Seiten verstecken
        Object.values(pages).forEach(page => page.classList.add('hidden'));

        // Gewählte Seite anzeigen
        pages[pageName].classList.remove('hidden');

        // Bei Live-Seite aktuellen Slide anzeigen
        if (pageName === 'live' && currentSlideId) {
            showAntragAsSlide(currentSlideId, false);
        }
    }

    // Event-Handler einrichten
    function setupEventListeners() {
        // Navigation
        navLinks.antraege.addEventListener('click', (e) => {
            e.preventDefault();
            showPage('antraege');
        });

        navLinks.live.addEventListener('click', (e) => {
            e.preventDefault();
            showPage('live');
        });

        navLinks.admin.addEventListener('click', (e) => {
            e.preventDefault();
            if (isAdmin) {
                showPage('admin');
            } else {
                loginModal.style.display = 'flex';
            }
        });

        // Admin-Steuerelemente
        document.getElementById('prev-slide').addEventListener('click', () => {
            if (antraege.length === 0) return;

            let currentIndex = currentSlideId ? antraege.findIndex(a => a.id === currentSlideId) : -1;
            let newIndex = currentIndex - 1;

            if (newIndex < 0) newIndex = antraege.length - 1;
            if (newIndex >= 0) {
                showAntragAsSlide(antraege[newIndex].id);
            }
        });

        document.getElementById('next-slide').addEventListener('click', () => {
            if (antraege.length === 0) return;

            let currentIndex = currentSlideId ? antraege.findIndex(a => a.id === currentSlideId) : -1;
            let newIndex = currentIndex + 1;

            if (newIndex >= antraege.length) newIndex = 0;
            showAntragAsSlide(antraege[newIndex].id);
        });

        document.getElementById('show-live').addEventListener('click', () => {
            showPage('live');
        });

        document.getElementById('antrag-erstellen').addEventListener('click', createAntrag);

        // Login-Modal
        closeModalBtn.addEventListener('click', () => {
            loginModal.style.display = 'none';
        });

        loginSubmitBtn.addEventListener('click', () => {
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'AUTHENTICATE',
                    username,
                    password
                }));
            }

        });

        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) {
                loginModal.style.display = 'none';
            }
        });
    }

    // Neuen Antrag erstellen
    function createAntrag() {
        const titel = document.getElementById('antrag-titel').value.trim();
        const beschreibung = document.getElementById('antrag-beschreibung').value.trim();
        const empfehlung = document.getElementById('antrag-empfehlung').value;

        if (!titel || !beschreibung) {
            alert('Bitte füllen Sie alle Felder aus!');
            return;
        }

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'CREATE_ANTRAG',
                antrag: {
                    titel,
                    beschreibung,
                    empfehlung
                },
                source: 'self'
            }));

            // Formular zurücksetzen
            document.getElementById('antrag-titel').value = '';
            document.getElementById('antrag-beschreibung').value = '';
            document.getElementById('antrag-empfehlung').value = 'gruen';
        } else {
            alert('Keine Verbindung zum Server! Antrag konnte nicht erstellt werden.');
        }
    }

    // Antrag löschen
    function deleteAntrag(id) {
        if (!confirm('Möchten Sie diesen Antrag wirklich löschen?')) return;

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'DELETE_ANTRAG',
                antragId: id,
                source: 'self'
            }));
        } else {
            alert('Keine Verbindung zum Server! Antrag konnte nicht gelöscht werden.');
        }
    }

function exportAntraege() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'EXPORT_REQUEST' }));
    } 
}

function importAntraege(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'IMPORT_DATA',
                    data: data
                }));
            } 
        } catch (error) {
            alert('Ungültige JSON-Datei: ' + error.message);
        }
    };
    reader.readAsText(file);
}


function setCookie(name, value, daysToLive) {
    const date = new Date();
    date.setTime(date.getTime() + (daysToLive * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = `${name}=${value}; ${expires}; path=/; Secure; SameSite=Strict`;
    console.log("Cookie gesetzt")
}

function getCookie(name) {
    const cookieName = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookieArray = decodedCookie.split(';');
    
    for(let i = 0; i < cookieArray.length; i++) {
        let cookie = cookieArray[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if (cookie.indexOf(cookieName) === 0) {
            return cookie.substring(cookieName.length, cookie.length);
        }
    }
    return null;
}

function deleteCookie(name) {
    setCookie(name, "", -1);
}









document.getElementById('export-btn').addEventListener('click', exportAntraege);
document.getElementById('import-file').addEventListener('change', importAntraege);

    reloadPageButton.addEventListener('click', () => {
     location.reload();
    });

    document.addEventListener('DOMContentLoaded', function() {
        initWebSocket();
        setupEventListeners();
        showPage('antraege');
    });