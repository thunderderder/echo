@echo off
cd /d "%~dp0"

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
    call npm install
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
start "Frontend - Vite" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo ========================================
echo Services started!
echo ========================================
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Check the new windows for service status
echo.
pause
