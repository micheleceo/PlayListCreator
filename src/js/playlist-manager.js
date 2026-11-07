export class PlaylistManager extends EventTarget {
    constructor(getState, setState) {
        super();
        this.getState = getState;
        this.setState = setState;
    }

    generateId() {
        return 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    }

    createPlaylist(name) {
        const state = this.getState();
        const newPlaylist = {
            id: this.generateId(),
            name: name,
            tracks: [],
            originalFolderName: null
        };
        state.playlists.push(newPlaylist);
        this.setState(state);
        this.dispatchEvent(new CustomEvent('playlist-created', { detail: { playlist: newPlaylist } }));
        return newPlaylist;
    }

    deletePlaylist(playlistId) {
        const state = this.getState();
        const index = state.playlists.findIndex(p => p.id === playlistId);
        if (index !== -1) {
            const playlist = state.playlists[index];
            // Move tracks back to library
            playlist.tracks.forEach(t => state.libraryTracks.push(t));
            state.playlists.splice(index, 1);
            this.setState(state);
            this.dispatchEvent(new CustomEvent('playlist-deleted', { detail: { playlistId } }));
        }
    }

    async renamePlaylist(playlistId, newName) {
        const state = this.getState();
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (!playlist || playlist.name === newName) return;

        const oldName = playlist.name;
        const originalFolder = playlist.originalFolderName || oldName;

        playlist.name = newName;

        // Se la cartella esiste già su disco, rinominiamo sia la cartella che il file .m3u
        if (state.rootPath && window.api && window.api.renamePlaylistFolder) {
            try {
                const res = await window.api.renamePlaylistFolder({
                    basePath: state.rootPath,
                    oldName: originalFolder,
                    newName: newName
                });

                if (res && res.renamed) {
                    playlist.originalFolderName = newName;

                    // Aggiorna i percorsi dei brani che si trovano in quella cartella
                    const oldDirPrefix = (state.rootPath + '\\' + originalFolder).toLowerCase();
                    const newDirPrefix = state.rootPath + '\\' + newName;

                    playlist.tracks.forEach(t => {
                        if (t.path && t.path.toLowerCase().startsWith(oldDirPrefix)) {
                            const relativePart = t.path.slice(oldDirPrefix.length);
                            t.path = newDirPrefix + relativePart;

                            const allT = state.allTracks.find(item => item.id === t.id);
                            if (allT) allT.path = t.path;
                        }
                    });
                }
            } catch (err) {
                console.error(`Errore durante la ridenominazione della playlist su disco:`, err);
            }
        }

        this.setState(state);
        this.dispatchEvent(new CustomEvent('playlist-renamed', { detail: { playlistId, newName, oldName } }));
    }

    getPlaylistForTrack(trackId) {
        const state = this.getState();
        return state.playlists.find(p => p.tracks.some(t => t.id === trackId)) || null;
    }

    moveTrackToPlaylist(trackId, targetPlaylistId) {
        const state = this.getState();
        const track = state.allTracks.find(t => t.id === trackId);
        if (!track) return;

        // Remove from current location (library or another playlist)
        state.libraryTracks = state.libraryTracks.filter(t => t.id !== trackId);
        state.playlists.forEach(p => {
            p.tracks = p.tracks.filter(t => t.id !== trackId);
        });

        // Add to target playlist
        const targetPlaylist = state.playlists.find(p => p.id === targetPlaylistId);
        if (targetPlaylist) {
            targetPlaylist.tracks.push(track);
            this.setState(state);
            this.dispatchEvent(new CustomEvent('track-moved', { detail: { trackId, targetPlaylistId } }));
        }
    }

    moveTrackToLibrary(trackId) {
        const state = this.getState();
        const track = state.allTracks.find(t => t.id === trackId);
        if (!track) return;

        state.playlists.forEach(p => {
            p.tracks = p.tracks.filter(t => t.id !== trackId);
        });
        
        if (!state.libraryTracks.find(t => t.id === trackId)) {
            state.libraryTracks.push(track);
        }
        
        this.setState(state);
        this.dispatchEvent(new CustomEvent('track-moved', { detail: { trackId, targetPlaylistId: null } }));
    }

    reorderTrack(playlistId, trackId, newIndex) {
        const state = this.getState();
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (playlist) {
            const oldIndex = playlist.tracks.findIndex(t => t.id === trackId);
            if (oldIndex !== -1) {
                const [track] = playlist.tracks.splice(oldIndex, 1);
                playlist.tracks.splice(newIndex, 0, track);
                this.setState(state);
                this.dispatchEvent(new CustomEvent('track-reordered', { detail: { playlistId, trackId, newIndex } }));
            }
        }
    }

    async savePlaylist(playlistId) {
        const state = this.getState();
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (!playlist || !state.rootPath) return null;

        try {
            const result = await window.api.savePlaylist({
                name: playlist.name,
                tracks: playlist.tracks,
                basePath: state.rootPath,
                originalFolderName: playlist.originalFolderName
            });
            
            // Update track paths in state
            if (result && result.newPaths) {
                result.newPaths.forEach(moved => {
                    const track = playlist.tracks.find(t => t.id === moved.id);
                    if (track) {
                        track.path = moved.newPath;
                    }
                    const allTrack = state.allTracks.find(t => t.id === moved.id);
                    if (allTrack) {
                        allTrack.path = moved.newPath;
                    }
                });
            }

            playlist.originalFolderName = playlist.name;
            
            this.dispatchEvent(new CustomEvent('playlist-saved', { detail: { playlistId, result } }));
            return result;
        } catch (error) {
            console.error('Error saving playlist:', error);
            throw error;
        }
    }

    async saveAllPlaylists() {
        const state = this.getState();
        const results = [];
        for (const playlist of state.playlists) {
            const res = await this.savePlaylist(playlist.id);
            results.push(res);
        }
        return results;
    }

    async deletePlaylistFromDisk(playlistId) {
        const state = this.getState();
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        if (state.rootPath) {
            // Physically move all tracks in this playlist to root folder
            for (const track of playlist.tracks) {
                const fileName = track.path.split(/[\\/]/).pop();
                const targetRootPath = state.rootPath + '\\' + fileName;
                
                if (track.path !== targetRootPath) {
                    try {
                        if (window.api && window.api.moveFile) {
                            await window.api.moveFile({ source: track.path, destination: targetRootPath });
                            track.path = targetRootPath;
                            const allTrack = state.allTracks.find(t => t.id === track.id);
                            if (allTrack) allTrack.path = targetRootPath;
                        }
                    } catch (err) {
                        console.error(`Errore nello spostamento del file "${track.path}" nella root:`, err);
                    }
                }
            }

            // If playlist was saved on disk as a folder, delete the folder
            const folderToDelete = playlist.name || playlist.originalFolderName;
            if (folderToDelete) {
                const folderPath = state.rootPath + '\\' + folderToDelete;
                try {
                    if (window.api && window.api.deletePlaylistFolder) {
                        await window.api.deletePlaylistFolder({ path: folderPath });
                    }
                } catch (err) {
                    console.warn(`Impossibile eliminare la cartella "${folderPath}":`, err);
                }
            }
        }

        this.deletePlaylist(playlistId);
    }
}
