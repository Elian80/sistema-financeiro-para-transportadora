from datetime import datetime
import re

from pydantic import BaseModel, Field, field_validator

from .models import PERFIS_VALIDOS, STATUS_VALIDOS


def limpar_cnpj(cnpj: str | None) -> str:
    return re.sub(r"\D", "", cnpj or "")


def validar_email_formato(email: str) -> str:
    email = str(email or "").strip().lower()
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("Email invalido.")
    return email


class EmpresaBase(BaseModel):
    nome: str = Field(..., min_length=1, max_length=160)
    cnpj: str = Field("", max_length=20)
    telefone: str = Field("", max_length=30)
    email: str = ""
    endereco: str = Field("", max_length=255)
    status: str = "ativo"

    @field_validator("nome", "telefone", "email", "endereco", "status")
    @classmethod
    def strip_texto(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("cnpj")
    @classmethod
    def validar_cnpj(cls, value: str) -> str:
        cnpj = limpar_cnpj(value)
        if cnpj and len(cnpj) != 14:
            raise ValueError("CNPJ deve ter 14 digitos.")
        return cnpj

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        if value not in STATUS_VALIDOS:
            raise ValueError("Status invalido.")
        return value

    @field_validator("email")
    @classmethod
    def validar_email(cls, value: str) -> str:
        return validar_email_formato(value)


class EmpresaCreate(EmpresaBase):
    pass


class EmpresaUpdate(EmpresaBase):
    pass


class EmpresaOut(EmpresaBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UsuarioBase(BaseModel):
    nome: str = Field(..., min_length=1, max_length=160)
    email: str
    perfil: str
    status: str = "ativo"
    empresa_id: int | None = None

    @field_validator("nome", "perfil", "status")
    @classmethod
    def strip_texto(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("perfil")
    @classmethod
    def validar_perfil(cls, value: str) -> str:
        if value not in PERFIS_VALIDOS:
            raise ValueError("Perfil invalido.")
        return value

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        if value not in STATUS_VALIDOS:
            raise ValueError("Status invalido.")
        return value

    @field_validator("email")
    @classmethod
    def validar_email(cls, value: str) -> str:
        return validar_email_formato(value)


class UsuarioCreate(UsuarioBase):
    senha: str = Field(..., min_length=8, max_length=128)


class UsuarioUpdate(UsuarioBase):
    senha: str | None = Field(None, min_length=8, max_length=128)


class AlterarSenhaIn(BaseModel):
    senha: str = Field(..., min_length=8, max_length=128)


class UsuarioOut(UsuarioBase):
    id: int
    empresa_id: int
    ultimo_login: datetime | None = None
    deve_trocar_senha: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    email: str
    senha: str = Field(..., min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def validar_email(cls, value: str) -> str:
        return validar_email_formato(value)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioOut
