@echo off
setlocal

set "APP_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\abrir_link_teste.ps1"

if errorlevel 1 (
  echo.
  echo Ocorreu uma falha ao gerar o link de teste.
  echo Confira as mensagens acima.
  echo.
  pause
)
