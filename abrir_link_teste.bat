@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:8000"
set "TOOLS_DIR=%APP_DIR%tools"
set "LOCAL_CLOUDFLARED=%TOOLS_DIR%\cloudflared.exe"
set "CLOUDFLARED_CMD="

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
  echo Falha ao aplicar migrations. Confira o .env e o PostgreSQL.
  pause
  exit /b 1
)

echo [3/6] Garantindo empresa padrao, usuario master e admin inicial...
python scripts\migrar_json_para_postgres.py
if errorlevel 1 (
  echo Falha ao preparar dados iniciais.
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
start "Financeiro - Servidor Web" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%APP_DIR%python'; python -m uvicorn web:app --host 127.0.0.1 --port 8000 --reload"

echo Aguardando o servidor responder...
timeout /t 6 /nobreak >nul

echo [6/6] Abrindo tunel publico de teste...
start "Financeiro - Link Publico" powershell -NoExit -ExecutionPolicy Bypass -Command "& '%CLOUDFLARED_CMD%' tunnel --url %APP_URL%"

echo.
echo Abrindo navegador local...
start "" "%APP_URL%"
echo.
echo ============================================================
echo  COPIE O LINK https://...trycloudflare.com
echo  Ele aparecera na janela "Financeiro - Link Publico".
echo.
echo  Login master:
echo  Email: master@sistema.local
echo  Senha: Master123
echo.
echo  Mantenha abertas as janelas do Servidor Web e do Link Publico.
echo ============================================================
echo.
pause
