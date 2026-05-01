@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_PORT=8001"
set "APP_URL=http://127.0.0.1:%APP_PORT%"
set "TOOLS_DIR=%APP_DIR%tools"
set "LOCAL_CLOUDFLARED=%TOOLS_DIR%\cloudflared.exe"
set "TUNNEL_LOG=%APP_DIR%cloudflare_tunnel.log"
set "CLOUDFLARED_CMD="
set "PUBLIC_URL="

cd /d "%APP_DIR%"

echo ============================================================
echo  FINANCEIRO - LINK PUBLICO DE TESTE
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Nao encontrei o npm.cmd. Instale o Node.js antes de continuar.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Nao encontrei o Python no PATH.
  pause
  exit /b 1
)

echo [1/6] Instalando/verificando dependencias Python...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo Falha ao instalar dependencias Python.
  pause
  exit /b 1
)

echo [2/6] Aplicando migrations do banco...
alembic upgrade head
if errorlevel 1 (
  echo Aviso: nao consegui aplicar migrations agora. Vou continuar para abrir o link de teste.
  echo Confira o .env e o PostgreSQL depois, se estiver usando banco PostgreSQL.
)

echo [3/6] Garantindo empresa padrao, usuario master e admin inicial...
python scripts\migrar_json_para_postgres.py
if errorlevel 1 (
  echo Aviso: nao consegui preparar os dados iniciais agora. Vou continuar para abrir o link de teste.
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
  echo [4/6] Baixando Cloudflare Tunnel automaticamente...
  if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%LOCAL_CLOUDFLARED%'"
  if exist "%LOCAL_CLOUDFLARED%" (
    set "CLOUDFLARED_CMD=%LOCAL_CLOUDFLARED%"
  ) else (
    echo Nao consegui baixar o cloudflared automaticamente.
    pause
    exit /b 1
  )
) else (
  echo [4/6] Cloudflare Tunnel encontrado.
)

echo [5/6] Iniciando servidor web local...
start "Financeiro - Servidor Web" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%APP_DIR%python'; python -m uvicorn web:app --host 127.0.0.1 --port %APP_PORT%"

echo Aguardando o servidor responder...
timeout /t 6 /nobreak >nul

echo [6/6] Abrindo tunel publico de teste...
if exist "%TUNNEL_LOG%" del "%TUNNEL_LOG%"
start "Financeiro - Link Publico HTTPS" powershell -NoExit -ExecutionPolicy Bypass -Command "& '%CLOUDFLARED_CMD%' tunnel --no-autoupdate --url %APP_URL% 2>&1 | Tee-Object -FilePath '%TUNNEL_LOG%'"

echo Aguardando o Cloudflare gerar o link HTTPS...
for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$log='%TUNNEL_LOG%'; $deadline=(Get-Date).AddSeconds(60); do { if (Test-Path $log) { $text=Get-Content $log -Raw; $match=[regex]::Match($text, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($match.Success) { $match.Value; exit 0 } }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"`) do set "PUBLIC_URL=%%L"

echo.
echo Abrindo navegador local...
start "" "%APP_URL%"
if defined PUBLIC_URL (
  echo Abrindo navegador com link publico HTTPS...
  start "" "%PUBLIC_URL%/app"
) else (
  echo Nao consegui capturar o link HTTPS automaticamente em 60 segundos.
  echo Verifique a janela "Financeiro - Link Publico HTTPS" ou o arquivo cloudflare_tunnel.log.
)
echo.
echo ============================================================
if defined PUBLIC_URL (
  echo  LINK PUBLICO HTTPS:
  echo  %PUBLIC_URL%/app
) else (
  echo  COPIE O LINK https://...trycloudflare.com
  echo  Ele aparecera na janela "Financeiro - Link Publico HTTPS"
  echo  e tambem no arquivo cloudflare_tunnel.log.
)
echo.
echo  Login master:
echo  Email: master@sistema.local
echo  Senha: Master123
echo.
echo  Mantenha abertas as janelas do Servidor Web e do Link Publico.
echo ============================================================
echo.
pause
