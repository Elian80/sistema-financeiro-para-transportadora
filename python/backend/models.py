from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


PERFIS_VALIDOS = ("master", "admin", "gestor", "financeiro", "operador", "visualizador")
STATUS_VALIDOS = ("ativo", "inativo", "bloqueado", "pendente")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Empresa(Base, TimestampMixin):
    __tablename__ = "empresas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    nome_fantasia: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    cnpj: Mapped[str] = mapped_column(String(20), nullable=True, unique=True, index=True)
    inscricao_estadual: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    telefone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    endereco: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    cidade: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    estado: Mapped[str] = mapped_column(String(2), default="", nullable=False)
    cep: Mapped[str] = mapped_column(String(12), default="", nullable=False)
    logo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    observacoes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ativo", nullable=False)

    usuarios: Mapped[list["Usuario"]] = relationship(back_populates="empresa")


class Usuario(Base, TimestampMixin):
    __tablename__ = "usuarios"
    __table_args__ = (UniqueConstraint("email", name="uq_usuarios_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresas.id"), nullable=False, index=True)
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    perfil: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ativo", nullable=False)
    telefone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    cargo: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    ultimo_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deve_trocar_senha: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    empresa: Mapped[Empresa] = relationship(back_populates="usuarios")


class EmpresaScopedMixin(TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresas.id"), nullable=False, index=True)


class Veiculo(Base, EmpresaScopedMixin):
    __tablename__ = "veiculos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    marca: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    modelo: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    ano: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    placa: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    tipo: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="Ativo", nullable=False)
    observacao: Mapped[str] = mapped_column(Text, default="", nullable=False)
    foto: Mapped[str] = mapped_column(Text, default="", nullable=False)


class Motorista(Base, EmpresaScopedMixin):
    __tablename__ = "motoristas"
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    telefone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    cnh: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    cargo: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    admissao: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Lancamento(Base, EmpresaScopedMixin):
    __tablename__ = "lancamentos"
    data: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    classificacao: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    descricao: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    tipo_financeiro: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class ContaReceber(Base, EmpresaScopedMixin):
    __tablename__ = "contas_receber"
    data_inicio: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    contrato: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    status_pagamento: Mapped[str] = mapped_column(String(40), default="pendente", nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Ativo(Base, EmpresaScopedMixin):
    __tablename__ = "ativos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Passivo(Base, EmpresaScopedMixin):
    __tablename__ = "passivos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class EstoqueProduto(Base, EmpresaScopedMixin):
    __tablename__ = "estoque_produtos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    categoria: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    quantidade: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class EstoqueMovimentacao(Base, EmpresaScopedMixin):
    __tablename__ = "estoque_movimentacoes"
    produto_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tipo: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    quantidade: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class PlanoConta(Base, EmpresaScopedMixin):
    __tablename__ = "plano_contas"
    nome: Mapped[str] = mapped_column(String(160), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    empresa_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    usuario_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    acao: Mapped[str] = mapped_column(String(80), nullable=False)
    entidade: Mapped[str] = mapped_column(String(80), nullable=False)
    entidade_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    detalhes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
