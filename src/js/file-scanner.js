export async function scanFolder(folderPath) {
    return await window.api.scanFolder(folderPath);
}

export function categorizeTracksBySubfolder(scanResult) {
    const libraryTracks = [];
    const playlistGroupsMap = new Map();

    // Maintain insertion order from scanResult.tracks (which respects .m3u ordering if present)
    for (const track of scanResult.tracks) {
        if (!track.subfolder) {
            libraryTracks.push(track);
        } else {
            if (!playlistGroupsMap.has(track.subfolder)) {
                playlistGroupsMap.set(track.subfolder, { name: track.subfolder, tracks: [] });
            }
            playlistGroupsMap.get(track.subfolder).tracks.push(track);
        }
    }

    return {
        libraryTracks,
        playlistGroups: Array.from(playlistGroupsMap.values())
    };
}
