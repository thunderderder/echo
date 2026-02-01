@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Redirect errors to see what's happening
if "%1"=="" (
    echo ========================================
    echo Starting services...
    echo ========================================
    echo Current directory: %CD%
    echo Script location: %~dp0
    echo.
)

REM If running from explorer (double-click), keep window open on error
if "%1"=="" set "KEEP_OPEN=1"

REM Check if npm is available and find its full path
set "NPM_CMD="
set "NPM_DIR="
where npm >nul 2>&1
if errorlevel 1 (
    echo Checking npm installation...
    REM Try to find npm in common Node.js installation paths
    for %%P in ("%ProgramFiles%\nodejs\npm.cmd" "%ProgramFiles(x86)%\nodejs\npm.cmd" "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" "%APPDATA%\npm\npm.cmd") do (
        if exist %%P (
            echo Found npm at: %%P
            set "NPM_CMD=%%P"
            set "NPM_DIR=%%~dpP"
            set "PATH=%%~dpP;%PATH%"
            goto :npm_found
        )
    )
    REM Try to find npm using where command
    for /f "delims=" %%i in ('where /r "%ProgramFiles%" npm.cmd 2^>nul') do (
        if exist "%%i" (
            echo Found npm at: %%i
            set "NPM_CMD=%%i"
            set "NPM_DIR=%%~dpi"
            set "PATH=%%~dpi;%PATH%"
            goto :npm_found
        )
    )
    REM Try to find npm in user's PATH from registry or common locations
    for /f "delims=" %%i in ('where npm.cmd 2^>nul') do (
        if exist "%%i" (
            echo Found npm at: %%i
            set "NPM_CMD=%%i"
            set "NPM_DIR=%%~dpi"
            set "PATH=%%~dpi;%PATH%"
            goto :npm_found
        )
    )
    echo.
    echo ========================================
    echo Error: npm not found in PATH
    echo ========================================
    echo Please ensure Node.js is installed and npm is in your PATH.
    echo You can:
    echo 1. Install Node.js from https://nodejs.org/
    echo 2. Or add Node.js installation directory to your PATH environment variable
    echo 3. Or restart your terminal/command prompt after installing Node.js
    echo.
    pause
    exit /b 1
) else (
    REM npm is in PATH, find its full path and directory
    for /f "delims=" %%i in ('where npm.cmd 2^>nul') do (
        set "NPM_CMD=%%i"
        set "NPM_DIR=%%~dpi"
        goto :npm_found
    )
)
:npm_found
if not defined NPM_CMD (
    echo.
    echo ========================================
    echo ERROR: Could not determine npm path
    echo ========================================
    echo This should not happen. Please check the script.
    if defined KEEP_OPEN pause
    exit /b 1
)
REM Verify that the npm file actually exists
if not exist "%NPM_CMD%" (
    echo.
    echo ========================================
    echo ERROR: npm file not found at: %NPM_CMD%
    echo ========================================
    if defined KEEP_OPEN pause
    exit /b 1
)
echo Using npm at: %NPM_CMD%

REM Find node.exe location (npm requires node to run)
set "NODE_DIR="
where node >nul 2>&1
if errorlevel 1 (
    echo Checking node installation...
    REM Try to find node in common installation paths
    for %%P in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LOCALAPPDATA%\Programs\nodejs\node.exe") do (
        if exist %%P (
            echo Found node at: %%P
            set "NODE_DIR=%%~dpP"
            goto :node_found
        )
    )
    REM Try to find node in npm directory's parent or sibling directories
    if defined NPM_DIR (
        for %%P in ("%NPM_DIR%..\nodejs\node.exe" "%NPM_DIR%..\..\nodejs\node.exe" "%NPM_DIR%nodejs\node.exe") do (
            if exist %%P (
                echo Found node at: %%P
                set "NODE_DIR=%%~dpP"
                goto :node_found
            )
        )
    )
    echo Warning: Could not find node.exe, npm may not work properly
) else (
    REM node is in PATH, find its directory
    for /f "delims=" %%i in ('where node.exe 2^>nul') do (
        set "NODE_DIR=%%~dpi"
        goto :node_found
    )
)
:node_found
if defined NODE_DIR (
    echo Using node from: %NODE_DIR%
    REM Update PATH to include node directory
    set "PATH=%NODE_DIR%;%PATH%"
) else (
    echo Warning: node.exe directory not found, trying to find it...
    REM Last attempt: search in common nvm locations
    for /f "delims=" %%i in ('where node.exe 2^>nul') do (
        if exist "%%i" (
            set "NODE_DIR=%%~dpi"
            set "PATH=%%~dpi;%PATH%"
            echo Found node at: %%i
            goto :node_found_ok
        )
    )
    echo Warning: node.exe not found in PATH, npm may fail
)
:node_found_ok

REM Check virtual environment
if not exist "hi\Scripts\activate.bat" (
    echo Error: Virtual environment not found
    echo Please run: python -m venv hi
    pause
    exit /b 1
)

REM Check node_modules
if not exist "node_modules" (
    echo Installing frontend dependencies...
    call "%NPM_CMD%" install
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Check package.json
if not exist "package.json" (
    echo Error: package.json not found
    pause
    exit /b 1
)

echo Starting backend service (FastAPI) with reload mode...
start "Backend - FastAPI" cmd /k "cd /d %~dp0 && hi\Scripts\activate.bat && uvicorn server:app --host 0.0.0.0 --port 3001 --reload"

REM Wait for backend to start
ping 127.0.0.1 -n 4 >nul

echo Starting frontend service (Vite)...
REM Build PATH for new window: include node directory, npm directory, and current PATH
set "FRONTEND_PATH="
if defined NODE_DIR (
    set "FRONTEND_PATH=%NODE_DIR%;"
    echo Adding node directory to PATH: %NODE_DIR%
)
if defined NPM_DIR (
    set "FRONTEND_PATH=%FRONTEND_PATH%%NPM_DIR%;"
    echo Adding npm directory to PATH: %NPM_DIR%
)
set "FRONTEND_PATH=%FRONTEND_PATH%%PATH%"
if not defined FRONTEND_PATH (
    echo Error: Failed to build FRONTEND_PATH
    pause
    exit /b 1
)
REM Use a temporary batch file to ensure PATH is set correctly in new window
set "TEMP_BAT=%TEMP%\start_frontend_%~n0.bat"
(
    echo @echo off
    echo cd /d "%~dp0"
    echo set "PATH=%FRONTEND_PATH%"
    echo "%NPM_CMD%" run dev
) > "%TEMP_BAT%"
if not exist "%TEMP_BAT%" (
    echo Error: Failed to create temporary batch file
    pause
    exit /b 1
)
start "Frontend - Vite" cmd /k "%TEMP_BAT%"

echo.
echo ========================================
echo Services started!
echo ========================================
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Check the new windows for service status
echo.
echo Press any key to close this window...
pause >nul
endlocal
