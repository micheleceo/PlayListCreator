@echo off
title Compilazione PlayListCreator Executable
color 0A
echo ============================================================
echo   COMPILAZIONE ESEGUIBILE PLAYLISTCREATOR
echo ============================================================
echo.

:: Vai alla cartella dove risiede lo script .bat
cd /d "%~dp0"

echo [1/3] Configurazione SSL e ambiente Node.js...
set NODE_TLS_REJECT_UNAUTHORIZED=0

echo.
echo [2/3] Avvio della build dell'eseguibile portatile Windows...
echo Attendere qualche secondo...
echo.

call npx electron-builder --win portable

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo   BUILD COMPLETATA CON SUCCESSO!
    echo ============================================================
    echo.
    echo L'eseguibile e' stato generato nella cartella:
    echo %~dp0dist\
    echo.
    echo File generati:
    echo  - PlayListCreator 1.0.0.exe (Eseguibile Portatile Singolo)
    echo  - Cartella win-unpacked/PlayListCreator.exe
    echo.
) else (
    echo.
    echo ============================================================
    echo   ERRORE DURANTE LA COMPILAZIONE
    echo ============================================================
    echo.
    echo Verificare i messaggi d'errore mostrati sopra.
    echo.
)

pause
