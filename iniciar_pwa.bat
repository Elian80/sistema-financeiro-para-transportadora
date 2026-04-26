@echo off
cd /d "%~dp0python"
python -m uvicorn web:app --host 127.0.0.1 --port 8000 --reload
