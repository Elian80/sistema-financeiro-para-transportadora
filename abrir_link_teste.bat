@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:8000"
set "TOOLS_DIR=%APP_DIR%tools"
set "LOCAL_CLOUDFLARED=%TOOLS_DIR%\cloudflared.exe"
set "CLOUDFLARED_CMD="

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Nao encontrei o npm.cmd. Instale o Node.js ou abra pelo GitHub Desktop/terminal onde o Node esteja disponivel.
  pause
  exit /b 1
)

where cloudflared.exe >nul 2>nul
if not errorlevel 1 (
  set "CLOUDFLARED_CMD=cloudflared.exe"
)

if not defined CLOUDFLARED_CMD (
  if exist "%LOCAL_CLOUDFLARED%" (
    set "CLOUDFLARED_CMD=%LOCAL_CLOUDFLARED%"
  )
)

if not defined CLOUDFLARED_CMD (
  echo Nao encontrei o cloudflared. Vou baixar automaticamente para a pasta tools...
  if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%LOCAL_CLOUDFLARED%'"

  if exist "%LOCAL_CLOUDFLARED%" (
    set "CLOUDFLARED_CMD=%LOCAL_CLOUDFLARED%"
  ) else (
    echo.
    echo Nao consegui baixar o cloudflared automaticamente.
    echo Baixe manualmente aqui:
    echo https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo.
    pause
    exit /b 1
  )
)

echo Iniciando servidor web do sistema...
start "Financeiro - Servidor Web" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%APP_DIR%'; npm.cmd run web"

echo Aguardando o servidor subir...
timeout /t 5 /nobreak >nul

echo Abrindo tunel publico de teste...
start "Financeiro - Link de Teste" powershell -NoExit -ExecutionPolicy Bypass -Command "& '%CLOUDFLARED_CMD%' tunnel --url %APP_URL%"

echo.
echo Pronto. Copie o link https://...trycloudflare.com que aparecer na janela "Financeiro - Link de Teste".
echo Mantenha as duas janelas abertas enquanto estiver testando.
echo.
pause
