import { scanFolder, categorizeTracksBySubfolder } from './file-scanner.js';
import { PlaylistManager } from './playlist-manager.js';
import { AudioPlayer } from './audio-player.js';
import { ColumnRenderer } from './column-renderer.js';
import { DragDropManager } from './drag-drop.js';

const state = {
    rootPath: null,
    allTracks: [],
    libraryTracks: [],
    playlists: [],
    currentTrack: null,
    isPlaying: false,
    selectedTracks: new Set(),
    searchQuery: ''
};

export function getState() { return state; }
export function setState(newState) { Object.assign(state, newState); }

document.addEventListener('DOMContentLoaded', () => {
    const playlistManager = new PlaylistManager(getState, setState);
    
    const uiElements = {
        progressBar: document.getElementById('progress-wrapper'),
        progressBarFill: document.getElementById('progress-fill'),
        currentTimeDisplay: document.getElementById('current-time'),
        durationDisplay: document.getElementById('total-time'),
        playButton: document.getElementById('play-pause-btn'),
        playButtonIcon: document.getElementById('play-icon'),
        nextButton: document.getElementById('next-btn'),
        prevButton: document.getElementById('prev-btn'),
        stopButton: document.getElementById('stop-btn'),
        trackTitle: document.getElementById('player-title'),
        trackArtist: document.getElementById('player-artist')
    };
    
    const audioPlayer = new AudioPlayer(uiElements);
    
    const renderer = new ColumnRenderer({
        library: document.getElementById('library-track-list'),
        playlists: document.getElementById('playlists-area')
    }, {
        onTrackSelect: (id) => {
            state.selectedTracks.clear();
            state.selectedTracks.add(id);
            renderAll();
        },
        onTrackToggleSelect: (id) => {
            if (state.selectedTracks.has(id)) state.selectedTracks.delete(id);
            else state.selectedTracks.add(id);
            renderAll();
        },
        onTrackPlay: (track) => {
            const playlist = playlistManager.getPlaylistForTrack(track.id);
            if (playlist) {
                audioPlayer.setContext(playlist.tracks);
            } else {
                audioPlayer.setContext(state.libraryTracks);
            }
            audioPlayer.play(track);
        },
        onPlaylistRename: (id, name) => playlistManager.renamePlaylist(id, name),
        onPlaylistSave: (id) => playlistManager.savePlaylist(id),
        onPlaylistDelete: async (id) => {
            if (await showConfirmModal('Sei sicuro di voler eliminare questa playlist? I brani verranno rimessi nella Libreria Principale e la cartella su disco verrà eliminata.')) {
                await playlistManager.deletePlaylistFromDisk(id);
            }
        },
        onTrackReturnToLibrary: (trackId) => {
            playlistManager.moveTrackToLibrary(trackId);
        },
        onTrackContextMenu: async (track) => {
            await openTrackDetailsModal(track);
        },
        onRequestPlaylistProgress: (playlistId) => {
            updatePlaylistPlaybackPosition(playlistId);
        }
    });

    const dragDrop = new DragDropManager({
        onFolderDrop: async (path) => await loadFolder(path),
        onTrackMoveToPlaylist: (trackId, playlistId) => playlistManager.moveTrackToPlaylist(trackId, playlistId),
        onTrackMoveToLibrary: (trackId) => playlistManager.moveTrackToLibrary(trackId),
        onTrackReorder: (playlistId, trackId, newIndex) => playlistManager.reorderTrack(playlistId, trackId, newIndex),
        getSelectedTracks: () => state.selectedTracks
    });

    dragDrop.initFolderDrop(document.body);

    // Event listeners for PlaylistManager
    playlistManager.addEventListener('track-moved', () => renderAll());
    playlistManager.addEventListener('playlist-deleted', (e) => {
        renderer.removePlaylistColumn(e.detail.playlistId);
        renderAll();
    });
    playlistManager.addEventListener('track-reordered', () => renderAll());
    playlistManager.addEventListener('playlist-saved', (e) => {
        if (e.detail && e.detail.result && e.detail.result.newPaths) {
            e.detail.result.newPaths.forEach(moved => {
                audioPlayer.updateTrackPath(moved.id, moved.newPath);
            });
        }
        showToast('Playlist salvata con successo', 'success');
    });
    playlistManager.addEventListener('playlist-renamed', () => {
        // Aggiorna eventuali percorsi brani in riproduzione
        if (state.currentTrack) {
            const currentInState = state.allTracks.find(t => t.id === state.currentTrack.id);
            if (currentInState && currentInState.path !== state.currentTrack.path) {
                audioPlayer.updateTrackPath(currentInState.id, currentInState.path);
            }
        }
    });

    // Audio Player events
    let currentTrackPlaybackTime = 0;

    // Click sul titolo/nome del brano nel player per fare lo scroll al brano
    if (uiElements.trackTitle) {
        uiElements.trackTitle.style.cursor = 'pointer';
        uiElements.trackTitle.title = 'Mostra brano nella libreria o playlist';
        uiElements.trackTitle.addEventListener('click', () => {
            if (!state.currentTrack) return;
            // Se il brano si trova nella libreria ma c'è una ricerca attiva che lo nasconde, resetta la ricerca
            const inLibrary = state.libraryTracks.some(t => t.id === state.currentTrack.id);
            if (inLibrary && state.searchQuery) {
                state.searchQuery = '';
                const searchInput = document.getElementById('library-search');
                if (searchInput) searchInput.value = '';
                renderAll();
            }
            renderer.scrollToTrack(state.currentTrack.id);
        });
    }

    function getPlaylistTotalPlaybackTime(playlist) {
        if (!state.currentTrack || !playlist) return null;
        const currentTrackIndex = playlist.tracks.findIndex(t => t.id === state.currentTrack.id);
        if (currentTrackIndex === -1) return null;

        let accumulated = 0;
        for (let i = 0; i < currentTrackIndex; i++) {
            accumulated += (Number(playlist.tracks[i].duration) || 0);
        }
        accumulated += currentTrackPlaybackTime;
        return accumulated;
    }

    function updatePlaylistPlaybackPosition(specificPlaylistId = null) {
        if (!state.currentTrack) {
            renderer.clearAllPlaylistPlaybackTimes();
            return;
        }

        const activePlaylist = playlistManager.getPlaylistForTrack(state.currentTrack.id);

        if (specificPlaylistId) {
            if (activePlaylist && activePlaylist.id === specificPlaylistId) {
                const totalSecs = getPlaylistTotalPlaybackTime(activePlaylist);
                renderer.updatePlaylistPlaybackTime(activePlaylist.id, totalSecs, state.isPlaying);
            } else {
                renderer.updatePlaylistPlaybackTime(specificPlaylistId, null, false);
            }
            return;
        }

        state.playlists.forEach(pl => {
            if (activePlaylist && pl.id === activePlaylist.id) {
                const totalSecs = getPlaylistTotalPlaybackTime(pl);
                renderer.updatePlaylistPlaybackTime(pl.id, totalSecs, state.isPlaying);
            } else {
                renderer.updatePlaylistPlaybackTime(pl.id, null, false);
            }
        });
    }

    window.addEventListener('player-timeupdate', (e) => {
        if (e.detail && e.detail.currentTrack) {
            currentTrackPlaybackTime = e.detail.currentTime || 0;
            updatePlaylistPlaybackPosition();
        } else {
            currentTrackPlaybackTime = 0;
            renderer.clearAllPlaylistPlaybackTimes();
        }
    });

    window.addEventListener('track-play', (e) => {
        state.isPlaying = true;
        state.currentTrack = e.detail.track;
        renderer.updateTrackItem(e.detail.track.id, true);
        updatePlaylistPlaybackPosition();
    });
    window.addEventListener('track-pause', (e) => {
        state.isPlaying = false;
        renderer.updateTrackItem(e.detail.track.id, false);
        updatePlaylistPlaybackPosition();
    });

    // UI bindings
    const btnGuide = document.getElementById('guide-btn');
    const guideModal = document.getElementById('guide-modal');
    const btnGuideClose = document.getElementById('guide-close-btn');

    if (btnGuide && guideModal) {
        btnGuide.addEventListener('click', () => {
            guideModal.classList.remove('hidden');
        });
    }

    if (btnGuideClose && guideModal) {
        btnGuideClose.addEventListener('click', () => {
            guideModal.classList.add('hidden');
        });
    }

    const btnOpenFolder = document.getElementById('open-folder-btn');
    if (btnOpenFolder) {
        btnOpenFolder.addEventListener('click', async () => {
            if (window.api && window.api.selectFolder) {
                const path = await window.api.selectFolder();
                if (path) await loadFolder(path);
            }
        });
    }

    const btnSaveAll = document.getElementById('save-all-btn');
    if (btnSaveAll) {
        btnSaveAll.addEventListener('click', () => {
            playlistManager.saveAllPlaylists();
        });
    }
    
    const btnAddPlaylist = document.getElementById('add-playlist-btn');
    if (btnAddPlaylist) {
        btnAddPlaylist.addEventListener('click', () => {
            const pl = playlistManager.createPlaylist('Nuova Playlist');
            renderAll();
        });
    }

    const searchInput = document.getElementById('library-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderAll();
        });
    }

    async function loadFolder(path) {
        state.rootPath = path;
        
        const folderDisplay = document.getElementById('folder-path-display');
        if (folderDisplay) folderDisplay.textContent = path;

        if (window.api && window.api.scanFolder) {
            const result = await scanFolder(path);
            const categories = categorizeTracksBySubfolder(result);
            
            state.allTracks = result.tracks || [];
            state.libraryTracks = categories.libraryTracks || [];
            state.playlists = (categories.playlistGroups || []).map(g => ({
                id: playlistManager.generateId(),
                name: g.name,
                tracks: g.tracks,
                originalFolderName: g.name
            }));
            
            if (result.existingPlaylists) {
                result.existingPlaylists.forEach(ep => {
                    if (!state.playlists.find(p => p.originalFolderName === ep.name)) {
                        state.playlists.push({
                            id: playlistManager.generateId(),
                            name: ep.name,
                            tracks: [],
                            originalFolderName: ep.name
                        });
                    }
                });
            }

            // Hide initial overlay & show app sections
            const dropOverlay = document.getElementById('drop-zone-overlay');
            if (dropOverlay) dropOverlay.classList.add('hidden');

            const mainLibrary = document.getElementById('main-library');
            if (mainLibrary) mainLibrary.classList.remove('hidden');

            const playlistsArea = document.getElementById('playlists-area');
            if (playlistsArea) playlistsArea.classList.remove('hidden');

            const saveAllBtn = document.getElementById('save-all-btn');
            if (saveAllBtn) saveAllBtn.classList.remove('hidden');

            const addPlaylistBtn = document.getElementById('add-playlist-btn');
            if (addPlaylistBtn) addPlaylistBtn.classList.remove('hidden');
            
            renderAll();
        }
    }

    function renderAll() {
        renderer.renderLibrary(state.libraryTracks, state.searchQuery);
        
        // Update library badge count and total time
        const libraryCount = document.getElementById('library-count');
        if (libraryCount) libraryCount.textContent = state.libraryTracks.length;

        const libraryTotalTime = document.getElementById('library-total-time');
        if (libraryTotalTime) {
            libraryTotalTime.textContent = renderer.calculateTotalDuration(state.libraryTracks);
        }

        // Render playlist columns
        state.playlists.forEach(pl => renderer.renderPlaylistColumn(pl));
        
        // Update selection states
        document.querySelectorAll('.track-item').forEach(el => {
            if (state.selectedTracks.has(el.dataset.trackId)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });

        // Re-bind draggables after render
        dragDrop.refreshDraggables();

        // Ri-applica evidenziazione del brano correntemente in riproduzione/pausa
        if (state.currentTrack) {
            renderer.updateTrackItem(state.currentTrack.id, state.isPlaying);
        }
    }
    // Track Details Modal & Tab Switching
    const detailsModal = document.getElementById('track-details-modal');
    const detailsModalTitle = document.getElementById('details-modal-title');
    const detailsModalClose = document.getElementById('details-modal-close');
    const tabBtnId3 = document.getElementById('tab-btn-id3');
    const tabBtnTxt = document.getElementById('tab-btn-txt');
    const tabContentId3 = document.getElementById('tab-content-id3');
    const tabContentTxt = document.getElementById('tab-content-txt');
    const id3Container = document.getElementById('id3-container');
    const txtContainer = document.getElementById('txt-container');

    if (detailsModalClose && detailsModal) {
        detailsModalClose.addEventListener('click', () => {
            detailsModal.classList.add('hidden');
        });
    }

    if (tabBtnId3 && tabBtnTxt) {
        tabBtnId3.addEventListener('click', () => switchDetailsTab('id3'));
        tabBtnTxt.addEventListener('click', () => switchDetailsTab('txt'));
    }

    function switchDetailsTab(tabName) {
        if (tabName === 'id3') {
            tabBtnId3.classList.add('active');
            tabBtnId3.style.borderBottomColor = 'var(--accent-primary)';
            tabBtnId3.style.color = 'var(--text-primary)';
            tabBtnId3.style.fontWeight = '600';

            tabBtnTxt.classList.remove('active');
            tabBtnTxt.style.borderBottomColor = 'transparent';
            tabBtnTxt.style.color = 'var(--text-secondary)';
            tabBtnTxt.style.fontWeight = '500';

            tabContentId3.classList.remove('hidden');
            tabContentTxt.classList.add('hidden');
        } else {
            tabBtnTxt.classList.add('active');
            tabBtnTxt.style.borderBottomColor = 'var(--accent-primary)';
            tabBtnTxt.style.color = 'var(--text-primary)';
            tabBtnTxt.style.fontWeight = '600';

            tabBtnId3.classList.remove('active');
            tabBtnId3.style.borderBottomColor = 'transparent';
            tabBtnId3.style.color = 'var(--text-secondary)';
            tabBtnId3.style.fontWeight = '500';

            tabContentTxt.classList.remove('hidden');
            tabContentId3.classList.add('hidden');
        }
    }

    async function openTrackDetailsModal(track) {
        if (!window.api || !window.api.getTrackDetails) return;
        
        detailsModalTitle.textContent = `🎵 ${track.title || track.fileName}`;
        id3Container.innerHTML = '<div style="grid-column:1/-1; color:var(--text-muted);">Caricamento metadati...</div>';
        txtContainer.textContent = 'Caricamento info TXT...';
        
        switchDetailsTab('id3');
        detailsModal.classList.remove('hidden');

        try {
            const details = await window.api.getTrackDetails(track.path);
            
            // Render ID3 Tab
            const id3 = details.id3 || {};
            id3Container.innerHTML = `
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Titolo</div>
                    <div style="font-weight:600; color:var(--text-primary);">${id3.title || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Artista</div>
                    <div style="font-weight:600; color:var(--text-primary);">${id3.artist || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Album</div>
                    <div style="font-weight:500; color:var(--text-primary);">${id3.album || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Genere</div>
                    <div style="font-weight:500; color:var(--text-primary);">${id3.genre || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Anno / Data</div>
                    <div style="font-weight:500; color:var(--text-primary);">${id3.year || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Durata</div>
                    <div style="font-weight:500; color:var(--text-primary);">${renderer.formatDuration(id3.duration)}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Bitrate</div>
                    <div style="font-weight:500; color:var(--text-primary);">${id3.bitrate || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Frequenza Campionamento</div>
                    <div style="font-weight:500; color:var(--text-primary);">${id3.sampleRate || '-'}</div>
                </div>
                <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color); grid-column:1/-1;">
                    <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px;">Percorso File</div>
                    <div style="font-family:monospace; font-size:0.8rem; color:var(--accent-secondary); word-break:break-all;">${details.filePath}</div>
                </div>
            `;

            // Render TXT Tab: Parse key-value lines and embedded JSON blocks
            if (details.txtContent !== null && details.txtContent !== undefined) {
                const rawTxt = details.txtContent.trim();
                let renderedHtml = '';

                // Try to locate JSON inside the text file (e.g. after "--- Raw API Response ---" or enclosed in { ... })
                const jsonMatch = rawTxt.match(/\{[\s\S]*\}/);
                
                if (jsonMatch) {
                    try {
                        const parsedJson = JSON.parse(jsonMatch[0]);
                        if (typeof parsedJson === 'object' && parsedJson !== null) {
                            // Extract key summary fields from JSON
                            const summaryFields = [
                                { label: 'Titolo', value: parsedJson.title },
                                { label: 'Artista / Creatore', value: parsedJson.display_name || parsedJson.handle },
                                { label: 'Modello AI', value: parsedJson.model_name || (parsedJson.metadata && parsedJson.metadata.model_name) || parsedJson.major_model_version },
                                { label: 'Stato', value: parsedJson.status },
                                { label: 'ID Traccia', value: parsedJson.id },
                                { label: 'Riproduzioni', value: parsedJson.play_count !== undefined ? parsedJson.play_count : (parsedJson.reaction && parsedJson.reaction.play_count) },
                                { label: 'Voti Positivi', value: parsedJson.upvote_count },
                                { label: 'Data Creazione', value: parsedJson.created_at ? new Date(parsedJson.created_at).toLocaleString('it-IT') : '-' },
                                { label: 'Tag / Genere', value: parsedJson.display_tags || (parsedJson.metadata && parsedJson.metadata.tags) },
                                { label: 'Prompt Strumenti', value: parsedJson.metadata && parsedJson.metadata.prompt },
                                { label: 'URL Immagine Copertina', value: parsedJson.image_url || parsedJson.image_large_url },
                                { label: 'URL Audio CDN', value: parsedJson.audio_url }
                            ];

                            renderedHtml += '<h4 style="color:var(--accent-secondary); margin-bottom:10px; font-size:0.9rem;">📊 Metadati Estratti dal JSON</h4>';
                            renderedHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.85rem; margin-bottom:16px;">';
                            
                            for (const field of summaryFields) {
                                if (field.value !== undefined && field.value !== null && field.value !== '') {
                                    let valStr = typeof field.value === 'object' ? JSON.stringify(field.value) : String(field.value);
                                    let isLink = valStr.startsWith('http://') || valStr.startsWith('https://');
                                    
                                    renderedHtml += `
                                        <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border:1px solid var(--border-color); ${field.label.includes('Prompt') || field.label.includes('URL') ? 'grid-column:1/-1;' : ''}">
                                            <div style="color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; margin-bottom:2px; font-weight:600;">${field.label}</div>
                                            <div style="font-weight:500; color:var(--text-primary); word-break:break-all;">
                                                ${isLink ? `<a href="${valStr}" target="_blank" style="color:var(--accent-secondary); text-decoration:none;">${valStr}</a>` : valStr}
                                            </div>
                                        </div>
                                    `;
                                }
                            }
                            renderedHtml += '</div>';

                            // Accordion for Full Raw JSON / File Text
                            renderedHtml += `
                                <details style="background:var(--bg-primary); border:1px solid var(--border-color); border-radius:6px; padding:10px;">
                                    <summary style="cursor:pointer; color:var(--text-secondary); font-size:0.85rem; font-weight:600;">📄 Testo Completo File TXT / JSON Grezzo</summary>
                                    <pre style="font-family:monospace; font-size:0.8rem; color:var(--text-primary); white-space:pre-wrap; word-break:break-word; margin-top:10px; max-height:250px; overflow-y:auto;">${rawTxt}</pre>
                                </details>
                            `;
                        }
                    } catch (err) {
                        console.warn('Parsing JSON in txt fallito:', err);
                    }
                }

                if (!renderedHtml) {
                    renderedHtml = `<div style="background:var(--bg-surface); padding:12px; border-radius:6px; border:1px solid var(--border-color); font-family:monospace; font-size:0.85rem; color:var(--text-primary); white-space:pre-wrap; word-break:break-word;">${rawTxt || '(File TXT vuoto)'}</div>`;
                }

                txtContainer.innerHTML = renderedHtml;
            } else {
                txtContainer.innerHTML = '<span style="color:var(--text-muted); font-style:italic;">Nessun file .txt associato trovato per questo brano.</span>';
            }
        } catch (error) {
            console.error('Errore nel recupero dettagli del brano:', error);
            id3Container.innerHTML = '<div style="grid-column:1/-1; color:#f87171;">Impossibile leggere i metadati del brano.</div>';
            txtContainer.textContent = 'Errore durante la lettura del file TXT.';
        }
    }
});

export function moveTrackToPlaylist(trackId, playlistId) {
    // Helper reference
}

export function moveTrackToLibrary(trackId) {
    // Helper reference
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-slide-in`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

export async function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const modalMsg = document.getElementById('modal-message');
        const btnOk = document.getElementById('modal-ok');
        const btnCancel = document.getElementById('modal-cancel');

        if (!modal) {
            resolve(window.confirm(message));
            return;
        }

        modalMsg.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
    });
}

