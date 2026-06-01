@echo off
title FolderSync Server
color 0A
cls

echo.
echo  ==========================================
echo   FOLDER SYNC - Starting Server...
echo  ==========================================
echo.

cd /d "%~dp0sync-server"

echo  Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 goto no_node
echo  [OK] Node.js found:
node --version
echo.
goto check_port

:no_node
echo  [ERROR] Node.js is NOT installed!
echo  Download from: https://nodejs.org/en/download/
echo.
pause
exit /b 1

:check_port
echo  Freeing port 3000...
node kill-port.js
timeout /t 2 /nobreak >nul
echo  [OK] Ready.
echo.

:firewall
echo  Configuring Windows Firewall...
netsh advfirewall firewall show rule name="FolderSync Port 3000" >nul 2>&1
if %errorlevel% equ 0 goto firewall_ok
netsh advfirewall firewall add rule name="FolderSync Port 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  [OK] Firewall rule added!
goto deps

:firewall_ok
echo  [OK] Firewall rule already exists.

:deps
echo.
if exist "node_modules" goto start
echo  Installing dependencies (first time only, please wait)...
call npm install
if %errorlevel% neq 0 goto npm_fail
echo  [OK] Dependencies installed!
echo.
goto start

:npm_fail
echo  [ERROR] npm install failed!
pause
exit /b 1

:start
echo  ==========================================
echo   SERVER RUNNING - DO NOT CLOSE THIS WINDOW
echo  ==========================================
echo.
echo  LAPTOP : http://localhost:3000
echo  PHONE  : Scan the QR code shown below
echo.
echo  Press Ctrl+C to stop the server
echo  ==========================================
echo.

node server.js

echo.
if %errorlevel% neq 0 goto crashed
echo  [OK] Server stopped normally.
goto end

:crashed
echo  [ERROR] Server stopped with an error.
echo  Run this file again to restart.

:end
echo.
pause
