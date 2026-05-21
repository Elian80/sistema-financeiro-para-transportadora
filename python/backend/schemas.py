"""
# =============================================================================
# schemas.py — Schemas Pydantic: Validação de Entrada e Saída da API
# =============================================================================
#
# Este módulo define todos os schemas Pydantic usados pelo FastAPI para:
#   - Validar e deserializar dados recebidos na API (body, query params)
#   - Serializar e formatar dados enviados nas respostas da API
#   - Documentar automaticamente a API no Swagger (/docs)
#
# CONVENÇÃO DE NOMENCLATURA:
#   XxxBase:   campos compartilhados entre create e update
#   XxxCreate: herda Base, adiciona campos obrigatórios na criação (ex: senha)
#   XxxUpdate: herda Base, campos opcionais para atualização parcial
#   XxxOut:    schema de resposta, inclui id e timestamps, nunca expõe senha_hash
#
# MULTI-TENANT:
#   Os schemas de usuário incluem empresa_id, que isola os dados de cada
#   empresa. O backend sempre filtra queries por empresa_id do token JWT.
#
# PERFIS DE USUÁRIO VÁLIDOS (definidos em models.py):
#   master, admin, gestor, financeiro, operador, visualizador
#
# RELAÇÃO COM OS MODELOS ORM (models.py):
#   Os schemas "Out" usam model_config = {"from_attributes": True} para
#   permitir a conversão direta de objetos ORM: XxxOut.model_validate(obj_orm)
#
# VALIDADORES CUSTOMIZADOS:
#   Todos os validadores usam @field_validator do Pydantic v2.
#   O parâmetro mode="before" processa o valor antes da validação de tipo,
#   permitindo limpeza (strip, lower) antes de qualquer verificação.
# =============================================================================
"""

from datetime import datetime
import re

from pydantic import BaseModel, Field, field_validator

from .models import PERFIS_VALIDOS, STATUS_VALIDOS


# =============================================================================
# Funções Auxiliares de Validação
# =============================================================================

def limpar_cnpj(cnpj: str | None) -> str:
    """Remove todos os caracteres não numéricos de um CNPJ.

    Permite que o frontend envie o CNPJ formatado (ex: "12.345.678/0001-90")
    ou limpo (ex: "12345678000190"). O backend sempre armazena apenas dígitos.

    Args:
        cnpj: CNPJ com ou sem formatação. None é tratado como string vazia.

    Returns:
        str: Apenas os dígitos do CNPJ, ou string vazia se None/vazio.

    Exemplo:
        limpar_cnpj("12.345.678/0001-90") → "12345678000190"
        limpar_cnpj(None)                 → ""
    """
    return re.sub(r"\D", "", cnpj or "")


def validar_email_formato(email: str) -> str:
    """Valida o formato de um endereço de email e o normaliza para minúsculas.

    Usado como validador compartilhado entre múltiplos schemas (Empresa e Usuario).
    Emails vazios são aceitos (campo opcional), apenas emails não-vazios
    precisam ter formato válido.

    Args:
        email: Endereço de email a validar. None é tratado como string vazia.

    Returns:
        str: Email normalizado em minúsculas e sem espaços nas bordas.

    Raises:
        ValueError: Se o email não estiver vazio e não tiver formato válido.

    Exemplo:
        validar_email_formato("  JOAO@EMPRESA.COM  ") → "joao@empresa.com"
        validar_email_formato("email-invalido")       → ValueError
        validar_email_formato("")                     → ""
    """
    email = str(email or "").strip().lower()

    # Regex simples que verifica presença de @ e domínio com ponto.
    # Não usa RFC 5322 completo para evitar rejeitar emails válidos incomuns.
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("Email invalido.")

    return email


# =============================================================================
# Schemas de Empresa
# =============================================================================

class EmpresaBase(BaseModel):
    """Campos base compartilhados entre criação e atualização de empresas.

    Representa os dados cadastrais de uma empresa transportadora no sistema.
    Cada empresa é um "tenant" isolado — todos os seus dados (usuários,
    veículos, lançamentos, motoristas) são filtrados por empresa_id.

    Campos obrigatórios:
        nome: Razão social da empresa (mínimo 1 caractere).

    Todos os outros campos são opcionais com default de string vazia,
    permitindo cadastro gradual de informações da empresa.
    """
    nome: str = Field(..., min_length=1, max_length=160)          # razão social (obrigatório)
    nome_fantasia: str = Field("", max_length=160)                # nome de uso comercial
    cnpj: str = Field("", max_length=20)                          # armazenado sem formatação (só dígitos)
    inscricao_estadual: str = Field("", max_length=40)
    telefone: str = Field("", max_length=30)
    email: str = ""                                               # email de contato da empresa
    endereco: str = Field("", max_length=255)                     # logradouro completo
    cidade: str = Field("", max_length=120)
    estado: str = Field("", max_length=2)                         # sigla UF (ex: "SP", "MG")
    cep: str = Field("", max_length=12)                           # com ou sem hífen
    logo: str = ""                                                # imagem em base64 (até ~1MB)
    observacoes: str = Field("", max_length=1000)
    status: str = "ativo"                                         # "ativo" ou "inativo"

    @field_validator(
        "nome", "nome_fantasia", "inscricao_estadual", "telefone",
        "endereco", "cidade", "estado", "cep", "observacoes", "status",
        mode="before"
    )
    @classmethod
    def strip_texto(cls, value: str) -> str:
        """Remove espaços nas bordas de todos os campos de texto.

        Executado antes da validação de tipo (mode="before") para garantir
        que campos enviados com espaços acidentais sejam limpos automaticamente.
        None é convertido para string vazia.
        """
        return str(value or "").strip()

    @field_validator("cnpj", mode="before")
    @classmethod
    def validar_cnpj(cls, value: str) -> str:
        """Limpa e valida o CNPJ, aceitando formatos com ou sem máscara.

        Aceita: "12.345.678/0001-90" ou "12345678000190"
        Rejeita: qualquer valor que após limpeza não tenha exatamente 14 dígitos.
        Aceita string vazia (CNPJ é opcional no cadastro).
        """
        cnpj = limpar_cnpj(value)
        if cnpj and len(cnpj) != 14:
            raise ValueError("CNPJ deve ter 14 digitos.")
        return cnpj  # armazena apenas dígitos, sem formatação

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        """Garante que o status seja um dos valores permitidos pelo sistema.

        STATUS_VALIDOS é importado de models.py para manter a lista centralizada.
        """
        if value not in STATUS_VALIDOS:
            raise ValueError("Status invalido.")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def validar_email(cls, value: str) -> str:
        """Delega a validação de email para a função auxiliar compartilhada."""
        return validar_email_formato(value)

    @field_validator("logo", mode="before")
    @classmethod
    def validar_logo(cls, value: str) -> str:
        """Limita o tamanho da logo enviada em base64.

        A imagem é armazenada como string base64 diretamente no banco.
        Limite de ~1.5MB da string base64 equivale a ~1MB de imagem real
        (base64 infla ~33% o tamanho original).

        Recomenda-se que o frontend redimensione a imagem antes de enviar.
        """
        texto = str(value or "")
        if texto and len(texto) > 1_500_000:
            raise ValueError("Logo muito grande. Use imagem menor que aproximadamente 1MB.")
        return texto


class EmpresaCreate(EmpresaBase):
    """Schema para criação de uma nova empresa.

    Herda todos os campos e validadores de EmpresaBase.
    Não adiciona campos extras — a empresa é criada com os dados básicos
    e pode ser complementada depois via EmpresaUpdate.

    Usado em: POST /empresas/
    """
    pass


class EmpresaUpdate(EmpresaBase):
    """Schema para atualização de dados de uma empresa existente.

    Herda todos os campos e validadores de EmpresaBase.
    A atualização é completa (PUT), não parcial (PATCH) — todos os campos
    devem ser enviados mesmo que não tenham mudado.

    Usado em: PUT /empresas/{id}
    """
    pass


class EmpresaOut(EmpresaBase):
    """Schema de resposta para dados de empresa retornados pela API.

    Adiciona campos gerados pelo servidor que não são enviados na criação:
        id:         identificador único da empresa no banco (chave primária)
        created_at: timestamp de quando a empresa foi cadastrada
        updated_at: timestamp da última modificação

    from_attributes=True: permite converter diretamente de objeto ORM:
        EmpresaOut.model_validate(empresa_orm)

    Usado nas respostas de: GET /empresas/, GET /empresas/{id}, POST /empresas/
    """
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# =============================================================================
# Schemas de Usuário
# =============================================================================

class UsuarioBase(BaseModel):
    """Campos base compartilhados entre criação e atualização de usuários.

    Representa um usuário do sistema administrativo (não confundir com
    motoristas, que têm seu próprio modelo e autenticação separada).

    Perfis disponíveis (definidos em models.py → PERFIS_VALIDOS):
        master:      acesso total ao sistema, incluindo configurações globais
        admin:       acesso total dentro da empresa, não acessa outras empresas
        gestor:      gerencia operações e finanças, sem acesso a configurações
        financeiro:  acesso focado em lançamentos, contas e relatórios
        operador:    acesso operacional (veículos, motoristas, estoque)
        visualizador: somente leitura em todo o sistema

    O campo empresa_id pode ser None no schema mas é sempre preenchido
    pelo backend (via token JWT) antes de salvar no banco.
    """
    nome: str = Field(..., min_length=1, max_length=160)  # nome completo do usuário
    email: str                                             # usado como login (único por empresa)
    perfil: str                                            # define permissões de acesso
    status: str = "ativo"                                  # "ativo" ou "inativo"
    empresa_id: int | None = None                          # definido pelo backend, não pelo cliente
    telefone: str = Field("", max_length=30)              # contato do usuário
    cargo: str = Field("", max_length=100)                 # cargo/função na empresa

    @field_validator("nome", "perfil", "status", "telefone", "cargo", mode="before")
    @classmethod
    def strip_texto(cls, value: str) -> str:
        """Remove espaços nas bordas e trata None como string vazia."""
        return str(value or "").strip()

    @field_validator("perfil")
    @classmethod
    def validar_perfil(cls, value: str) -> str:
        """Valida que o perfil é um dos valores permitidos pelo sistema.

        PERFIS_VALIDOS é importado de models.py para manter a lista centralizada.
        Impede criação de usuários com perfis inventados.
        """
        if value not in PERFIS_VALIDOS:
            raise ValueError("Perfil invalido.")
        return value

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        """Garante que o status seja um dos valores permitidos pelo sistema."""
        if value not in STATUS_VALIDOS:
            raise ValueError("Status invalido.")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def validar_email(cls, value: str) -> str:
        """Delega a validação de email para a função auxiliar compartilhada."""
        return validar_email_formato(value)


class UsuarioCreate(UsuarioBase):
    """Schema para criação de um novo usuário administrativo.

    Adiciona o campo `senha` obrigatório. O backend converte a senha
    em hash bcrypt antes de salvar no banco (nunca salva texto puro).

    A senha mínima de 8 caracteres é validada pelo Pydantic antes
    de chegar ao endpoint. Máximo de 128 para prevenir ataques DoS
    com senhas muito longas (o bcrypt tem custo proporcional ao tamanho).

    Usado em: POST /usuarios/
    """
    senha: str = Field(..., min_length=8, max_length=128)


class UsuarioUpdate(UsuarioBase):
    """Schema para atualização de dados de um usuário existente.

    A senha é opcional na atualização — se não enviada (None),
    o backend mantém a senha atual sem alteração.

    Se enviada, deve seguir os mesmos requisitos de UsuarioCreate.

    Usado em: PUT /usuarios/{id}
    """
    senha: str | None = Field(None, min_length=8, max_length=128)


class AlterarSenhaIn(BaseModel):
    """Schema para o endpoint de alteração de senha do próprio usuário.

    Endpoint separado de UsuarioUpdate para permitir que qualquer usuário
    autenticado altere sua própria senha sem precisar de permissão de admin.
    Tipicamente chamado quando deve_trocar_senha=True no usuário.

    Usado em: POST /usuarios/alterar-senha (ou similar)
    """
    senha: str = Field(..., min_length=8, max_length=128)


class UsuarioOut(UsuarioBase):
    """Schema de resposta para dados de usuário retornados pela API.

    Inclui campos gerados pelo servidor e informações de sessão.
    NUNCA expõe senha_hash — o campo senha_hash do modelo ORM
    é simplesmente omitido por não estar declarado aqui.

    Campos adicionais em relação ao UsuarioBase:
        id:               identificador único do usuário
        empresa_id:       obrigatório na saída (pode ser None na entrada)
        ultimo_login:     timestamp do último login bem-sucedido (None se nunca logou)
        deve_trocar_senha: True se o admin exigiu troca de senha no próximo login
        created_at/updated_at: timestamps de auditoria

    Usado nas respostas de: GET /auth/me, POST /auth/login, GET /usuarios/{id}
    """
    id: int
    empresa_id: int                        # sempre preenchido na resposta
    ultimo_login: datetime | None = None   # None se o usuário nunca fez login
    deve_trocar_senha: bool = False        # flag para forçar troca de senha
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# =============================================================================
# Schemas de Autenticação
# =============================================================================

class LoginIn(BaseModel):
    """Schema para o corpo da requisição de login.

    Recebe email e senha do usuário. O email é normalizado para minúsculas
    antes da busca no banco, permitindo login case-insensitive.

    Usado em: POST /auth/login
    """
    email: str
    # min_length=1: impede envio de senha vazia que causaria comportamento
    # inesperado no bcrypt. max_length=128: prevenção contra DoS.
    senha: str = Field(..., min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def validar_email(cls, value: str) -> str:
        """Normaliza e valida o email antes da busca no banco."""
        return validar_email_formato(value)


class TokenOut(BaseModel):
    """Schema de resposta para o endpoint de login bem-sucedido.

    Retorna o token JWT e os dados públicos do usuário autenticado.
    O frontend (app.js) usa este retorno para:
        1. Armazenar o access_token no localStorage
        2. Exibir o nome e perfil do usuário na interface
        3. Verificar deve_trocar_senha e redirecionar se necessário

    Campos:
        access_token: JWT assinado com a chave secreta (settings.jwt_secret_key).
                      Deve ser enviado em todas as requisições autenticadas
                      no header: Authorization: Bearer <access_token>
        token_type:   Sempre "bearer" (padrão OAuth2)
        usuario:      Dados públicos do usuário logado (sem senha_hash)

    Usado em: POST /auth/login (response_model)
    """
    access_token: str
    token_type: str = "bearer"  # padrão OAuth2, sempre "bearer" neste sistema
    usuario: UsuarioOut          # dados do usuário para o frontend popular a UI
