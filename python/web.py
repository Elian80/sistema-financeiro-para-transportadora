"""
Entrypoint web para servir o frontend junto da API FastAPI.

Rotas principais:
- "/"         -> login administrativo
- "/app"      -> painel financeiro
- "/motorista"-> app mobile/PWA do motorista

Além disso, monta arquivos estáticos do diretório renderer/.
"""

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from main import FRONTEND_DIR, app


@app.get("/")
def abrir_login():
    # Página inicial padrão: autenticação do usuário administrativo.
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/app")
def abrir_app():
    # SPA principal do sistema financeiro.
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/motorista")
def abrir_motorista():
    # PWA voltado aos motoristas (viagens + GPS).
    return FileResponse(FRONTEND_DIR / "motorista.html")


if FRONTEND_DIR.exists():
    # Fallback para servir CSS/JS/imagens/manifest/service worker.
    app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
