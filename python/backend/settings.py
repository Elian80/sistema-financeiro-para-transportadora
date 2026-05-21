"""
# =============================================================================
# settings.py — Configurações Globais da Aplicação (via Variáveis de Ambiente)
# =============================================================================
#
# Este módulo centraliza TODAS as configurações do sistema usando pydantic-settings.
# As variáveis são lidas prioritariamente de variáveis de ambiente e, se não
# encontradas, do arquivo .env localizado na raiz do projeto (dois níveis acima
# deste arquivo).
#
# LOCALIZAÇÃO DO .env:
#   BASE_DIR aponta para a raiz do projeto (dois níveis acima de backend/).
#   Exemplo de estrutura:
#       /projeto/
#         .env                 ← arquivo de configuração
#         python/
#           backend/
#             settings.py      ← este arquivo
#
# COMO USAR EM OUTROS MÓDULOS:
#   from .settings import settings
#
#   # Acesso às configurações:
#   settings.database_url
#   settings.jwt_secret_key
#   settings.is_production     # property calculada
#   settings.cors_origins_list # property calculada (lista de strings)
#
# EXEMPLO DE ARQUIVO .env PARA PRODUÇÃO:
#   DATABASE_URL=postgresql+psycopg://user:senha@host:5432/financeiro
#   JWT_SECRET_KEY=uma-chave-secreta-muito-longa-e-aleatoria-aqui
#   ENVIRONMENT=production
#   CORS_ORIGINS=https://app.minhaempresa.com.br
#   SECURE_COOKIES=true
#
# INSTÂNCIA SINGLETON:
#   `settings` é um objeto global criado uma vez e cacheado por @lru_cache.
#   Usar `settings` diretamente (não instanciar Settings() novamente) garante
#   que toda a aplicação leia os mesmos valores de configuração.
# =============================================================================
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Diretório raiz do projeto: sobe dois níveis a partir deste arquivo.
# backend/settings.py → backend/ → python/ → projeto/ (raiz)
BASE_DIR = Path(__file__).resolve().parents[2]


# =============================================================================
# Classe de Configurações
# =============================================================================

class Settings(BaseSettings):
    """Configurações globais do sistema financeiro para transportadoras.

    Carregada automaticamente de variáveis de ambiente e/ou arquivo .env.
    Pydantic-settings valida os tipos e executa os field_validators
    durante a instanciação, falhando rapidamente se algo estiver errado.

    Valores padrão são para DESENVOLVIMENTO LOCAL apenas.
    Em produção, TODAS as variáveis sensíveis devem ser definidas
    explicitamente no ambiente ou no .env (nunca versionado no git).
    """

    # -------------------------------------------------------------------------
    # Banco de Dados
    # -------------------------------------------------------------------------

    # URL de conexão com o banco. Formatos aceitos:
    #   Desenvolvimento: sqlite:///./financeiro.db
    #   Produção:        postgresql+psycopg://user:senha@host:5432/financeiro
    # O driver "psycopg" (sem número) é o psycopg3 (versão mais recente).
    database_url: str = "postgresql+psycopg://admim:1234@localhost:5432/financeiro"

    # -------------------------------------------------------------------------
    # Segurança JWT (JSON Web Tokens)
    # -------------------------------------------------------------------------

    # Chave secreta usada para assinar e verificar todos os tokens JWT.
    # CRÍTICO: Em produção, use uma chave aleatória de pelo menos 32 caracteres.
    # Gere com: python -c "import secrets; print(secrets.token_hex(32))"
    # NUNCA versione a chave de produção no git.
    jwt_secret_key: str = "dev-only-change-this-secret"

    # Algoritmo de assinatura do JWT. HS256 (HMAC-SHA256) é o padrão
    # para sistemas com um único servidor. Para múltiplos servidores
    # com chaves assimétricas, usar RS256.
    jwt_algorithm: str = "HS256"

    # Tempo de expiração do access token em minutos (padrão: 60 min = 1 hora).
    # Tokens de usuários administrativos. Tokens de motoristas têm validade
    # própria configurada no router de motoristas.
    access_token_expire_minutes: int = 60

    # Tempo de expiração do refresh token em dias (padrão: 7 dias).
    # Nota: O sistema atual pode não usar refresh tokens ativamente —
    # este campo existe para implementação futura de renovação de sessão.
    refresh_token_expire_days: int = 7

    # -------------------------------------------------------------------------
    # Ambiente de Execução
    # -------------------------------------------------------------------------

    # Define o ambiente de execução. Valores reconhecidos: "development", "production".
    # Usado pela property is_production e pode condicionar comportamentos
    # de log, debug e segurança em outros módulos.
    environment: str = "development"

    # -------------------------------------------------------------------------
    # CORS (Cross-Origin Resource Sharing)
    # -------------------------------------------------------------------------

    # Lista de origens permitidas para requisições CORS, separadas por vírgula.
    # Em desenvolvimento: localhost nas portas padrão do servidor FastAPI.
    # Em produção: domínio(s) do frontend hospedado (ex: https://app.empresa.com).
    # O app.js e motorista.html/js precisam estar em uma dessas origens
    # para que o browser permita chamadas à API.
    cors_origins: str = "http://127.0.0.1:8000,http://localhost:8000"

    # -------------------------------------------------------------------------
    # Cookies de Sessão
    # -------------------------------------------------------------------------

    # Se True, cookies são marcados como Secure (só enviados em HTTPS).
    # Em desenvolvimento (HTTP local) deve ser False.
    # Em produção com HTTPS obrigatoriamente True para segurança.
    secure_cookies: bool = False

    # -------------------------------------------------------------------------
    # Configuração do pydantic-settings
    # -------------------------------------------------------------------------

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",  # caminho do arquivo .env relativo à raiz
        env_file_encoding="utf-8",   # encoding do arquivo .env
        extra="ignore",              # ignora variáveis de ambiente não declaradas aqui
    )

    # =========================================================================
    # Validadores de Segurança
    # =========================================================================

    @field_validator("jwt_secret_key")
    @classmethod
    def validar_chave_jwt(cls, value: str) -> str:
        """Garante que a chave JWT tenha tamanho mínimo em produção.

        Em desenvolvimento, aceita a chave padrão "dev-only-change-this-secret"
        mesmo sendo curta, para não bloquear inicializações locais.

        Em produção (qualquer valor diferente do default), exige mínimo de
        24 caracteres para garantir segurança criptográfica mínima do HMAC-SHA256.
        O ideal em produção é usar 64+ caracteres aleatórios.

        Args:
            value: Valor de JWT_SECRET_KEY do ambiente ou .env.

        Returns:
            str: A chave validada sem modificação.

        Raises:
            ValueError: Se a chave for muito curta em ambiente de produção.
        """
        # Permite a chave de desenvolvimento padrão sem validação de tamanho
        if value == "dev-only-change-this-secret":
            return value

        # Em produção, exige chave com tamanho suficiente para segurança
        if not value or len(value) < 24:
            raise ValueError("JWT_SECRET_KEY deve ter pelo menos 24 caracteres.")

        return value

    # =========================================================================
    # Properties Calculadas (acesso conveniente a configurações derivadas)
    # =========================================================================

    @property
    def cors_origins_list(self) -> list[str]:
        """Converte a string de origens CORS em lista Python.

        O .env armazena as origens como string separada por vírgula:
            CORS_ORIGINS=https://app.empresa.com,https://admin.empresa.com

        Esta property faz o split e limpeza, retornando uma lista pronta
        para ser usada no middleware CORS do FastAPI (main.py).

        Returns:
            list[str]: Lista de origens CORS sem espaços, sem itens vazios.

        Exemplo:
            "http://localhost:8000, http://127.0.0.1:8000 " →
            ["http://localhost:8000", "http://127.0.0.1:8000"]
        """
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        """Indica se o sistema está rodando em ambiente de produção.

        Usado para ativar comportamentos específicos de produção, como:
          - Logs mais restritivos (sem dados sensíveis)
          - Cookies com Secure=True
          - Desabilitar endpoints de debug

        Returns:
            bool: True se ENVIRONMENT == "production" (case-insensitive).
        """
        return self.environment.lower() == "production"


# =============================================================================
# Instância Singleton (objeto global de configurações)
# =============================================================================

@lru_cache
def get_settings() -> Settings:
    """Cria e retorna a instância única de Settings (cacheada).

    O @lru_cache garante que Settings() seja instanciado apenas uma vez
    durante toda a vida da aplicação, mesmo que get_settings() seja chamado
    múltiplas vezes de diferentes módulos.

    Isso é importante porque a instanciação lê o arquivo .env do disco —
    fazer isso a cada requisição seria ineficiente.

    Em testes unitários, use:
        from unittest.mock import patch
        with patch("backend.settings.settings", Settings(database_url="sqlite:///:memory:")):
            ...

    Returns:
        Settings: Instância única e cacheada das configurações.
    """
    return Settings()


# Objeto global importado pelos outros módulos do sistema:
#   from .settings import settings
#
# Usar este objeto (não chamar Settings() diretamente) garante
# que toda a aplicação compartilhe as mesmas configurações cacheadas.
settings = get_settings()
