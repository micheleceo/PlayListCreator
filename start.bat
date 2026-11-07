@echo off
title PlayListCreator - Avvio
color 0B
echo ============================================================
echo   PLAYLISTCREATOR - AVVIO APPLICAZIONE
echo ============================================================
echo.

:: Vai alla cartella dove risiede lo script .bat
cd /d "%~dp0"

:: Verifica che node_modules esista
if not exist "node_modules" (
    echo [!] node_modules non trovato. Installazione dipendenze in corso...
    echo.
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERRORE] Installazione dipendenze fallita.
        echo Verificare che Node.js sia installato correttamente.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dipendenze installate con successo.
    echo.
)

echo [>>] Avvio PlayListCreator...
echo.

call npm start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ============================================================
    echo   ERRORE DURANTE L'AVVIO
    echo ============================================================
    echo.
    echo Verificare i messaggi d'errore mostrati sopra.
    echo.
    pause
)
