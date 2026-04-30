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

echo Abrindo navegador...
start "" "http://127.0.0.1:8001"

echo.
echo Sistema iniciado.
echo Master inicial: master@sistema.local / Master123
echo Admin da empresa padrao: admin@sistema.local / trocar123
echo Mantenha a janela "Financeiro - Servidor Web" aberta enquanto estiver usando o sistema.
echo.
pause
