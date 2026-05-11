@echo off
setlocal

set "APP_DIR=%~dp0"
set "FINANCEIRO_SETUP=0"
set "PS_ARGS="

if /I "%~1"=="setup" (
  set "FINANCEIRO_SETUP=1"
  set "PS_ARGS=-Setup"
)

if "%FINANCEIRO_SETUP%"=="1" (
  echo Modo setup ativado: instalando dependencias e aplicando migrations.
) else (
  echo Modo rapido: pulando instalacao e migrations para abrir o link mais rapido.
  echo Se precisar do setup completo, execute: abrir_link_teste.bat setup
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\abrir_link_teste.ps1" %PS_ARGS%

if errorlevel 1 (
  echo.
  echo Ocorreu uma falha ao gerar o link de teste.
  echo Confira as mensagens acima.
  echo.
  pause
)
