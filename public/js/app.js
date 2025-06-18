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

// Detail Modal Elements
const antragDetailModal = document.getElementById('antrag-detail-modal');
const closeAntragDetailModalBtn = document.getElementById('close-antrag-detail-modal');
const detailAntragTitle = document.getElementById('detail-antrag-title');
const detailAntragAntragsteller = document.getElementById('detail-antrag-antragsteller');
const detailAntragBeschreibung = document.getElementById('detail-antrag-beschreibung');
const detailAntragLinks = document.getElementById('detail-antrag-links');
const detailAntragEmpfehlung = document.getElementById('detail-antrag-empfehlung');

// WebSocket Initialisierung
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${window.location.hostname}:3000`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('Mit Server verbunden');
        reconnectAttempts = 0;
        connectionPopup.classList.add('hidden');

        socket.send(JSON.stringify({ type: 'REQUEST_INIT' }));
        const sessionToken = getCookie('sessionToken');
        if (sessionToken) {
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
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            console.log(`Versuche erneut in ${delay}ms...`);

            setTimeout(() => {
                reconnectAttempts++;
                initWebSocket();
            }, delay);
        } else {
            document.querySelector('.connection-popup-content p').textContent = 'Verbindung verloren. Bitte Seite neu laden!';
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
                showAntragAsSlide(currentSlideId, false);
            }
            break;

        case 'SLIDE_CHANGED':
            currentSlideId = data.slideId;
            if (!pages.live.classList.contains('hidden')) {
                showAntragAsSlide(currentSlideId, false);
            }
            break;

        case 'ANTRAG_ADDED':
            if (!antraege.some(a => a.id === data.antrag.id)) {
                antraege.push(data.antrag);
                renderAntragsliste();
                renderAdminAntragsliste();

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
            isAdmin = true;
            break;

        case 'COOKIE_FAILED':
            deleteCookie('sessionToken');
            break;

        case 'EXPORT_DATA':
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

// Farbzuordnung für Empfehlungen
function getColorClassForEmpfehlung(empfehlung) {
    const colorMap = {
        'unbedingt-annehmen': 'gruen',
        'annahmeempfehlung': 'lightgreen',
        'neutral': 'gelb',
        'annahme-mit-aenderungen': 'lightpink',
        'ablehnen': 'rot'
    };

    return colorMap[empfehlung] || 'gruen';
}

// Text für Empfehlungen
function getFullEmpfehlungText(empfehlung) {
    const textMap = {
        'unbedingt-annehmen': 'Unbedingt annehmen',
        'annahmeempfehlung': 'Annahmeempfehlung',
        'neutral': 'Neutral, besser mit guten ÄA',
        'annahme-mit-aenderungen': 'Annahme nur mit guten ÄA',
        'ablehnen': 'Ablehnen'
    };

    return textMap[empfehlung] || '';
}

// Kürzel für Empfehlungsanzeige
function getEmpfehlungKuerzel(empfehlung) {
    const kuerzelMap = {
        'unbedingt-annehmen': 'UA',
        'annahmeempfehlung': 'AE',
        'neutral': 'N',
        'annahme-mit-aenderungen': 'AmÄ',
        'ablehnen': 'AL'
    };

    return kuerzelMap[empfehlung] || '';
}

// Antragsliste rendern
function renderAntragsliste() {
    const liste = document.getElementById('antragsliste');
    liste.innerHTML = '';

    antraege.sort((a, b) => a.id - b.id).forEach(antrag => {
        const colorClass = getColorClassForEmpfehlung(antrag.empfehlung);
        const empfehlungText = getFullEmpfehlungText(antrag.empfehlung);
        const empfehlungKuerzel = getEmpfehlungKuerzel(antrag.empfehlung);

        const li = document.createElement('li');
        li.className = `antrag-card ${colorClass}`;
        li.dataset.id = antrag.id;

        li.innerHTML = `
            <h3 class="antrag-title">Antrag ${antrag.id}: ${antrag.titel}</h3>
            ${antrag.antragsteller ? `<p class="antrag-meta-info"><strong>Antragsteller*in:</strong> ${antrag.antragsteller}</p>` : ''}
            <p>${antrag.beschreibung}</p>
            ${antrag.links && antrag.links.length > 0 ? `
                <div class="antrag-links antrag-meta-info">
                    <strong>Links:</strong>
                    <ul>
                        ${antrag.links.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            <div class="antrag-meta">
                <span class="badge">#${antrag.id}</span>
                <div class="abstimmungsempfehlung ${colorClass}" title="${empfehlungText}">
                    ${empfehlungKuerzel}
                </div>
            </div>
        `;
        liste.appendChild(li);
    });

    document.querySelectorAll('.antrag-card').forEach(card => {
        card.addEventListener('click', function() {
            const id = parseInt(this.dataset.id);
            showAntragDetail(id);
        });
    });
}

// Admin-Antragsliste rendern
function renderAdminAntragsliste() {
    const liste = document.getElementById('admin-antragsliste');
    liste.innerHTML = '';

    antraege.sort((a, b) => a.id - b.id).forEach(antrag => {
        const colorClass = getColorClassForEmpfehlung(antrag.empfehlung);

        const div = document.createElement('div');
        div.className = 'admin-list-item';
        div.innerHTML = `
            <div>
                <strong>Antrag ${antrag.id}:</strong> ${antrag.titel}
                ${antrag.antragsteller ? `<br><span class="antrag-meta-info">Antragsteller*in: ${antrag.antragsteller}</span>` : ''}
                ${antrag.links && antrag.links.length > 0 ? `
                    <br><span class="antrag-meta-info">Links: ${antrag.links.map(link => `<a href="${link}" target="_blank">${link.substring(0, Math.min(link.length, 30))}...</a>`).join(', ')}</span>
                ` : ''}
                <div class="abstimmungsempfehlung ${colorClass}" style="margin-top: 0.5rem;"></div>
            </div>
            <div>
                <button class="button button-outline show-slide-btn" data-id="${antrag.id}">
                    <i class="fas fa-tv"></i> Anzeigen
                </button>
                <button class="button button-outline move-up-btn" data-id="${antrag.id}">
                    <i class="fas fa-arrow-up"></i>
                </button>
                <button class="button button-outline move-down-btn" data-id="${antrag.id}">
                    <i class="fas fa-arrow-down"></i>
                </button>
                <button class="button button-outline delete-antrag-btn" data-id="${antrag.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        liste.appendChild(div);
    });

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

    document.querySelectorAll('.move-up-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseInt(this.getAttribute('data-id'));
            moveAntragUp(id);
        });
    });

    document.querySelectorAll('.move-down-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseInt(this.getAttribute('data-id'));
            moveAntragDown(id);
        });
    });
}

// Antrag in der Slideshow anzeigen
function showAntragAsSlide(id, broadcast = true) {
    const antrag = antraege.find(a => a.id === id);
    if (!antrag) return;

    const colorClass = getColorClassForEmpfehlung(antrag.empfehlung);
    const empfehlungText = getFullEmpfehlungText(antrag.empfehlung);

    const slide = document.getElementById('current-slide');
    slide.className = `slide active ${colorClass}`;

    slide.innerHTML = `
        <h2 class="slide-title">Antrag ${antrag.id}: ${antrag.titel}</h2>
        ${antrag.antragsteller ? `<p><strong>Antragsteller*in:</strong> ${antrag.antragsteller}</p>` : ''}
        ${antrag.links && antrag.links.length > 0 ? `
            <div class="slide-links">
                <strong>Links:</strong>
                <ul>
                    ${antrag.links.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join('')}
                </ul>
            </div>
        ` : ''}
        <div class="slide-empfehlung ${colorClass}">${empfehlungText}</div>
    `;

    if (broadcast && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'CHANGE_SLIDE',
            slideId: id
        }));
    }
}

// Seiten-Navigation
function showPage(pageName) {
    Object.values(pages).forEach(page => page.classList.add('hidden'));
    pages[pageName].classList.remove('hidden');

    if (pageName === 'live' && currentSlideId) {
        showAntragAsSlide(currentSlideId, false);
    }
}

// Antrag Detail Popup anzeigen
function showAntragDetail(id) {
    const antrag = antraege.find(a => a.id === id);
    if (!antrag) return;

    const colorClass = getColorClassForEmpfehlung(antrag.empfehlung);
    const empfehlungText = getFullEmpfehlungText(antrag.empfehlung);

    detailAntragTitle.textContent = `Antrag ${antrag.id}: ${antrag.titel}`;

    if (antrag.antragsteller) {
        detailAntragAntragsteller.innerHTML = `<strong>Antragsteller*in:</strong> ${antrag.antragsteller}`;
        detailAntragAntragsteller.style.display = 'block';
    } else {
        detailAntragAntragsteller.style.display = 'none';
    }

    detailAntragBeschreibung.textContent = antrag.beschreibung;

    if (antrag.links && antrag.links.length > 0) {
        detailAntragLinks.innerHTML = `
            <strong>Links:</strong>
            <ul>
                ${antrag.links.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join('')}
            </ul>
        `;
        detailAntragLinks.style.display = 'block';
    } else {
        detailAntragLinks.style.display = 'none';
    }

    detailAntragEmpfehlung.innerHTML = `
        <div class="abstimmungsempfehlung ${colorClass}"></div>
        <span style="margin-left: 10px;">${empfehlungText}</span>
    `;

    antragDetailModal.style.display = 'flex';
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

    reloadPageButton.addEventListener('click', () => {
        location.reload();
    });

    document.getElementById('export-btn').addEventListener('click', exportAntraege);
    document.getElementById('import-file').addEventListener('change', importAntraege);

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

    // Antrag Detail Modal
    closeAntragDetailModalBtn.addEventListener('click', () => {
        antragDetailModal.style.display = 'none';
    });

    antragDetailModal.addEventListener('click', (e) => {
        if (e.target === antragDetailModal) {
            antragDetailModal.style.display = 'none';
        }
    });
}

// Neuen Antrag erstellen
function createAntrag() {
    const titel = document.getElementById('antrag-titel').value.trim();
    const beschreibung = document.getElementById('antrag-beschreibung').value.trim();
    const antragsteller = document.getElementById('antrag-antragsteller').value.trim();
    const linksInput = document.getElementById('antrag-links').value.trim();
    const empfehlungDropdown = document.getElementById('antrag-empfehlung');
    const empfehlung = empfehlungDropdown.value;

    const links = linksInput ? linksInput.split(',').map(link => link.trim()).filter(link => link !== '') : [];

    if (!titel || !beschreibung) {
        alert('Bitte füllen Sie die Felder "Antragstitel" und "Beschreibung" aus!');
        return;
    }

    const colorClass = getColorClassForEmpfehlung(empfehlung);
    empfehlungDropdown.className = ''; // Reset classes
    empfehlungDropdown.classList.add(colorClass);

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'CREATE_ANTRAG',
            antrag: {
                titel,
                beschreibung,
                antragsteller,
                links,
                empfehlung
            },
            source: 'self'
        }));

        // Formular zurücksetzen
        document.getElementById('antrag-titel').value = '';
        document.getElementById('antrag-beschreibung').value = '';
        document.getElementById('antrag-antragsteller').value = '';
        document.getElementById('antrag-links').value = '';
        document.getElementById('antrag-empfehlung').value = 'unbedingt-annehmen';
        empfehlungDropdown.className = 'gruen';
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

function moveAntragUp(antragId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'MOVE_ANTRAG_UP',
            antragId: antragId,
            source: 'self'
        }));
    } else {
        alert('Keine Verbindung zum Server! Antrag konnte nicht verschoben werden.');
    }
}

function moveAntragDown(antragId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'MOVE_ANTRAG_DOWN',
            antragId: antragId,
            source: 'self'
        }));
    } else {
        alert('Keine Verbindung zum Server! Antrag konnte nicht verschoben werden.');
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

document.addEventListener('DOMContentLoaded', function() {
    initWebSocket();
    setupEventListeners();
    showPage('antraege');

    // Dropdown color update on change
    const empfehlungDropdown = document.getElementById('antrag-empfehlung');
    empfehlungDropdown.addEventListener('change', () => {
        const selectedValue = empfehlungDropdown.value;
        const colorClass = getColorClassForEmpfehlung(selectedValue);

        empfehlungDropdown.className = '';
        empfehlungDropdown.classList.add(colorClass);
    });

    // Initiale Farbe setzen
    empfehlungDropdown.className = 'gruen';
});