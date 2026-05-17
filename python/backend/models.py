"""
models.py — Definição de todas as tabelas do banco de dados via SQLAlchemy ORM.

Cada classe Python aqui representa uma tabela no banco (PostgreSQL em produção,
SQLite em desenvolvimento). O ORM traduz automaticamente operações Python em SQL.

Hierarquia de acesso (perfis):
  master → admin → gestor → financeiro / operador → visualizador
"""

from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


# Perfis de acesso válidos no sistema
PERFIS_VALIDOS = ("master", "admin", "gestor", "financeiro", "operador", "visualizador")

# Status possíveis para empresas e usuários
STATUS_VALIDOS = ("ativo", "inativo", "bloqueado", "pendente")


class TimestampMixin:
    """Mixin que adiciona colunas de auditoria de tempo em qualquer tabela.

    created_at: momento da criação do registro (preenchido automaticamente pelo banco)
    updated_at: momento da última atualização (atualizado automaticamente pelo ORM)
    """
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Empresa(Base, TimestampMixin):
    """Tabela de empresas cadastradas no sistema.

    Cada empresa é um tenant (multiempresa). Todos os dados do sistema
    (lançamentos, veículos, motoristas, etc.) são vinculados a uma empresa.
    Usuários com perfil 'master' enxergam todas as empresas.
    """
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
    # Logo armazenada como base64 ou URL
    logo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    observacoes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Status: ativo, inativo, bloqueado
    status: Mapped[str] = mapped_column(String(20), default="ativo", nullable=False)

    # Relacionamento: uma empresa possui vários usuários
    usuarios: Mapped[list["Usuario"]] = relationship(back_populates="empresa")


class Usuario(Base, TimestampMixin):
    """Tabela de usuários do sistema (painel administrativo web).

    Cada usuário pertence a exatamente uma empresa. O perfil determina
    quais telas e operações o usuário pode acessar.

    Perfis disponíveis:
      - master: acesso total a todas as empresas
      - admin: gerencia usuários e configurações da própria empresa
      - gestor: acesso completo aos dados da empresa
      - financeiro: acesso a lançamentos, contas, relatórios
      - operador: acesso a veículos, motoristas, estoque
      - visualizador: somente leitura
    """
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
    # Registrado a cada login bem-sucedido
    ultimo_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Força troca de senha no próximo acesso (usado ao criar usuário pelo admin)
    deve_trocar_senha: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    empresa: Mapped[Empresa] = relationship(back_populates="usuarios")


class EmpresaScopedMixin(TimestampMixin):
    """Mixin base para todas as entidades vinculadas a uma empresa.

    Garante que todo registro tenha um id primário e um empresa_id,
    permitindo filtrar dados por tenant em todas as queries.
    """
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresas.id"), nullable=False, index=True)


class Veiculo(Base, EmpresaScopedMixin):
    """Tabela de veículos da frota.

    Cada veículo pode ser vinculado a lançamentos financeiros e viagens.
    O campo 'foto' armazena a imagem em base64 diretamente no banco.

    Tipos válidos: Caminhão, Carro, Máquina, Motocicleta
    Status válidos: Ativo, Manutenção, Inativo
    """
    __tablename__ = "veiculos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    marca: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    modelo: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    ano: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    placa: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    tipo: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="Ativo", nullable=False)
    observacao: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Foto em base64 — pode impactar performance em frotas grandes; considerar S3 futuramente
    foto: Mapped[str] = mapped_column(Text, default="", nullable=False)


class Motorista(Base, EmpresaScopedMixin):
    """Tabela de motoristas cadastrados.

    O campo 'dados' (JSON) armazena informações flexíveis como:
    salário, dados bancários (banco, agência, conta, PIS),
    carga horária, INSS, vale refeição, convênio médico.
    Essa abordagem evita muitas colunas e facilita evolução sem migrations.
    """
    __tablename__ = "motoristas"
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    telefone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    cnh: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    cargo: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    admissao: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    # JSON com dados variáveis: salário, banco, PIS, horas, descontos
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Lancamento(Base, EmpresaScopedMixin):
    """Tabela de lançamentos financeiros (receitas, custos, despesas, investimentos).

    É a entidade central do módulo financeiro. O campo 'tipo_financeiro'
    é inferido automaticamente a partir da classificação.

    O campo 'dados' (JSON) armazena campos opcionais:
      - veiculo_id: veículo vinculado ao lançamento
      - empresa_id: empresa específica (em contexto multiempresa)
      - obra_servico: obra ou serviço associado
      - kilometragem, litros, numero_nf, data_nf: dados de abastecimento
      - estoque_item_id: ID do produto de estoque dado como saída
      - estoque_quantidade: quantidade debitada do estoque
      - estoque_item_nome: nome do produto (desnormalizado para exibição rápida)

    Regra: ao criar/editar com estoque_item_id preenchido, o sistema
    registra automaticamente uma saída no módulo de estoque.
    """
    __tablename__ = "lancamentos"
    data: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    classificacao: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    descricao: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    # Inferido automaticamente: custo, receita, despesa, investimento
    tipo_financeiro: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    # JSON com campos opcionais — ver docstring acima
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class ContaReceber(Base, EmpresaScopedMixin):
    """Tabela de contas a receber (contratos e tickets de frete/serviço).

    O valor pode ser calculado de duas formas:
      1. Valor fixo: campo 'valor'
      2. Por horas/máquinas: valor_hora_unitario × quantidade_horas

    O campo 'dados' (JSON) armazena:
      cte_ticket, carga, ton_qnt, tomador, origem_destino,
      bonificacao, descontos, desconto_classificacao,
      valor_hora_unitario, quantidade_horas, veiculo_id,
      data_recebimento

    Status possíveis: pendente, recebido, cancelado
    """
    __tablename__ = "contas_receber"
    data_inicio: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    contrato: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    status_pagamento: Mapped[str] = mapped_column(String(40), default="pendente", nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Ativo(Base, EmpresaScopedMixin):
    """Tabela de ativos patrimoniais da empresa.

    Exemplos: veículos próprios, máquinas, equipamentos, imóveis.
    O campo 'dados' (JSON) armazena: tipo, data_aquisição, observação.
    Utilizado no relatório de patrimônio líquido.
    """
    __tablename__ = "ativos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Passivo(Base, EmpresaScopedMixin):
    """Tabela de passivos (dívidas e obrigações financeiras).

    Exemplos: financiamentos, empréstimos, impostos, dívidas.
    O campo 'dados' (JSON) armazena: tipo, data_vencimento, observação.
    Utilizado no relatório de patrimônio líquido (Ativos - Passivos).
    """
    __tablename__ = "passivos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    valor: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class EstoqueProduto(Base, EmpresaScopedMixin):
    """Tabela de produtos do estoque.

    Cada produto possui uma quantidade atual. Toda movimentação
    (entrada ou saída) deve ser registrada em EstoqueMovimentacao,
    que atualiza automaticamente a quantidade aqui.

    O campo 'dados' (JSON) armazena:
      unidade_medida, valor_custo, estoque_minimo, observacao

    Quando quantidade <= estoque_minimo, o sistema marca como 'estoque_baixo'.
    """
    __tablename__ = "estoque_produtos"
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    categoria: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    quantidade: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class EstoqueMovimentacao(Base, EmpresaScopedMixin):
    """Tabela de movimentações do estoque (histórico de entradas e saídas).

    Cada registro representa uma movimentação e mantém o histórico completo.
    Tipos válidos: Entrada, Saida, Ajuste

    O campo 'dados' (JSON) armazena:
      valor_unitario, data, observacao

    IMPORTANTE: ao registrar uma saída vinculada a um lançamento financeiro,
    o campo observacao deve conter o ID do lançamento para rastreabilidade.
    """
    __tablename__ = "estoque_movimentacoes"
    produto_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tipo: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    quantidade: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    dados: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class PlanoConta(Base, EmpresaScopedMixin):
    """Tabela do plano de contas personalizado por empresa.

    Armazena classificações criadas pelo usuário além das classificações
    padrão do sistema (definidas em main.py como CLASSIFICACOES_BASE).
    Usado nos selects de classificação nos lançamentos financeiros.
    """
    __tablename__ = "plano_contas"
    nome: Mapped[str] = mapped_column(String(160), nullable=False)


class AuditLog(Base):
    """Tabela de auditoria de todas as operações sensíveis do sistema.

    Registra: quem fez, o que fez, em qual entidade, quando e de qual IP.
    Não herda EmpresaScopedMixin pois empresa_id pode ser nulo (ex: login falho).

    Entidades monitoradas: login, usuarios, empresas, lancamentos, etc.
    Ações registradas: login_ok, login_bloqueado, criar, editar, excluir.
    """
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


class MotoristaAcesso(Base, EmpresaScopedMixin):
    """Tabela de credenciais de acesso do app mobile dos motoristas.

    Separada da tabela 'motoristas' porque nem todo motorista cadastrado
    precisa de acesso ao app. Um MotoristaAcesso pode ser vinculado
    (ou não) a um Motorista existente via motorista_id.

    Os tokens JWT gerados para motoristas têm expiração de 30 dias
    e são distintos dos tokens de usuários administrativos.
    """
    __tablename__ = "motorista_acessos"

    motorista_id: Mapped[int | None] = mapped_column(ForeignKey("motoristas.id"), nullable=True, index=True)
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Viagem(Base, EmpresaScopedMixin):
    """Tabela de viagens registradas pelo app mobile dos motoristas.

    Uma viagem é iniciada pelo motorista no app, que envia periodicamente
    sua localização GPS. Ao finalizar, o km_final é registrado.

    O campo 'rota' (JSON array) armazena os pontos GPS da trajetória:
    [{"lat": -23.5, "lng": -46.6, "ts": "2024-01-01T10:00:00"}, ...]

    Status: em_andamento, finalizada, cancelada
    """
    __tablename__ = "viagens"

    motorista_acesso_id: Mapped[int] = mapped_column(ForeignKey("motorista_acessos.id"), nullable=False, index=True)
    veiculo_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origem: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    destino: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    carga: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    km_inicial: Mapped[float | None] = mapped_column(Float, nullable=True)
    km_final: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    data_fim: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Array JSON com pontos de trajetória GPS
    rota: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    observacao: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="em_andamento", nullable=False)


class MotoristaLocalizacao(Base):
    """Tabela de localização em tempo real de cada motorista.

    Usa unique=True em motorista_acesso_id para manter apenas UM registro
    por motorista, sendo atualizado (upsert) a cada envio de GPS.
    Isso evita crescimento ilimitado da tabela com dados de rastreamento.

    O histórico completo fica em Viagem.rota (JSON).
    Para rastreamento ao vivo, use esta tabela via GET /mapa/motoristas.
    """
    __tablename__ = "motorista_localizacoes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    empresa_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    motorista_acesso_id: Mapped[int] = mapped_column(ForeignKey("motorista_acessos.id"), nullable=False, unique=True)
    viagem_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nome: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    velocidade: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
