export class DragDropManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.draggedTracks = [];
        this.sourcePlaylistId = null;
        this.initTrackDragging();
        this.initDropZones();
    }

    initFolderDrop(dropZoneElement) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZoneElement.addEventListener(eventName, e => e.preventDefault());
        });

        dropZoneElement.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                let folderPath = null;
                if (window.api && window.api.getPathForFile) {
                    folderPath = window.api.getPathForFile(files[0]);
                } else {
                    folderPath = files[0].path;
                }
                
                if (folderPath) {
                    this.callbacks.onFolderDrop(folderPath);
                }
            }
        });
    }

    initTrackDragging() {
        document.addEventListener('dragstart', (e) => {
            const trackItem = e.target.closest('.track-item');
            if (!trackItem) return;

            const trackId = trackItem.dataset.trackId;
            const playlistColumn = trackItem.closest('.playlist-column');
            this.sourcePlaylistId = playlistColumn ? playlistColumn.dataset.playlistId : null;

            if (this.callbacks.getSelectedTracks().has(trackId)) {
                this.draggedTracks = Array.from(this.callbacks.getSelectedTracks());
            } else {
                this.draggedTracks = [trackId];
            }

            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify(this.draggedTracks));

            // Ghost element visual for multiple tracks
            if (this.draggedTracks.length > 1) {
                const ghost = document.createElement('div');
                ghost.className = 'drag-ghost';
                ghost.textContent = `${this.draggedTracks.length} brani`;
                ghost.style.position = 'absolute';
                ghost.style.top = '-1000px';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                setTimeout(() => ghost.remove(), 0);
            }
        });

        document.addEventListener('dragend', () => {
            this.draggedTracks = [];
            this.sourcePlaylistId = null;
            document.querySelectorAll('.drop-zone').forEach(el => el.classList.remove('drag-over', 'drop-zone-active'));
        });
    }

    initDropZones() {
        document.addEventListener('dragover', e => {
            if (this.draggedTracks.length === 0) return;
            e.preventDefault();
            
            const dropZone = e.target.closest('.drop-zone');
            if (dropZone) {
                dropZone.classList.add('drag-over');
                dropZone.classList.add('drop-zone-active');
            }
        });

        document.addEventListener('dragleave', e => {
            const dropZone = e.target.closest('.drop-zone');
            if (dropZone) {
                dropZone.classList.remove('drag-over');
                dropZone.classList.remove('drop-zone-active');
            }
        });

        document.addEventListener('drop', e => {
            if (this.draggedTracks.length === 0) return;
            e.preventDefault();

            const dropZone = e.target.closest('.drop-zone');
            if (!dropZone) return;
            dropZone.classList.remove('drag-over', 'drop-zone-active');

            // Detect if target is library or playlist
            const libraryContainer = e.target.closest('.library-column');
            const targetPlaylist = e.target.closest('.playlist-column');
            const targetPlaylistId = targetPlaylist ? targetPlaylist.dataset.playlistId : null;

            const trackItem = e.target.closest('.track-item');
            
            this.draggedTracks.forEach(trackId => {
                if (libraryContainer) {
                    this.callbacks.onTrackMoveToLibrary(trackId);
                } else if (targetPlaylistId) {
                    if (this.sourcePlaylistId === targetPlaylistId) {
                        // Reorder
                        if (trackItem) {
                            const newIndex = Array.from(dropZone.children).indexOf(trackItem);
                            this.callbacks.onTrackReorder(targetPlaylistId, trackId, newIndex);
                        }
                    } else {
                        // Move to playlist
                        this.callbacks.onTrackMoveToPlaylist(trackId, targetPlaylistId);
                    }
                }
            });
        });
    }

    initSortable(playlistElement) {
        // Handled naturally via initDropZones logic
    }

    refreshDraggables() {
        // Using event delegation, no explicit refresh needed
    }
}
