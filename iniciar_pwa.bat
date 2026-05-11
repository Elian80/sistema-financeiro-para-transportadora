@echo off
setlocal

cd /d "%~dp0"

echo Verificando dependencias Python...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo Falha ao instalar dependencias.
  pause
  exit /b 1
)

echo Aplicando migrations do banco...
alembic upgrade head
if errorlevel 1 (
  echo Falha ao aplicar migrations. Confira o arquivo .env e o PostgreSQL.
  pause
  exit /b 1
)

echo Garantindo empresa padrao e admin inicial...
python scripts\migrar_json_para_postgres.py
if errorlevel 1 (
  echo Falha ao preparar dados iniciais.
  pause
  exit /b 1
)

echo Iniciando servidor web...
start "Financeiro - Servidor Web" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%~dp0python'; python -m uvicorn web:app --host 127.0.0.1 --port 8001"

echo Aguardando servidor responder...
timeout /t 5 /nobreak >nul

set "LOCAL_APP_URL=http://127.0.0.1:8001/app"
set "LOCAL_MOTORISTA_URL=http://127.0.0.1:8001/motorista"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*' -and $_.InterfaceOperationalStatus -eq 'Up' } | Select-Object -ExpandProperty IPAddress | Select-Object -First 1)"`) do set "LOCAL_IP=%%I"

if defined LOCAL_IP (
  set "LOCAL_APP_MOBILE_URL=http://%LOCAL_IP%:8001/app"
  set "LOCAL_MOTORISTA_MOBILE_URL=http://%LOCAL_IP%:8001/motorista"
) else (
  set "LOCAL_APP_MOBILE_URL=%LOCAL_APP_URL%"
  set "LOCAL_MOTORISTA_MOBILE_URL=%LOCAL_MOTORISTA_URL%"
)

> "LINK_LOCAL_PC.url" echo [InternetShortcut]
>>"LINK_LOCAL_PC.url" echo URL=%LOCAL_APP_URL%
> "LINK_LOCAL_MOTORISTA.url" echo [InternetShortcut]
>>"LINK_LOCAL_MOTORISTA.url" echo URL=%LOCAL_MOTORISTA_URL%
> "LINK_LOCAL_CELULAR.url" echo [InternetShortcut]
>>"LINK_LOCAL_CELULAR.url" echo URL=%LOCAL_APP_MOBILE_URL%
> "LINK_LOCAL_CELULAR_MOTORISTA.url" echo [InternetShortcut]
>>"LINK_LOCAL_CELULAR_MOTORISTA.url" echo URL=%LOCAL_MOTORISTA_MOBILE_URL%
> "LINK_LOCAL_CELULAR.txt" echo %LOCAL_APP_MOBILE_URL%
>>"LINK_LOCAL_CELULAR.txt" echo %LOCAL_MOTORISTA_MOBILE_URL%

echo Abrindo navegador...
start "" "%LOCAL_APP_URL%"

echo.
echo Sistema iniciado.
echo Master inicial: master@sistema.local / Master123
echo Admin da empresa padrao: admin@sistema.local / trocar123
echo Mantenha a janela "Financeiro - Servidor Web" aberta enquanto estiver usando o sistema.
echo.
pause
