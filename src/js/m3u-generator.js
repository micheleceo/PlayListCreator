export function generateM3U(tracks) {
    let content = '#EXTM3U\n';
    for (const track of tracks) {
        const duration = Math.round(track.duration || 0);
        const artist = track.artist || 'Sconosciuto';
        const title = track.title || track.fileName;
        content += `#EXTINF:${duration},${artist} - ${title}\n`;
        content += `./${track.fileName}\n`;
    }
    return content;
}

export function parseM3U(content) {
    const lines = content.split('\n');
    const tracks = [];
    // Basic parser for future use
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const fileLine = lines[i + 1] ? lines[i + 1].trim() : '';
            if (fileLine && !fileLine.startsWith('#')) {
                tracks.push({ fileName: fileLine.replace('./', '') });
            }
        }
    }
    return tracks;
}
