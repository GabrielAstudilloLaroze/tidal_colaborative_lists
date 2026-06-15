// colabList Single Page App Client Engine

// Application State
let state = {
    status: 'unauthenticated', // 'authenticated', 'pending', 'unauthenticated'
    user: null,
    activePlaylistId: null,
    activePlaylistName: '',
    playlists: [],
    tracks: [],
    activeTab: 'tracks', // 'tracks', 'search'
    pollIntervalId: null,
    statusIntervalId: null,
    dragStartIndex: null
};

// DOM Elements
const els = {
    badgeText: document.getElementById('badge-text'),
    badge: document.getElementById('session-badge'),
    stepAuth: document.getElementById('step-auth'),
    stepSelector: document.getElementById('step-playlist-selector'),
    stepDashboard: document.getElementById('step-dashboard'),
    btnStartAuth: document.getElementById('btn-start-auth'),
    authInitial: document.getElementById('auth-initial'),
    authPending: document.getElementById('auth-pending'),
    userCode: document.getElementById('user-code'),
    btnCopyCode: document.getElementById('btn-copy-code'),
    tidalLink: document.getElementById('tidal-link'),
    tidalQr: document.getElementById('tidal-qr'),
    playlistGrid: document.getElementById('playlist-grid'),
    formCreatePlaylist: document.getElementById('form-create-playlist'),
    newPlaylistName: document.getElementById('new-playlist-name'),
    newPlaylistDesc: document.getElementById('new-playlist-desc'),
    btnLogout: document.getElementById('btn-logout'),
    
    // Dashboard
    activePlaylistName: document.getElementById('active-playlist-name'),
    activePlaylistDesc: document.getElementById('active-playlist-desc'),
    playlistTrackCount: document.getElementById('playlist-track-count'),
    shareLinkInput: document.getElementById('share-link-input'),
    btnCopyShare: document.getElementById('btn-copy-share'),
    shareQr: document.getElementById('share-qr'),
    
    // Tabs
    tabBtnTracks: document.getElementById('tab-btn-tracks'),
    tabBtnSearch: document.getElementById('tab-btn-search'),
    tabTracks: document.getElementById('tab-tracks'),
    tabSearch: document.getElementById('tab-search'),
    playlistTracksList: document.getElementById('playlist-tracks-list'),
    
    // Search
    searchInput: document.getElementById('search-input'),
    btnSearchTrigger: document.getElementById('btn-search-trigger'),
    searchResultsList: document.getElementById('search-results-list'),
    
    toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Setup Event Listeners
    setupEventListeners();
    
    // 2. Check for playlist_id in URL params (Guest contribution mode)
    const urlParams = new URLSearchParams(window.location.search);
    const urlPlaylistId = urlParams.get('playlist_id');
    
    // 3. Perform initial Auth Status Check
    checkAuthStatus().then(() => {
        if (urlPlaylistId) {
            // Guest mode: If a playlist is specified in URL, load it directly
            if (state.status === 'authenticated') {
                selectPlaylist(urlPlaylistId);
            } else {
                showToast('Esperando que el Host inicie sesión en Tidal...', 'error');
                showSection('step-auth');
                // Poll auth status, and when host logs in, automatically open the playlist
                startStatusPolling(urlPlaylistId);
            }
        } else {
            // Normal Host mode
            routeByStatus();
            startStatusPolling();
        }
    });
});

// Event Bindings
function setupEventListeners() {
    // OAuth triggers
    els.btnStartAuth.addEventListener('click', startTidalAuth);
    
    els.btnCopyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(els.userCode.textContent);
        showToast('¡Código copiado al portapapeles!');
    });
    
    els.btnCopyShare.addEventListener('click', () => {
        els.shareLinkInput.select();
        navigator.clipboard.writeText(els.shareLinkInput.value);
        showToast('¡Enlace de invitación copiado!');
    });
    
    els.btnLogout.addEventListener('click', performLogout);
    
    // Form Creation
    els.formCreatePlaylist.addEventListener('submit', (e) => {
        e.preventDefault();
        createPlaylist(els.newPlaylistName.value, els.newPlaylistDesc.value);
    });
    
    // Tabs switching
    els.tabBtnTracks.addEventListener('click', () => switchTab('tracks'));
    els.tabBtnSearch.addEventListener('click', () => switchTab('search'));
    
    // Search triggers
    els.btnSearchTrigger.addEventListener('click', performSearch);
    els.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
}

// Route layouts based on state
function routeByStatus() {
    if (state.status === 'authenticated') {
        if (state.activePlaylistId) {
            showSection('step-dashboard');
        } else {
            showSection('step-playlist-selector');
            loadPlaylists();
        }
    } else if (state.status === 'pending') {
        showSection('step-auth');
        els.authInitial.classList.add('hidden');
        els.authPending.classList.remove('hidden');
    } else {
        showSection('step-auth');
        els.authInitial.classList.remove('hidden');
        els.authPending.classList.add('hidden');
    }
}

function showSection(sectionId) {
    els.stepAuth.classList.add('hidden');
    els.stepSelector.classList.add('hidden');
    els.stepDashboard.classList.add('hidden');
    
    document.getElementById(sectionId).classList.remove('hidden');
}

// Toast Notification Engine
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const textNode = document.createTextNode(message);
    toast.appendChild(textNode);
    
    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.marginLeft = '12px';
    closeBtn.style.fontSize = '1.2rem';
    closeBtn.addEventListener('click', () => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    });
    toast.appendChild(closeBtn);
    
    els.toastContainer.appendChild(toast);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add('toast-fade-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}

// Authentication Actions
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        state.status = data.status;
        
        // Update headers badge UI
        els.badge.className = 'session-badge';
        if (data.status === 'authenticated') {
            state.user = data.user;
            els.badge.classList.add('authenticated');
            els.badgeText.textContent = `Host: ${data.user.name}`;
        } else if (data.status === 'pending') {
            els.badge.classList.add('pending');
            els.badgeText.textContent = 'Auth pendiente';
            els.userCode.textContent = data.user_code;
            els.tidalLink.href = data.verification_uri;
            
            // Build QR Code for authorization page
            els.tidalQr.innerHTML = '';
            new QRCode(els.tidalQr, {
                text: data.verification_uri,
                width: 140,
                height: 140,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.M
            });
        } else {
            els.badgeText.textContent = 'Sin conectar';
        }
        return data;
    } catch (err) {
        console.error('Error fetching auth status:', err);
    }
}

function startStatusPolling(targetPlaylistId = null) {
    if (state.statusIntervalId) clearInterval(state.statusIntervalId);
    
    state.statusIntervalId = setInterval(async () => {
        const statusData = await checkAuthStatus();
        
        if (statusData.status === 'authenticated') {
            clearInterval(state.statusIntervalId);
            state.statusIntervalId = null;
            showToast('¡Conectado exitosamente con Tidal!');
            
            if (targetPlaylistId) {
                selectPlaylist(targetPlaylistId);
            } else {
                routeByStatus();
            }
        } else if (statusData.status === 'unauthenticated' && !els.authPending.classList.contains('hidden')) {
            // If it was pending but now is unauthenticated (e.g. timeout)
            clearInterval(state.statusIntervalId);
            state.statusIntervalId = null;
            routeByStatus();
            showToast('La sesión de autenticación ha caducado. Vuelve a intentarlo.', 'error');
        }
    }, 2000);
}

async function startTidalAuth() {
    try {
        els.btnStartAuth.disabled = true;
        els.btnStartAuth.textContent = 'Iniciando...';
        
        const response = await fetch('/api/auth/login', { method: 'POST' });
        const data = await response.json();
        
        if (data.error) {
            showToast(data.error, 'error');
            els.btnStartAuth.disabled = false;
            els.btnStartAuth.textContent = 'Vincular con Tidal';
            return;
        }
        
        state.status = 'pending';
        routeByStatus();
        await checkAuthStatus(); // Update UI with details
        startStatusPolling();
    } catch (err) {
        showToast('Error al conectar con Tidal', 'error');
        els.btnStartAuth.disabled = false;
        els.btnStartAuth.textContent = 'Vincular con Tidal';
    }
}

async function performLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        state.status = 'unauthenticated';
        state.activePlaylistId = null;
        state.activePlaylistName = '';
        state.user = null;
        if (state.pollIntervalId) clearInterval(state.pollIntervalId);
        
        // Remove playlist param from URL
        const url = new URL(window.location);
        url.searchParams.delete('playlist_id');
        window.history.pushState({}, '', url);
        
        routeByStatus();
        showToast('Sesión de Tidal cerrada');
    } catch (err) {
        showToast('Error al cerrar sesión', 'error');
    }
}

// Playlist Actions
async function loadPlaylists() {
    try {
        els.playlistGrid.innerHTML = '<div class="spinner" style="margin: 40px auto; grid-column: 1/-1;"></div>';
        const response = await fetch('/api/playlists');
        if (!response.ok) throw new Error('Failed to load');
        
        const playlists = await response.json();
        state.playlists = playlists;
        
        renderPlaylists();
    } catch (err) {
        els.playlistGrid.innerHTML = '<p class="error-msg" style="grid-column: 1/-1; text-align: center;">Error al cargar tus playlists de Tidal.</p>';
    }
}

function renderPlaylists() {
    els.playlistGrid.innerHTML = '';
    
    if (state.playlists.length === 0) {
        els.playlistGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No se encontraron playlists. ¡Crea una nueva abajo!</p>';
        return;
    }
    
    state.playlists.forEach(p => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
            <div>
                <h4 class="playlist-card-title">${escapeHTML(p.name)}</h4>
                <p class="playlist-card-desc">${escapeHTML(p.description || 'Sin descripción')}</p>
            </div>
            <div class="playlist-card-meta">${p.num_tracks} canciones</div>
        `;
        card.addEventListener('click', () => selectPlaylist(p.id));
        els.playlistGrid.appendChild(card);
    });
}

async function createPlaylist(name, description) {
    const btn = document.getElementById('btn-create-submit');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creando...';
    
    try {
        const response = await fetch('/api/playlists/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        const playlist = await response.json();
        
        if (playlist.error) {
            showToast(playlist.error, 'error');
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }
        
        showToast(`¡Playlist "${playlist.name}" creada con éxito!`);
        selectPlaylist(playlist.id);
    } catch (err) {
        showToast('Error al crear la playlist', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// Select playlist and launch Dashboard
async function selectPlaylist(playlistId) {
    state.activePlaylistId = playlistId;
    
    // Render URL param for easy sharing
    const url = new URL(window.location);
    url.searchParams.set('playlist_id', playlistId);
    window.history.pushState({}, '', url);
    
    showSection('step-dashboard');
    
    // Render shared link widget
    const shareUrl = `${window.location.origin}/?playlist_id=${playlistId}`;
    els.shareLinkInput.value = shareUrl;
    
    // Create Share QR
    els.shareQr.innerHTML = '';
    new QRCode(els.shareQr, {
        text: shareUrl,
        width: 120,
        height: 120,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.M
    });
    
    // Fetch initial details and tracks
    await updatePlaylistInfo();
    await loadPlaylistTracks();
    
    // Start collaborative synchronizer polling loop (every 5 seconds)
    if (state.pollIntervalId) clearInterval(state.pollIntervalId);
    state.pollIntervalId = setInterval(async () => {
        await loadPlaylistTracks(true); // silent check update
    }, 5000);
}

async function updatePlaylistInfo() {
    try {
        const response = await fetch(`/api/playlists/${state.activePlaylistId}`);
        const playlist = await response.json();
        
        if (playlist.error) {
            showToast('No se pudieron obtener los detalles de la playlist.', 'error');
            return;
        }
        
        state.activePlaylistName = playlist.name;
        els.activePlaylistName.textContent = playlist.name;
        els.activePlaylistDesc.textContent = playlist.description || 'Lista colaborativa';
        els.playlistTrackCount.textContent = `${playlist.num_tracks} canciones`;
    } catch (err) {
        console.error('Error updating playlist info:', err);
    }
}

async function loadPlaylistTracks(isSilent = false) {
    try {
        if (!isSilent) {
            els.playlistTracksList.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div>';
        }
        
        const response = await fetch(`/api/playlists/${state.activePlaylistId}/tracks`);
        const tracks = await response.json();
        
        if (tracks.error) {
            if (!isSilent) {
                els.playlistTracksList.innerHTML = '<p class="error-msg">Error al cargar canciones.</p>';
            }
            return;
        }
        
        // Optimize: Check if tracks list actually changed to avoid re-drawing DOM
        if (isSilent && state.tracks.length === tracks.length) {
            const hasChanged = state.tracks.some((t, i) => t.id !== tracks[i].id);
            if (!hasChanged) return; // lists are identical, skip render
        }
        
        state.tracks = tracks;
        els.playlistTrackCount.textContent = `${tracks.length} canciones`;
        renderPlaylistTracks();
    } catch (err) {
        console.error('Error loading tracks:', err);
        if (!isSilent) {
            els.playlistTracksList.innerHTML = '<p class="error-msg">Error de conexión al cargar canciones.</p>';
        }
    }
}

function renderPlaylistTracks() {
    els.playlistTracksList.innerHTML = '';
    
    if (state.tracks.length === 0) {
        els.playlistTracksList.innerHTML = `
            <div class="empty-state">
                <p>Esta playlist no tiene canciones aún. ¡Usa la pestaña "Buscar y Añadir" para agregar tus temas preferidos!</p>
            </div>
        `;
        return;
    }
    
    state.tracks.forEach((t, index) => {
        const row = document.createElement('div');
        row.className = 'track-row draggable';
        row.draggable = true;
        
        let artHTML = `
            <div class="track-artwork-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </div>`;
        if (t.image) {
            artHTML = `<img src="${t.image}" alt="${escapeHTML(t.album)}" class="track-artwork">`;
        }
        
        row.innerHTML = `
            <div class="track-col-index">${index + 1}</div>
            <div class="track-col-info">
                ${artHTML}
                <div class="track-meta">
                    <div class="track-name" title="${escapeHTML(t.name)}">${escapeHTML(t.name)}</div>
                    <div class="track-artist" title="${escapeHTML(t.artists.join(', '))}">
                        ${escapeHTML(t.artists.join(', '))}
                    </div>
                </div>
            </div>
            <div class="track-col-album" title="${escapeHTML(t.album)}">${escapeHTML(t.album)}</div>
            <div class="track-col-duration" style="display: flex; justify-content: space-between; align-items: center; padding-right: 10px;">
                <span>${formatDuration(t.duration)}</span>
                <button class="btn-remove-track" data-index="${index}" title="Eliminar" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
        
        const removeBtn = row.querySelector('.btn-remove-track');
        removeBtn.addEventListener('click', () => removeTrackFromPlaylist(index, t.name, removeBtn));
        
        // Add hover effect via JS since it's inline, or just rely on CSS
        removeBtn.addEventListener('mouseenter', () => removeBtn.style.color = 'var(--danger)');
        removeBtn.addEventListener('mouseleave', () => removeBtn.style.color = 'var(--text-muted)');
        
        // Drag and drop events
        row.addEventListener('dragstart', (e) => {
            state.dragStartIndex = index;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.track-row').forEach(r => r.classList.remove('drag-over'));
            state.dragStartIndex = null;
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move';
            if (state.dragStartIndex !== null && state.dragStartIndex !== index) {
                row.classList.add('drag-over');
            }
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            const fromIndex = state.dragStartIndex;
            const toIndex = index;
            if (fromIndex !== null && fromIndex !== toIndex) {
                moveTrackInPlaylist(fromIndex, toIndex);
            }
        });

        els.playlistTracksList.appendChild(row);
    });
}

// Search Actions
async function performSearch() {
    const query = els.searchInput.value.trim();
    if (!query) {
        showToast('Escribe algo para buscar', 'warning');
        return;
    }
    
    els.btnSearchTrigger.disabled = true;
    els.btnSearchTrigger.textContent = 'Buscando...';
    els.searchResultsList.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div>';
    
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await response.json();
        
        els.btnSearchTrigger.disabled = false;
        els.btnSearchTrigger.textContent = 'Buscar';
        
        if (results.error) {
            showToast(results.error, 'error');
            els.searchResultsList.innerHTML = '<p class="error-msg">Error en la búsqueda.</p>';
            return;
        }
        
        renderSearchResults(results);
    } catch (err) {
        showToast('Error de red al buscar', 'error');
        els.btnSearchTrigger.disabled = false;
        els.btnSearchTrigger.textContent = 'Buscar';
        els.searchResultsList.innerHTML = '<p class="error-msg">Error de conexión.</p>';
    }
}

function renderSearchResults(results) {
    els.searchResultsList.innerHTML = '';
    
    if (results.length === 0) {
        els.searchResultsList.innerHTML = `
            <div class="empty-state">
                <p>No se encontraron canciones para tu búsqueda. Intenta con otros términos.</p>
            </div>
        `;
        return;
    }
    
    results.forEach(t => {
        const row = document.createElement('div');
        row.className = 'search-track-row';
        
        let artHTML = `
            <div class="track-artwork-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </div>`;
        if (t.image) {
            artHTML = `<img src="${t.image}" alt="${escapeHTML(t.album)}" class="track-artwork">`;
        }
        
        row.innerHTML = `
            <div class="search-track-info">
                ${artHTML}
                <div class="track-meta">
                    <div class="track-name" title="${escapeHTML(t.name)}">${escapeHTML(t.name)}</div>
                    <div class="track-artist" title="${escapeHTML(t.artists.join(', '))}">
                        ${escapeHTML(t.artists.join(', '))} — ${escapeHTML(t.album)}
                    </div>
                </div>
            </div>
            <button class="btn btn-secondary btn-sm btn-add-track" data-id="${t.id}">
                <span>Añadir</span>
            </button>
        `;
        
        // Add Track click event
        const addBtn = row.querySelector('.btn-add-track');
        addBtn.addEventListener('click', () => addTrackToPlaylist(t.id, t.name, addBtn));
        
        els.searchResultsList.appendChild(row);
    });
}

async function addTrackToPlaylist(trackId, trackName, buttonEl) {
    if (buttonEl.disabled) return;
    
    buttonEl.disabled = true;
    buttonEl.innerHTML = '<div class="spinner" style="width:12px; height:12px; border-width: 1px;"></div>';
    
    try {
        const response = await fetch(`/api/playlists/${state.activePlaylistId}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: trackId })
        });
        const result = await response.json();
        
        if (result.error) {
            showToast(result.error, 'error');
            buttonEl.disabled = false;
            buttonEl.innerHTML = '<span>Añadir</span>';
            return;
        }
        
        // Success feedback
        buttonEl.innerHTML = '<span>Añadido ✓</span>';
        buttonEl.className = 'btn btn-sm btn-add-track success';
        showToast(`Añadido: "${trackName}"`);
        
        // Immediate updates
        loadPlaylistTracks(true); 
    } catch (err) {
        showToast('Error al añadir la canción', 'error');
        buttonEl.disabled = false;
        buttonEl.innerHTML = '<span>Añadir</span>';
    }
}

async function removeTrackFromPlaylist(index, trackName, buttonEl) {
    if (buttonEl.disabled) return;
    
    if (!confirm(`¿Seguro que deseas eliminar "${trackName}" de la playlist?`)) return;
    
    buttonEl.disabled = true;
    const originalContent = buttonEl.innerHTML;
    buttonEl.innerHTML = '<div class="spinner" style="width:12px; height:12px; border-width: 1px;"></div>';
    
    try {
        const response = await fetch(`/api/playlists/${state.activePlaylistId}/remove/${index}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.error) {
            showToast(result.error, 'error');
            buttonEl.disabled = false;
            buttonEl.innerHTML = originalContent;
            return;
        }
        
        showToast(`Eliminado: "${trackName}"`);
        loadPlaylistTracks(true); 
    } catch (err) {
        showToast('Error al eliminar la canción', 'error');
        buttonEl.disabled = false;
        buttonEl.innerHTML = originalContent;
    }
}

async function moveTrackInPlaylist(fromIndex, toIndex) {
    try {
        // Optimistic UI update
        const track = state.tracks.splice(fromIndex, 1)[0];
        state.tracks.splice(toIndex, 0, track);
        renderPlaylistTracks();

        const response = await fetch(`/api/playlists/${state.activePlaylistId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_index: fromIndex, to_index: toIndex })
        });
        const result = await response.json();
        
        if (result.error) {
            showToast(result.error, 'error');
            loadPlaylistTracks(true); // revert
            return;
        }
        
        showToast('Orden actualizado');
        loadPlaylistTracks(true);
    } catch (err) {
        showToast('Error al mover la canción', 'error');
        loadPlaylistTracks(true); // revert
    }
}

// UI Tab Navigation
function switchTab(tabId) {
    state.activeTab = tabId;
    
    if (tabId === 'tracks') {
        els.tabBtnTracks.classList.add('active');
        els.tabBtnSearch.classList.remove('active');
        els.tabTracks.classList.remove('hidden');
        els.tabSearch.classList.add('hidden');
        loadPlaylistTracks();
    } else {
        els.tabBtnTracks.classList.remove('active');
        els.tabBtnSearch.classList.add('active');
        els.tabTracks.classList.add('hidden');
        els.tabSearch.classList.remove('hidden');
    }
}

// Utility Helpers
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
