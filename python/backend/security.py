# =============================================================
# SEGURANÇA — JWT e senhas
# Este módulo centraliza toda a geração e validação de tokens JWT
# e o hash de senhas com bcrypt.
#
# Existem DOIS tipos de token no sistema:
#   1. "access"           → usuários administrativos (painel web)
#   2. "motorista_access" → motoristas (app mobile)
#
# A separação por campo "type" no payload impede que um motorista
# use seu token para acessar rotas administrativas e vice-versa.
# =============================================================

from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from .settings import settings


# --- Hash de senha com bcrypt (limite de 72 bytes por especificação do bcrypt) ---
def gerar_hash_senha(senha: str) -> str:
    senha_bytes = senha.encode("utf-8")[:72]
    return bcrypt.hashpw(senha_bytes, bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, senha_hash: str) -> bool:
    return bcrypt.checkpw(senha.encode("utf-8")[:72], senha_hash.encode("utf-8"))


# --- Token JWT para usuários administrativos (painel web) ---
# Expiração configurável via settings.access_token_expire_minutes
def criar_access_token(subject: str, empresa_id: int, perfil: str, expires_delta: timedelta | None = None) -> str:
    expira = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {
        "sub": subject,        # ID do usuário
        "empresa_id": empresa_id,
        "perfil": perfil,      # master, admin, gestor, financeiro, operador, visualizador
        "exp": expira,
        "type": "access",      # distingue do token de motorista
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decodificar_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Token invalido.") from exc
    # Garante que um token de motorista não seja aceito aqui
    if payload.get("type") != "access":
        raise ValueError("Tipo de token invalido.")
    return payload


def validar_senha_forte(senha: str) -> None:
    if len(senha or "") < 8:
        raise ValueError("A senha deve ter pelo menos 8 caracteres.")


# --- Token JWT para motoristas (app mobile) ---
# Expiração longa (30 dias) para não exigir relogin frequente no celular.
# O campo "sub" contém o ID de MotoristaAcesso (não de Usuario).
def criar_motorista_token(motorista_acesso_id: int, empresa_id: int) -> str:
    expira = datetime.now(UTC) + timedelta(days=30)
    payload = {
        "sub": str(motorista_acesso_id),
        "empresa_id": empresa_id,
        "type": "motorista_access",   # distingue do token de usuário admin
        "exp": expira,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decodificar_motorista_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Token invalido.") from exc
    # Rejeita tokens de usuários admin caso sejam usados aqui por engano
    if payload.get("type") != "motorista_access":
        raise ValueError("Tipo de token invalido.")
    return payload
