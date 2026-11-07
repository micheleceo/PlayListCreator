export class ColumnRenderer {
    constructor(containers, callbacks) {
        this.libraryContainer = containers.library;
        this.playlistsContainer = containers.playlists;
        this.callbacks = callbacks;
        this.initLibraryResizer();
    }

    initLibraryResizer() {
        const libraryCol = document.getElementById('main-library');
        if (!libraryCol) return;
        this.initColumnResizer(libraryCol, 240, 700);
    }

    formatDuration(seconds) {
        const totalSecs = Math.round(Number(seconds) || 0);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    calculateTotalDuration(tracks) {
        if (!tracks || !tracks.length) return '00:00';
        const totalSecs = tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);
        return this.formatDuration(totalSecs);
    }

    createTrackElement(track, delayIndex = 0, options = {}) {
        const el = document.createElement('div');
        el.className = 'track-item animate-fade-in';
        el.style.setProperty('--delay', `${delayIndex * 0.05}s`);
        el.dataset.trackId = track.id;
        el.draggable = true;
        
        const returnBtnHtml = options.showReturnBtn ? `
            <button class="btn-return-library" title="Sposta nella Libreria" aria-label="Sposta nella Libreria">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
            </button>
        ` : '';

        el.innerHTML = `
            <div class="play-indicator"></div>
            <div class="track-info">
                <div class="title">${track.title || track.fileName}</div>
                <div class="artist">${track.artist || 'Sconosciuto'}</div>
            </div>
            ${returnBtnHtml}
            <div class="duration">${this.formatDuration(track.duration)}</div>
        `;

        if (options.showReturnBtn) {
            const btnReturn = el.querySelector('.btn-return-library');
            if (btnReturn) {
                btnReturn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.callbacks.onTrackReturnToLibrary) {
                        this.callbacks.onTrackReturnToLibrary(track.id);
                    }
                });
            }
        }
        
        el.addEventListener('click', e => {
            if (e.target.closest('.btn-return-library')) return;
            if (e.ctrlKey || e.metaKey) {
                this.callbacks.onTrackToggleSelect(track.id);
            } else {
                this.callbacks.onTrackSelect(track.id);
            }
        });
        
        el.addEventListener('dblclick', (e) => {
            if (e.target.closest('.btn-return-library')) return;
            this.callbacks.onTrackPlay(track);
        });

        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (this.callbacks.onTrackContextMenu) {
                this.callbacks.onTrackContextMenu(track);
            }
        });

        return el;
    }

    renderLibrary(tracks, searchQuery = '') {
        if (!this.libraryContainer) return;
        this.libraryContainer.innerHTML = '';
        const filtered = this.filterLibrary(tracks, searchQuery);
        
        if (filtered.length === 0) {
            this.libraryContainer.innerHTML = '<div class="empty-state">Nessun brano trovato</div>';
            return;
        }

        filtered.forEach((track, idx) => {
            this.libraryContainer.appendChild(this.createTrackElement(track, idx));
        });
    }

    filterLibrary(tracks, query) {
        if (!query) return tracks;
        const lowerQ = query.toLowerCase();
        return tracks.filter(t => 
            (t.title && t.title.toLowerCase().includes(lowerQ)) || 
            (t.artist && t.artist.toLowerCase().includes(lowerQ)) || 
            (t.fileName && t.fileName.toLowerCase().includes(lowerQ))
        );
    }

    renderPlaylistColumn(playlist) {
        if (!this.playlistsContainer) return;
        let column = this.playlistsContainer.querySelector(`.playlist-column[data-playlist-id="${playlist.id}"]`);
        if (!column) {
            column = this.addPlaylistColumn(playlist);
        }
        
        const trackList = column.querySelector('.drop-zone');
        trackList.innerHTML = '';
        
        if (playlist.tracks.length === 0) {
            trackList.innerHTML = '<div class="empty-state">Trascina i brani qui</div>';
        } else {
            playlist.tracks.forEach((track, idx) => {
                trackList.appendChild(this.createTrackElement(track, idx, { showReturnBtn: true }));
            });
        }
        
        const badgeCount = column.querySelector('.track-count');
        if (badgeCount) badgeCount.textContent = playlist.tracks.length;

        const badgeTotal = column.querySelector('.playlist-total-time');
        if (badgeTotal) badgeTotal.textContent = this.calculateTotalDuration(playlist.tracks);

        if (this.callbacks.onRequestPlaylistProgress) {
            this.callbacks.onRequestPlaylistProgress(playlist.id);
        }
    }

    addPlaylistColumn(playlist) {
        const column = document.createElement('div');
        column.className = 'playlist-column';
        column.dataset.playlistId = playlist.id;
        
        column.innerHTML = `
            <div class="playlist-header">
                <div class="playlist-title-row">
                    <input type="text" class="playlist-name" value="${playlist.name}">
                    <div class="playlist-badges">
                        <span class="badge track-count" title="Numero brani">${playlist.tracks.length}</span>
                        <div class="playlist-time-container">
                            <span class="badge badge-time playlist-playback-time hidden" title="Avanzamento riproduzione">00:00</span>
                            <span class="badge badge-time playlist-total-time" title="Durata totale">${this.calculateTotalDuration(playlist.tracks)}</span>
                        </div>
                    </div>
                </div>
                <div class="playlist-actions">
                    <button class="btn btn-primary btn-save" title="Salva">💾 Salva</button>
                    <button class="btn btn-ghost btn-delete" title="Elimina">🗑️</button>
                </div>
            </div>
            <div class="track-list drop-zone"></div>
            <div class="column-resizer" title="Trascina per ridimensionare"></div>
        `;
        
        column.querySelector('.playlist-name').addEventListener('change', e => {
            this.callbacks.onPlaylistRename(playlist.id, e.target.value);
        });
        
        column.querySelector('.btn-save').addEventListener('click', () => {
            this.callbacks.onPlaylistSave(playlist.id);
        });
        
        column.querySelector('.btn-delete').addEventListener('click', () => {
            this.callbacks.onPlaylistDelete(playlist.id);
        });
        
        this.playlistsContainer.appendChild(column);
        this.initColumnResizer(column);
        return column;
    }

    initColumnResizer(column, minW = 260, maxW = 800) {
        const resizer = column.querySelector('.column-resizer');
        if (!resizer) return;

        let startX = 0;
        let startWidth = 0;

        const onMouseMove = (e) => {
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(minW, Math.min(maxW, startWidth + deltaX));
            column.style.width = `${newWidth}px`;
            column.style.minWidth = `${newWidth}px`;
        };

        const onMouseUp = () => {
            resizer.classList.remove('resizing');
            document.body.classList.remove('resizing-col');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startWidth = column.getBoundingClientRect().width;
            resizer.classList.add('resizing');
            document.body.classList.add('resizing-col');
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    updatePlaylistPlaybackTime(playlistId, currentSecs, isPlaying) {
        if (!this.playlistsContainer) return;
        const column = this.playlistsContainer.querySelector(`.playlist-column[data-playlist-id="${playlistId}"]`);
        if (!column) return;
        const playbackBadge = column.querySelector('.playlist-playback-time');
        if (!playbackBadge) return;

        if (currentSecs !== null && currentSecs !== undefined) {
            playbackBadge.textContent = this.formatDuration(currentSecs);
            playbackBadge.classList.remove('hidden');
            if (isPlaying) {
                playbackBadge.classList.add('playing');
            } else {
                playbackBadge.classList.remove('playing');
            }
        } else {
            playbackBadge.classList.add('hidden');
            playbackBadge.classList.remove('playing');
        }
    }

    clearAllPlaylistPlaybackTimes() {
        if (!this.playlistsContainer) return;
        this.playlistsContainer.querySelectorAll('.playlist-playback-time').forEach(badge => {
            badge.classList.add('hidden');
            badge.classList.remove('playing');
        });
    }

    removePlaylistColumn(playlistId) {
        if (!this.playlistsContainer) return;
        const column = this.playlistsContainer.querySelector(`.playlist-column[data-playlist-id="${playlistId}"]`);
        if (column) {
            column.remove();
        }
    }

    updateTrackItem(trackId, isPlaying) {
        document.querySelectorAll('.track-item').forEach(el => {
            const indicator = el.querySelector('.play-indicator');
            if (el.dataset.trackId === trackId) {
                el.classList.add('active');
                if (isPlaying) {
                    el.classList.add('playing');
                    el.classList.remove('paused');
                    if (indicator) {
                        indicator.className = 'play-indicator equalizer';
                        indicator.innerHTML = '<span class="equalizer-bar"></span><span class="equalizer-bar"></span><span class="equalizer-bar"></span>';
                    }
                } else {
                    el.classList.remove('playing');
                    el.classList.add('paused');
                    if (indicator) {
                        indicator.className = 'play-indicator pause-icon';
                        indicator.innerHTML = '⏸';
                    }
                }
            } else {
                el.classList.remove('playing', 'paused', 'active');
                if (indicator) {
                    indicator.className = 'play-indicator';
                    indicator.innerHTML = '';
                }
            }
        });
    }

    scrollToTrack(trackId) {
        if (!trackId) return;
        const trackElement = document.querySelector(`.track-item[data-track-id="${trackId}"]`);
        if (!trackElement) return;

        // Se si trova in una playlist, scrolla orizzontalmente l'area playlist per mostrare la colonna
        const playlistColumn = trackElement.closest('.playlist-column');
        if (playlistColumn && this.playlistsContainer) {
            playlistColumn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }

        // Scrolla verticalmente il contenitore dei brani
        trackElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Aggiungi un effetto visivo temporaneo (flash/glow) per attirare l'attenzione
        trackElement.classList.add('track-focus-flash');
        setTimeout(() => {
            trackElement.classList.remove('track-focus-flash');
        }, 1500);
    }

    highlightDropZone(element, active) {
        if (active) {
            element.classList.add('drop-zone-active');
        } else {
            element.classList.remove('drop-zone-active');
        }
    }

    renderDropIndicator(container, y) {
        this.removeDropIndicator();
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.top = `${y}px`;
        container.appendChild(indicator);
    }

    removeDropIndicator() {
        document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    }
}
