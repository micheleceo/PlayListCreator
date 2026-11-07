export class AudioPlayer {
    constructor(uiElements) {
        this.audio = new Audio();
        this.ui = uiElements;
        this.currentTrack = null;
        this.contextTracks = [];
        this.isPlaying = false;

        this.setupListeners();
    }

    setupListeners() {
        this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.audio.addEventListener('ended', () => this.onTrackEnd());
        this.audio.addEventListener('play', () => this.onPlayStateChange(true));
        this.audio.addEventListener('pause', () => this.onPlayStateChange(false));

        if (this.ui.playButton) {
            this.ui.playButton.addEventListener('click', () => {
                if (this.isPlaying) this.pause();
                else if (this.currentTrack) this.resume();
            });
        }
        
        if (this.ui.progressBar) {
            this.ui.progressBar.addEventListener('click', (e) => {
                const rect = this.ui.progressBar.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                this.seek(Math.max(0, Math.min(1, pos)));
            });
        }
        
        if (this.ui.nextButton) {
            this.ui.nextButton.addEventListener('click', () => this.next());
        }
        
        if (this.ui.stopButton) {
            this.ui.stopButton.addEventListener('click', () => this.stop());
        }
    }

    setContext(tracks) {
        this.contextTracks = tracks;
    }

    async play(track) {
        if (!track) return;
        
        if (this.currentTrack && this.currentTrack.id === track.id) {
            if (!this.isPlaying) {
                await this.audio.play();
            }
            return;
        }

        try {
            this.currentTrack = track;
            const url = await window.api.getFileUrl(track.path);
            this.audio.src = url;
            await this.audio.play();
            this.updateTrackInfo();
        } catch (error) {
            console.error('Error playing track:', error);
        }
    }

    pause() {
        this.audio.pause();
    }

    resume() {
        if (this.currentTrack) {
            this.audio.play();
        }
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.currentTrack = null;
        if (this.ui.progressBarFill) this.ui.progressBarFill.style.width = '0%';
        if (this.ui.currentTimeDisplay) this.ui.currentTimeDisplay.textContent = '00:00';
        if (this.ui.trackTitle) this.ui.trackTitle.textContent = 'Nessun brano';
        if (this.ui.trackArtist) this.ui.trackArtist.textContent = '-';
        if (this.ui.durationDisplay) this.ui.durationDisplay.textContent = '00:00';
        this.onPlayStateChange(false);
        window.dispatchEvent(new CustomEvent('player-timeupdate', {
            detail: {
                currentTime: 0,
                duration: 0,
                currentTrack: null
            }
        }));
    }

    next() {
        if (!this.currentTrack || !this.contextTracks.length) return;
        const currentIndex = this.contextTracks.findIndex(t => t.id === this.currentTrack.id);
        const nextIndex = (currentIndex + 1) % this.contextTracks.length;
        this.play(this.contextTracks[nextIndex]);
    }

    previous() {
        if (!this.currentTrack || !this.contextTracks.length) return;
        
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        
        const currentIndex = this.contextTracks.findIndex(t => t.id === this.currentTrack.id);
        const prevIndex = (currentIndex - 1 + this.contextTracks.length) % this.contextTracks.length;
        this.play(this.contextTracks[prevIndex]);
    }

    seek(percentage) {
        if (this.audio.duration) {
            this.audio.currentTime = percentage * this.audio.duration;
        }
    }

    setVolume(level) {
        this.audio.volume = Math.max(0, Math.min(1, level));
    }

    updateTrackPath(trackId, newPath) {
        if (this.currentTrack && this.currentTrack.id === trackId) {
            this.currentTrack.path = newPath;
        }
    }

    onTimeUpdate() {
        if (!this.audio.duration) return;
        const progress = this.audio.currentTime / this.audio.duration;
        
        if (this.ui.progressBarFill) {
            this.ui.progressBarFill.style.width = `${progress * 100}%`;
        }
        
        if (this.ui.currentTimeDisplay) {
            this.ui.currentTimeDisplay.textContent = this.formatTime(this.audio.currentTime);
        }

        window.dispatchEvent(new CustomEvent('player-timeupdate', {
            detail: {
                currentTime: this.audio.currentTime,
                duration: this.audio.duration,
                currentTrack: this.currentTrack
            }
        }));
    }

    onTrackEnd() {
        window.dispatchEvent(new CustomEvent('track-end', { detail: { track: this.currentTrack } }));
        this.next();
    }

    onPlayStateChange(isPlaying) {
        this.isPlaying = isPlaying;
        if (this.ui.playButton) {
            if (isPlaying) {
                this.ui.playButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="play-icon"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
            } else {
                this.ui.playButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="play-icon"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            }
        }
        const eventName = isPlaying ? 'track-play' : 'track-pause';
        window.dispatchEvent(new CustomEvent(eventName, { detail: { track: this.currentTrack } }));
    }

    updateTrackInfo() {
        if (!this.currentTrack) return;
        if (this.ui.trackTitle) {
            this.ui.trackTitle.textContent = this.currentTrack.title || this.currentTrack.fileName;
        }
        if (this.ui.trackArtist) {
            this.ui.trackArtist.textContent = this.currentTrack.artist || 'Artista sconosciuto';
        }
        if (this.ui.durationDisplay) {
            this.ui.durationDisplay.textContent = this.formatTime(this.currentTrack.duration);
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}
