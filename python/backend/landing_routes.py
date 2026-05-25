"""
landing_routes.py — API para o site institucional GM7 Sistemas
==============================================================

Rotas públicas:
  POST /gm7-api/auth         — autenticação do painel admin
  GET  /gm7-api/content      — conteúdo público do site
  POST /gm7-api/contato      — envio de formulário de contato

Rotas protegidas (Bearer token):
  POST /gm7-api/auth/senha   — troca de senha admin
  PUT  /gm7-api/content      — salva conteúdo do site
  GET  /gm7-api/mensagens    — lista mensagens recebidas
  DELETE /gm7-api/mensagens/{id} — exclui mensagem

Autenticação:
  Token = HMAC-SHA256(key=SECRET, msg=senha+str(dia_do_mes))
  Válido para o dia atual e o dia anterior (tolerância de fuso).
  Senha padrão inicial: definida no primeiro provisionamento do servidor.
  Config em: /opt/financeiro/landing_admin.json
"""

import hashlib
import hmac
import json
import uuid
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel

# ─── Paths ───────────────────────────────────────────────────────────────────
BASE_DIR = Path("/opt/financeiro")
CONTENT_FILE = BASE_DIR / "landing_content.json"
ADMIN_FILE   = BASE_DIR / "landing_admin.json"
MSGS_FILE    = BASE_DIR / "landing_messages.json"

# ─── Default content ─────────────────────────────────────────────────────────
DEFAULT_CONTENT: dict = {
    "marca": {
        "nome": "GM7 Sistemas",
        "tagline": "Tecnologia que move o Brasil. Soluções para transportadoras, gestão e automação.",
        "logo": None,
    },
    "hero": {
        "title": 'Gestão inteligente para <span class="grad-text">transportadoras</span> que crescem',
        "subtitle": "Automatize processos, controle suas finanças e tome decisões baseadas em dados reais com a plataforma completa da GM7 Sistemas.",
        "cta1": "Começar agora →",
        "cta2": "📄 Ver serviços",
        "stat_clients": "50",
        "stat_clients_label": "Clientes ativos",
        "stat_projects": "120",
        "stat_projects_label": "Projetos entregues",
        "stat_years": "5",
        "stat_years_label": "Anos de experiência",
    },
    "servicos": [
        {
            "icone": "🚛",
            "titulo": "Gestão para Transportadoras",
            "descricao": (
                "Sistema completo de gestão financeira, controle de frota, motoristas, "
                "folha de pagamento e relatórios para transportadoras de todos os portes."
            ),
            "destaque": True,
        },
        {
            "icone": "⚡",
            "titulo": "Automação Multitarefas",
            "descricao": (
                "Automatize rotinas operacionais, integrações entre sistemas, geração "
                "de relatórios e notificações para sua equipe."
            ),
            "destaque": False,
        },
        {
            "icone": "💻",
            "titulo": "Desenvolvimento Personalizado",
            "descricao": (
                "Criamos soluções sob medida para os desafios únicos do seu negócio — "
                "desde apps mobile até sistemas web completos."
            ),
            "destaque": False,
        },
    ],
    "sobre": {
        "title": 'Tecnologia com <span class="grad-text">propósito</span>',
        "subtitle": "Nascemos para resolver um problema real.",
        "texto": (
            "A GM7 Sistemas nasceu da necessidade real de transportadoras que precisavam de um sistema "
            "robusto, simples e acessível. Com anos de experiência no setor, desenvolvemos soluções que "
            "vão além do software — entregamos eficiência operacional, controle financeiro e tranquilidade "
            "para gestores e proprietários."
        ),
        "imagem": None,
    },
    "depoimentos": [],
    "contato": {
        "whatsapp": "",
        "email": "contato@gm7sistemas.com.br",
        "instagram": "",
        "linkedin": "",
        "endereco": "",
    },
}

# ─── Default admin config ────────────────────────────────────────────────────
DEFAULT_ADMIN: dict = {
    "senha_hash": hashlib.sha256(b"Mol.8080").hexdigest(),
    "secret": uuid.uuid4().hex,
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ler_json(path: Path, default: dict | list) -> dict | list:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _salvar_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _carregar_admin() -> dict:
    cfg = _ler_json(ADMIN_FILE, {})
    if not cfg.get("secret"):
        cfg = {**DEFAULT_ADMIN, **cfg}
        _salvar_json(ADMIN_FILE, cfg)
    return cfg


def _gerar_token(senha: str, secret: str) -> str:
    """HMAC token válido por 1 dia (verifica hoje e ontem)."""
    dia = str(date.today().day)
    return hmac.new(secret.encode(), (senha + dia).encode(), hashlib.sha256).hexdigest()


def _validar_token(token: str | None, cfg: dict) -> bool:
    if not token:
        return False
    secret = cfg.get("secret", "")
    senha_hash = cfg.get("senha_hash", "")
    # Rebuild stored password from hash is not possible — we need to store the senha
    # Instead we embed senha (plain) token approach: token = hmac(secret, senha_hash+day)
    hoje = str(date.today().day)
    ontem = str((date.today().day - 1) or 31)
    for dia in (hoje, ontem):
        expected = hmac.new(
            secret.encode(),
            (senha_hash + dia).encode(),
            hashlib.sha256,
        ).hexdigest()
        if hmac.compare_digest(token, expected):
            return True
    return False


def _fazer_token(senha_hash: str, secret: str) -> str:
    dia = str(date.today().day)
    return hmac.new(secret.encode(), (senha_hash + dia).encode(), hashlib.sha256).hexdigest()


def _exigir_token(authorization: str | None) -> None:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    cfg = _carregar_admin()
    if not _validar_token(token, cfg):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido ou expirado.")

# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class AuthIn(BaseModel):
    senha: str


class AuthSenhaIn(BaseModel):
    senha_atual: str
    senha_nova: str


class ContatoIn(BaseModel):
    nome: str
    empresa: str = ""
    telefone: str = ""
    mensagem: str


# ─── Router ──────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/gm7-api", tags=["Landing GM7"])


@router.post("/auth")
def autenticar(body: AuthIn):
    """Verifica a senha e retorna um token HMAC."""
    cfg = _carregar_admin()
    senha_hash = hashlib.sha256(body.senha.encode()).hexdigest()
    if not hmac.compare_digest(senha_hash, cfg.get("senha_hash", "")):
        raise HTTPException(status_code=401, detail="Senha incorreta.")
    token = _fazer_token(senha_hash, cfg["secret"])
    return {"token": token}


@router.post("/auth/senha")
def alterar_senha(body: AuthSenhaIn, authorization: str | None = Header(default=None)):
    """Troca a senha do admin (requer token válido)."""
    _exigir_token(authorization)
    cfg = _carregar_admin()
    # Verify current password
    hash_atual = hashlib.sha256(body.senha_atual.encode()).hexdigest()
    if not hmac.compare_digest(hash_atual, cfg.get("senha_hash", "")):
        raise HTTPException(status_code=401, detail="Senha atual incorreta.")
    if len(body.senha_nova) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 6 caracteres.")
    novo_hash = hashlib.sha256(body.senha_nova.encode()).hexdigest()
    cfg["senha_hash"] = novo_hash
    _salvar_json(ADMIN_FILE, cfg)
    novo_token = _fazer_token(novo_hash, cfg["secret"])
    return {"ok": True, "token": novo_token}


@router.get("/content")
def obter_conteudo():
    """Retorna o conteúdo público do site (landing page)."""
    data = _ler_json(CONTENT_FILE, {})
    # Deep merge with defaults to fill in any missing keys
    merged = _deep_merge(DEFAULT_CONTENT, data)
    # Strip logo/images from public response if too large? No — keep them.
    return merged


@router.put("/content")
def salvar_conteudo(request: Request, authorization: str | None = Header(default=None)):
    """Salva o conteúdo do site (admin token obrigatório)."""
    _exigir_token(authorization)
    import asyncio
    loop = asyncio.get_event_loop()
    body_bytes = loop.run_until_complete(request.body())
    try:
        data = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON inválido.")
    _salvar_json(CONTENT_FILE, data)
    return {"ok": True}


@router.post("/contato")
def salvar_contato(body: ContatoIn):
    """Salva uma mensagem do formulário de contato."""
    msgs: list = _ler_json(MSGS_FILE, [])  # type: ignore[assignment]
    next_id = max((m.get("id", 0) for m in msgs), default=0) + 1
    msgs.append({
        "id": next_id,
        "nome": body.nome.strip(),
        "empresa": body.empresa.strip(),
        "telefone": body.telefone.strip(),
        "mensagem": body.mensagem.strip(),
        "data": datetime.now().strftime("%d/%m/%Y %H:%M"),
    })
    _salvar_json(MSGS_FILE, msgs)
    return {"ok": True, "id": next_id}


@router.get("/mensagens")
def listar_mensagens(authorization: str | None = Header(default=None)):
    """Lista as mensagens recebidas via formulário (admin)."""
    _exigir_token(authorization)
    msgs = _ler_json(MSGS_FILE, [])
    if isinstance(msgs, list):
        return list(reversed(msgs))
    return []


@router.delete("/mensagens/{msg_id}")
def excluir_mensagem(msg_id: int, authorization: str | None = Header(default=None)):
    """Exclui uma mensagem pelo ID."""
    _exigir_token(authorization)
    msgs: list = _ler_json(MSGS_FILE, [])  # type: ignore[assignment]
    novas = [m for m in msgs if m.get("id") != msg_id]
    if len(novas) == len(msgs):
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    _salvar_json(MSGS_FILE, novas)
    return {"ok": True}


# ─── Utilities ───────────────────────────────────────────────────────────────

def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for k, v in (override or {}).items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result
