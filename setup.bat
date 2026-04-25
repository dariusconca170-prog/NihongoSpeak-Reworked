@echo off
REM NihongoSpeak Setup Script
REM Run this to install all dependencies and set up the app

echo ============================================
echo NihongoSpeak Setup
echo ============================================
echo.

REM Check if Node.js is installed
echo [1/5] Checking for Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Please install from https://nodejs.org
    pause
    exit /b 1
)
echo Node.js found: 
node --version

REM Check for SoX and install if needed
echo.
echo [2/5] Checking for SoX (audio recording)...
where sox >nul 2>&1
if %errorlevel% neq 0 (
    echo SoX not found. Attempting to install via Chocolatey...
    where choco >nul 2>&1
    if %errorlevel% equ 0 (
        choco install sox -y
    ) else (
        echo WARNING: Could not install SoX automatically.
        echo Please install SoX manually from: https://sox.sourceforge.net/
        echo Or install Chocolatey from: https://chocolatey.org/
        echo Voice recording will not work without SoX.
    )
) else (
    echo SoX found.
)

REM Install edge-tts globally
echo.
echo [3/5] Installing edge-tts (text-to-speech)...
call npm install -g edge-tts
if %errorlevel% neq 0 (
    echo WARNING: edge-tts installation failed. TTS may not work.
    echo Try: npm install -g edge-tts
)

REM Install npm dependencies
echo.
echo [4/5] Installing app dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)
echo Dependencies installed.

REM Create sessions folder
echo.
echo [5/5] Creating settings folder...
if not exist "%USERPROFILE%\.nihongo_sensei" (
    mkdir "%USERPROFILE%\.nihongo_sensei"
)
if not exist "%USERPROFILE%\.nihongo_sensei\sessions" (
    mkdir "%USERPROFILE%\.nihongo_sensei\sessions"
)
echo Setup complete!

echo.
echo ============================================
echo Next steps:
echo 1. Double-click run.bat
echo 2. Go to Settings tab
echo 3. Enter your Groq API key
echo    Get free key at: https://console.groq.com
echo ============================================
echo.

pause