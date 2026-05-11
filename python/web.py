from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from main import FRONTEND_DIR, app


@app.get("/")
def abrir_login():
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/app")
def abrir_app():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/motorista")
def abrir_motorista():
    return FileResponse(FRONTEND_DIR / "motorista.html")


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
