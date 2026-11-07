// ============================================================================
// main.js — Processo principale Electron per PlayListCreator
// Gestisce la finestra dell'app, gli handler IPC e le operazioni su filesystem.
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================================
// Variabili globali
// ============================================================================

/** @type {BrowserWindow|null} Finestra principale dell'applicazione */
let mainWindow = null;

// ============================================================================
// Creazione della finestra principale
// ============================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Necessario per caricare file audio locali tramite file://
      webSecurity: false
    },
    // Icona e titolo dell'app
    title: 'PlayList Creator',
    show: false // Mostra solo quando è pronta per evitare flash bianco
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Mostra la finestra quando il contenuto è pronto
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Apri DevTools in modalità sviluppo
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// Ciclo di vita dell'app
// ============================================================================

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers();

  app.on('activate', () => {
    // Su macOS ricreare la finestra se l'icona nel dock viene cliccata
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Su macOS l'app resta attiva finché l'utente non esce esplicitamente
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================================
// Utilità per il filesystem
// ============================================================================

/**
 * Raccoglie ricorsivamente tutti i file .mp3 in una cartella.
 * @param {string} dirPath - Percorso della cartella da scansionare
 * @param {string[]} [fileList=[]] - Accumulatore interno
 * @returns {string[]} Lista di percorsi assoluti dei file MP3 trovati
 */
function collectMp3Files(dirPath, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Errore nella lettura della cartella "${dirPath}":`, err.message);
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectMp3Files(fullPath, fileList);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

/**
 * Legge i metadati ID3 da un file MP3.
 * Se la lettura fallisce, restituisce valori di fallback basati sul nome file.
 * @param {string} filePath - Percorso assoluto del file MP3
 * @returns {Promise<{title: string, artist: string, album: string, duration: number}>}
 */
async function readMp3Metadata(filePath) {
  const fileName = path.basename(filePath, '.mp3');

  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath, { duration: true });
    const common = metadata.common || {};
    const format = metadata.format || {};

    return {
      title: common.title || fileName,
      artist: common.artist || 'Unknown',
      album: common.album || '',
      duration: Math.round(format.duration || 0)
    };
  } catch (err) {
    console.warn(`Impossibile leggere i metadati di "${filePath}":`, err.message);
    return {
      title: fileName,
      artist: 'Unknown',
      album: '',
      duration: 0
    };
  }
}

/**
 * Sposta un file da sorgente a destinazione.
 * Usa fs.rename come primo tentativo; se fallisce (es. dispositivi diversi),
 * esegue copia + cancellazione.
 * @param {string} source - Percorso sorgente
 * @param {string} destination - Percorso destinazione
 */
async function moveFile(source, destination) {
  try {
    await fs.promises.rename(source, destination);
  } catch (err) {
    // Fallback per spostamenti tra dispositivi diversi (EXDEV)
    if (err.code === 'EXDEV') {
      await fs.promises.copyFile(source, destination);
      await fs.promises.unlink(source);
    } else {
      throw err;
    }
  }
}

/**
 * Sposta un file MP3 e l'eventuale file .txt associato.
 * Il file .txt associato ha lo stesso nome con estensione .mp3.txt
 * @param {string} source - Percorso sorgente del file MP3
 * @param {string} destination - Percorso destinazione del file MP3
 */
async function moveFileWithAssociatedTxt(source, destination) {
  // Sposta il file principale
  await moveFile(source, destination);

  // Cerca e sposta il file .txt associato (es. "brano.mp3.txt")
  const txtSource = source + '.txt';
  const txtDest = destination + '.txt';

  try {
    await fs.promises.access(txtSource, fs.constants.F_OK);
    await moveFile(txtSource, txtDest);
  } catch {
    // Il file .txt non esiste, nessun problema
  }
}

/**
 * Cancella una cartella e tutto il suo contenuto (ricorsivamente).
 * @param {string} dirPath - Percorso della cartella da eliminare
 */
async function deleteDirectoryRecursive(dirPath) {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
}

/**
 * Genera il contenuto di un file M3U a partire dalle tracce.
 * @param {Array<{fileName: string, duration: number, artist: string, title: string}>} tracks
 * @returns {string} Contenuto del file M3U
 */
function generateM3uContent(tracks) {
  let content = '#EXTM3U\n';

  for (const track of tracks) {
    const duration = track.duration || 0;
    const artist = track.artist || 'Unknown';
    const title = track.title || track.fileName;
    const mp3FileName = track.fileName.endsWith('.mp3')
      ? track.fileName
      : track.fileName + '.mp3';

    content += `#EXTINF:${duration},${artist} - ${title}\n`;
    content += `./${mp3FileName}\n`;
  }

  return content;
}

// ============================================================================
// Registrazione degli handler IPC
// ============================================================================

function registerIpcHandlers() {
  // --------------------------------------------------------------------------
  // scan-folder: Scansiona ricorsivamente una cartella per file MP3
  // --------------------------------------------------------------------------
  ipcMain.handle('scan-folder', async (_event, folderPath) => {
    try {
      // Verifica che il percorso esista e sia una cartella
      const stats = await fs.promises.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new Error(`Il percorso non è una cartella: ${folderPath}`);
      }

      // Raccogli tutti i file MP3
      const mp3Files = collectMp3Files(folderPath);

      // Identifica tutte le sottocartelle esistenti ricorsivamente (potenziali playlist)
      function collectSubdirectories(currentPath) {
        const subdirs = [];
        let list;
        try {
          list = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
          return subdirs;
        }
        for (const entry of list) {
          if (entry.isDirectory()) {
            const fullSubPath = path.join(currentPath, entry.name);
            const relSubPath = path.relative(folderPath, fullSubPath).split(path.sep).join('/');
            subdirs.push({
              name: relSubPath,
              path: fullSubPath
            });
            subdirs.push(...collectSubdirectories(fullSubPath));
          }
        }
        return subdirs;
      }

      const existingPlaylists = collectSubdirectories(folderPath);

      // Leggi i metadati di ogni MP3 in parallelo (con limite di concorrenza)
      const tracks = [];
      const BATCH_SIZE = 10; // Limita la concorrenza per non sovraccaricare il disco

      for (let i = 0; i < mp3Files.length; i += BATCH_SIZE) {
        const batch = mp3Files.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (filePath) => {
            const meta = await readMp3Metadata(filePath);

            // Calcola la sottocartella relativa (null se nella root)
            const relativePath = path.relative(folderPath, filePath);
            const relativeDir = path.dirname(relativePath);
            // Se il file è direttamente nella root, dirname sarà "."
            const subfolder = relativeDir === '.' ? null : relativeDir.split(path.sep).join('/');

            return {
              id: crypto.randomUUID(),
              path: filePath,
              fileName: path.basename(filePath, '.mp3'),
              title: meta.title,
              artist: meta.artist,
              album: meta.album,
              duration: meta.duration,
              subfolder: subfolder
            };
          })
        );
        tracks.push(...batchResults);
      }

      // Ordina i brani in ciascuna sottocartella in base al file .m3u se presente
      for (const pl of existingPlaylists) {
        const m3uFilePath = path.join(pl.path, `${path.basename(pl.path)}.m3u`);
        try {
          if (fs.existsSync(m3uFilePath)) {
            const m3uContent = fs.readFileSync(m3uFilePath, 'utf-8');
            const lines = m3uContent.split('\n');
            const orderedFileNames = [];
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('#EXTINF:')) {
                const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
                if (nextLine && !nextLine.startsWith('#')) {
                  const cleaned = path.basename(nextLine.replace('./', '').replace(/\\/g, '/'), '.mp3');
                  orderedFileNames.push(cleaned.toLowerCase());
                }
              }
            }
            if (orderedFileNames.length > 0) {
              // Re-sort matching tracks in-place inside tracks array
              const plTrackIndices = [];
              const plTracksToOrder = [];
              
              tracks.forEach((t, idx) => {
                if (t.subfolder === pl.name) {
                  plTrackIndices.push(idx);
                  plTracksToOrder.push(t);
                }
              });

              plTracksToOrder.sort((a, b) => {
                const indexA = orderedFileNames.indexOf(a.fileName.toLowerCase());
                const indexB = orderedFileNames.indexOf(b.fileName.toLowerCase());
                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return 0;
              });

              plTrackIndices.forEach((origIdx, i) => {
                tracks[origIdx] = plTracksToOrder[i];
              });
            }
          }
        } catch (err) {
          console.warn(`Impossibile leggere il file M3U per la playlist "${pl.name}":`, err.message);
        }
      }

      return {
        rootPath: folderPath,
        tracks,
        existingPlaylists
      };
    } catch (err) {
      console.error('Errore durante la scansione della cartella:', err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // save-playlist: Salva una playlist, spostando i file nella sottocartella
  // --------------------------------------------------------------------------
  ipcMain.handle('save-playlist', async (_event, data) => {
    const { name, tracks, basePath, originalFolderName } = data;

    try {
      const targetDir = path.join(basePath, name);

      // Se il nome è cambiato rispetto all'originale, rinomina la cartella e il vecchio file M3U se presente
      if (originalFolderName && originalFolderName !== name) {
        const oldDir = path.join(basePath, originalFolderName);
        try {
          const oldStats = await fs.promises.stat(oldDir);
          if (oldStats.isDirectory()) {
            await fs.promises.rename(oldDir, targetDir);
            
            // Rimuovi o rinomina il vecchio file M3U all'interno della cartella se rimasto col vecchio nome
            const oldM3uInTarget = path.join(targetDir, `${originalFolderName}.m3u`);
            try {
              await fs.promises.unlink(oldM3uInTarget);
            } catch (ignoreErr) {
              // Se non esiste, nessun problema
            }
          }
        } catch (err) {
          // La cartella originale non esiste, la creiamo dopo
          console.warn(`Cartella originale "${oldDir}" non trovata, verrà creata una nuova.`);
        }
      }

      // Crea la cartella di destinazione se non esiste
      await fs.promises.mkdir(targetDir, { recursive: true });

      // Sposta ogni traccia nella sottocartella
      const newPaths = [];

      for (const track of tracks) {
        const sourceFile = track.path;
        const mp3FileName = path.basename(sourceFile);
        const destFile = path.join(targetDir, mp3FileName);

        // Sposta solo se il file non è già nella posizione corretta
        if (path.normalize(sourceFile) !== path.normalize(destFile)) {
          // Verifica che il file sorgente esista
          try {
            await fs.promises.access(sourceFile, fs.constants.F_OK);
            await moveFileWithAssociatedTxt(sourceFile, destFile);
          } catch (err) {
            console.warn(`Impossibile spostare "${sourceFile}":`, err.message);
          }
        }

        newPaths.push({
          id: track.id,
          oldPath: sourceFile,
          newPath: destFile
        });
      }

      // Genera e salva il file M3U nella sottocartella
      const m3uPath = path.join(targetDir, `${name}.m3u`);
      const m3uContent = generateM3uContent(
        tracks.map(t => ({
          fileName: path.basename(t.path),
          duration: t.duration || 0,
          artist: t.artist || 'Unknown',
          title: t.title || t.fileName
        }))
      );
      await fs.promises.writeFile(m3uPath, m3uContent, 'utf-8');

      return { success: true, newPaths, m3uPath };
    } catch (err) {
      console.error('Errore durante il salvataggio della playlist:', err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // delete-playlist-folder: Elimina una sottocartella playlist
  // --------------------------------------------------------------------------
  ipcMain.handle('delete-playlist-folder', async (_event, data) => {
    const { path: folderPath } = data;

    try {
      // Verifica che il percorso esista prima di eliminarlo
      try {
        const stats = await fs.promises.stat(folderPath);
        if (stats.isDirectory()) {
          await deleteDirectoryRecursive(folderPath);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      return { success: true };
    } catch (err) {
      console.error(`Errore durante l'eliminazione della cartella "${folderPath}":`, err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // move-file: Sposta un singolo file (con eventuale .txt associato)
  // --------------------------------------------------------------------------
  ipcMain.handle('move-file', async (_event, data) => {
    const { source, destination } = data;

    try {
      // Crea la cartella di destinazione se necessario
      const destDir = path.dirname(destination);
      await fs.promises.mkdir(destDir, { recursive: true });

      await moveFileWithAssociatedTxt(source, destination);
      return { success: true, newPath: destination };
    } catch (err) {
      console.error(`Errore durante lo spostamento del file "${source}":`, err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // rename-playlist-folder: Rinomina la cartella della playlist e il file .m3u su disco
  // --------------------------------------------------------------------------
  ipcMain.handle('rename-playlist-folder', async (_event, data) => {
    const { basePath, oldName, newName } = data;
    if (!basePath || !oldName || !newName || oldName === newName) {
      return { success: false, renamed: false };
    }

    try {
      const oldDir = path.join(basePath, oldName);
      const targetDir = path.join(basePath, newName);

      const oldStats = await fs.promises.stat(oldDir).catch(() => null);
      if (!oldStats || !oldStats.isDirectory()) {
        return { success: true, renamed: false, message: 'La cartella di origine non esiste su disco' };
      }

      // Rinomina la cartella
      await fs.promises.rename(oldDir, targetDir);

      // Rinomina il file .m3u se presente all'interno della cartella rinominata
      const oldM3uPath = path.join(targetDir, `${oldName}.m3u`);
      const newM3uPath = path.join(targetDir, `${newName}.m3u`);
      try {
        const m3uStats = await fs.promises.stat(oldM3uPath).catch(() => null);
        if (m3uStats && m3uStats.isFile()) {
          await fs.promises.rename(oldM3uPath, newM3uPath);
        }
      } catch (m3uErr) {
        console.warn(`Impossibile rinominare il file M3U da "${oldM3uPath}" a "${newM3uPath}":`, m3uErr);
      }

      return { success: true, renamed: true, oldDir, targetDir };
    } catch (err) {
      console.error(`Errore durante la ridenominazione della cartella da "${oldName}" a "${newName}":`, err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // get-track-details: Legge sia metadati ID3 estesi che il file .txt associato
  // --------------------------------------------------------------------------
  ipcMain.handle('get-track-details', async (_event, filePath) => {
    try {
      const fileName = path.basename(filePath, '.mp3');
      let id3 = {
        title: fileName,
        artist: 'Sconosciuto',
        album: '-',
        genre: '-',
        year: '-',
        duration: 0,
        bitrate: '-',
        sampleRate: '-',
        channels: '-',
        format: 'MP3'
      };

      try {
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(filePath, { duration: true });
        const common = metadata.common || {};
        const format = metadata.format || {};

        id3 = {
          title: common.title || fileName,
          artist: common.artist || 'Sconosciuto',
          album: common.album || '-',
          genre: common.genre ? common.genre.join(', ') : '-',
          year: common.year || common.date || '-',
          duration: Math.round(format.duration || 0),
          bitrate: format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : '-',
          sampleRate: format.sampleRate ? `${format.sampleRate} Hz` : '-',
          channels: format.numberOfChannels || '-',
          format: format.container || 'MP3',
          track: common.track && common.track.no ? `${common.track.no}/${common.track.of || '-'}` : '-',
          disk: common.disk && common.disk.no ? `${common.disk.no}/${common.disk.of || '-'}` : '-'
        };
      } catch (err) {
        console.warn(`Impossibile leggere ID3 estesi di "${filePath}":`, err.message);
      }

      // Leggi eventuale file .txt associato ("brano.mp3.txt")
      let txtContent = null;
      const txtPath = filePath + '.txt';

      try {
        if (fs.existsSync(txtPath)) {
          txtContent = await fs.promises.readFile(txtPath, 'utf-8');
        }
      } catch (err) {
        console.warn(`Impossibile leggere file .txt associato "${txtPath}":`, err.message);
      }

      return {
        filePath,
        fileName: path.basename(filePath),
        id3,
        txtContent
      };
    } catch (err) {
      console.error(`Errore nel recupero dettagli traccia "${filePath}":`, err);
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // select-folder: Apre il dialogo nativo di selezione cartella
  // --------------------------------------------------------------------------
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleziona la cartella con i file MP3'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // --------------------------------------------------------------------------
  // get-file-url: Converte un percorso assoluto in URL file:// per l'audio
  // --------------------------------------------------------------------------
  ipcMain.handle('get-file-url', async (_event, filePath) => {
    try {
      // Normalizza il percorso e convertilo in URL file://
      const normalizedPath = path.resolve(filePath);
      // Usa pathToFileURL per una conversione corretta (gestisce spazi e caratteri speciali)
      const { pathToFileURL } = require('url');
      return pathToFileURL(normalizedPath).href;
    } catch (err) {
      console.error(`Errore nella conversione del percorso "${filePath}" in URL:`, err);
      throw err;
    }
  });
}
