// ============================================================================
// preload.js — Script di preload per PlayListCreator
// Espone un'API sicura al renderer tramite contextBridge.
// Nessun modulo Node.js è accessibile direttamente dal renderer.
// ============================================================================

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /**
   * Ottiene il percorso locale di un file/cartella trascinato nel browser via webUtils.
   * @param {File} file - Oggetto File del browser
   * @returns {string} Percorso assoluto su filesystem
   */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  /**
   * Scansiona ricorsivamente una cartella per file MP3 e ne legge i metadati.
   * @param {string} folderPath - Percorso assoluto della cartella
   * @returns {Promise<{rootPath: string, tracks: Array, existingPlaylists: Array}>}
   */
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),

  /**
   * Salva una playlist: sposta i file nella sottocartella e genera il file M3U.
   * @param {Object} data - { name, tracks, basePath, originalFolderName }
   * @returns {Promise<{success: boolean, newPaths: Array, m3uPath: string}>}
   */
  savePlaylist: (data) => ipcRenderer.invoke('save-playlist', data),

  /**
   * Elimina una sottocartella playlist e tutto il suo contenuto.
   * @param {Object} data - { path: string }
   * @returns {Promise<{success: boolean}>}
   */
  deletePlaylistFolder: (data) => ipcRenderer.invoke('delete-playlist-folder', data),

  /**
   * Rinomina una sottocartella playlist e il file .m3u su disco.
   * @param {Object} data - { basePath: string, oldName: string, newName: string }
   * @returns {Promise<{success: boolean, renamed: boolean}>}
   */
  renamePlaylistFolder: (data) => ipcRenderer.invoke('rename-playlist-folder', data),

  /**
   * Sposta un singolo file (con eventuale .txt associato).
   * @param {Object} data - { source: string, destination: string }
   * @returns {Promise<{success: boolean, newPath: string}>}
   */
  moveFile: (data) => ipcRenderer.invoke('move-file', data),

  /**
   * Apre il dialogo nativo di selezione cartella.
   * @returns {Promise<string|null>} Percorso selezionato o null se annullato
   */
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  /**
   * Recupera metadati ID3 e contenuto del file .txt associato per un brano.
   * @param {string} filePath - Percorso del file MP3
   * @returns {Promise<{id3: Object, txtContent: string|null, fileName: string, filePath: string}>}
   */
  getTrackDetails: (filePath) => ipcRenderer.invoke('get-track-details', filePath),

  /**
   * Converte un percorso assoluto in URL file:// per la riproduzione audio.
   * @param {string} filePath - Percorso assoluto del file
   * @returns {Promise<string>} URL file://
   */
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),

  /**
   * Registra un callback per quando una cartella viene trascinata sulla finestra.
   * @param {function(string): void} callback - Funzione chiamata con il percorso della cartella
   */
  onFolderDropped: (callback) => {
    ipcRenderer.on('folder-dropped', (_event, folderPath) => callback(folderPath));
  }
});
