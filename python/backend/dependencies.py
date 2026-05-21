"""
# =============================================================================
# dependencies.py — Dependencies FastAPI: Autenticação e Controle de Acesso
# =============================================================================
#
# Este módulo centraliza todas as "dependencies" (Depends) de autenticação
# e autorização do sistema. É importado por routers, middleware e endpoints
# sempre que for necessário validar identidade ou permissões de um usuário.
#
# COMO AS DEPENDENCIES FASTAPI FUNCIONAM:
#   O FastAPI resolve automaticamente as dependencies declaradas nos
#   parâmetros de funções com Depends(). Por exemplo:
#
#       @router.get("/rota")
#       def endpoint(usuario: Usuario = Depends(get_current_user)):
#           ...  # usuario já foi validado antes de chegar aqui
#
# DOIS CONTEXTOS DE USO:
#   1. Rotas com Depends(get_current_user):
#      Lê o token do header Authorization: Bearer <token> e retorna o usuário.
#      Usado diretamente nos endpoints que precisam do objeto usuário.
#
#   2. Middleware global (main.py → ROTAS_PROTEGIDAS):
#      O middleware chama get_current_user internamente e salva o usuário
#      em request.state.usuario. Os endpoints usam request_user() para
#      recuperar esse usuário já carregado (sem nova consulta ao banco).
#
# TIPOS DE TOKEN JWT NO SISTEMA:
#   - "access":          para usuários administrativos (admin, gestor, etc.)
#                        Gerado em auth.py → POST /auth/login
#   - "motorista_access": para motoristas no app mobile PWA (motorista.html/js)
#                        Gerado em routers/motoristas.py → POST /motoristas/login
#
# PERFIS DE USUÁRIO (ordem crescente de permissão):
#   visualizador → operador → financeiro → gestor → admin → master
#
# DEPENDÊNCIAS EXTERNAS:
#   - security.py:  decodificar_token() → valida assinatura e extrai payload JWT
#   - models.py:    modelo ORM Usuario
#   - database.py:  get_db() → sessão de banco de dados
# =============================================================================
"""

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Usuario
from .security import decodificar_token


# =============================================================================
# Scheme de Autenticação Bearer
# =============================================================================

# HTTPBearer extrai automaticamente o token do header:
#   Authorization: Bearer eyJhbGci...
# auto_error=False: não lança exceção se o header estiver ausente.
# Isso permite que get_current_user gere uma mensagem de erro mais descritiva.
bearer_scheme = HTTPBearer(auto_error=False)


# =============================================================================
# Dependency Principal: Usuário Autenticado via Token JWT
# =============================================================================

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    """Valida o token JWT e retorna o usuário autenticado correspondente.

    É a dependency central de autenticação do sistema. Usada diretamente
    nos endpoints que precisam do objeto usuário e também pelo middleware
    global (main.py) para pré-carregar o usuário em request.state.

    Fluxo de validação:
        1. Verifica se o header Authorization: Bearer <token> foi enviado
        2. Decodifica e valida a assinatura do JWT (via security.py)
        3. Extrai o ID do usuário do campo "sub" do payload
        4. Busca o usuário no banco pelo ID
        5. Verifica se o usuário ainda está com status "ativo"

    Segurança:
        - Tokens expirados são rejeitados pelo decodificar_token()
        - Usuários desativados após emissão do token são bloqueados no passo 5
        - Erros de parsing ou assinatura inválida resultam em HTTP 401

    Args:
        credentials: Token JWT extraído do header Authorization pelo HTTPBearer.
                     Será None se o header não foi enviado (auto_error=False).
        db: Sessão de banco de dados injetada pelo FastAPI.

    Returns:
        Usuario: Objeto ORM do usuário autenticado e ativo.

    Raises:
        HTTPException 401: Header ausente, token inválido/expirado,
                           usuário não encontrado ou inativo.
    """
    # Rejeita requisições sem token de autenticação
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticacao obrigatoria."
        )

    try:
        # Decodifica o JWT: valida assinatura HMAC, expiração e formato
        payload = decodificar_token(credentials.credentials)

        # "sub" (subject) é o campo padrão JWT que armazena o ID do usuário
        # como string. Convertemos para int para busca no banco.
        usuario_id = int(payload.get("sub"))
    except Exception as exc:
        # Cobre: token malformado, assinatura inválida, expirado, sub ausente
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalido."
        ) from exc

    # Busca o usuário pelo ID primário (db.get é mais eficiente que db.query
    # com filter quando se tem a chave primária)
    usuario = db.get(Usuario, usuario_id)

    # Dupla validação: usuário deve existir E estar com status "ativo".
    # Isso bloqueia usuários desativados mesmo que ainda tenham token válido.
    if not usuario or usuario.status != "ativo":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario inativo ou inexistente."
        )

    return usuario


# =============================================================================
# Dependency Leve: Usuário do Request State (após middleware)
# =============================================================================

def request_user(request: Request) -> Usuario:
    """Recupera o usuário já autenticado pelo middleware global.

    Esta é uma alternativa leve a get_current_user() para endpoints dentro
    de rotas protegidas pelo middleware global (ROTAS_PROTEGIDAS em main.py).

    DIFERENÇA EM RELAÇÃO A get_current_user():
        - get_current_user(): lê o header, decodifica o JWT e consulta o banco.
          Deve ser usada quando o endpoint é acessado sem passar pelo middleware.
        - request_user():     apenas recupera o usuário já carregado pelo
          middleware em request.state.usuario. Não faz nova consulta ao banco.
          É mais eficiente quando o middleware já garantiu a autenticação.

    Uso típico em endpoints de rotas protegidas:
        @router.get("/dados")
        def endpoint(
            request: Request,
            usuario: Usuario = Depends(request_user),
        ):
            ...

    Args:
        request: Objeto da requisição HTTP com o estado setado pelo middleware.

    Returns:
        Usuario: Objeto ORM do usuário autenticado (já carregado pelo middleware).

    Raises:
        HTTPException 401: Se request.state.usuario não foi definido pelo
                           middleware (ex: rota acessada fora do contexto esperado).
    """
    # O middleware em main.py faz: request.state.usuario = usuario
    # getattr com None como padrão evita AttributeError se o atributo não existir
    usuario = getattr(request.state, "usuario", None)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticacao obrigatoria."
        )

    return usuario


# =============================================================================
# Factory de Dependency: Controle de Acesso por Perfil (RBAC)
# =============================================================================

def require_roles(perfis: list[str]) -> Callable[[Usuario], Usuario]:
    """Cria uma dependency que exige que o usuário tenha um dos perfis listados.

    Implementa RBAC (Role-Based Access Control) para endpoints que exigem
    permissão específica. Master e admin sempre têm acesso irrestrito.

    Uso nos endpoints:
        @router.delete("/recurso/{id}")
        def deletar(
            usuario: Usuario = Depends(require_roles(["gestor", "financeiro"]))
        ):
            ...  # só chega aqui se o usuário for master, admin, gestor ou financeiro

    Hierarquia de perfis (da menor para maior permissão):
        visualizador → operador → financeiro → gestor → admin → master

    Args:
        perfis: Lista de perfis que têm acesso ao endpoint.
                Master e admin são sempre permitidos independente desta lista.

    Returns:
        Callable: Dependency FastAPI que valida o perfil do usuário.

    Raises:
        HTTPException 403: Se o usuário não tiver o perfil necessário.
    """
    def dependency(usuario: Usuario = Depends(get_current_user)) -> Usuario:
        """Dependency interna que verifica o perfil do usuário autenticado."""
        # Master e admin têm acesso irrestrito a todos os recursos do sistema.
        # Os demais perfis só têm acesso se estiverem explicitamente na lista.
        if usuario.perfil in {"master", "admin"} or usuario.perfil in perfis:
            return usuario

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissao insuficiente."
        )

    return dependency


# =============================================================================
# Verificação de Permissão de Escrita por Domínio
# =============================================================================

def usuario_pode_escrever(usuario: Usuario, dominio: str) -> bool:
    """Verifica se o usuário tem permissão de escrita em um domínio específico.

    Complementa o RBAC de require_roles() com controle fino por domínio
    funcional. É chamada dentro de endpoints para validar operações de
    criação, edição e exclusão com base no perfil e no contexto da operação.

    Domínios disponíveis no sistema:
        - "lancamentos":  lançamentos financeiros (receitas/despesas)
        - "contas":       contas bancárias e caixas
        - "relatorios":   geração e exportação de relatórios
        - "ativos":       ativos da empresa (veículos, equipamentos)
        - "passivos":     passivos e obrigações financeiras
        - "folha":        folha de pagamento de motoristas e funcionários
        - "veiculos":     cadastro e manutenção de veículos
        - "motoristas":   cadastro e gestão de motoristas
        - "estoque":      controle de estoque (peças, combustível, etc.)

    Matriz de permissões por perfil:
        master/admin/gestor: escrita em TODOS os domínios
        financeiro:          escrita em lancamentos, contas, relatorios, ativos, passivos, folha
        operador:            escrita em veiculos, motoristas, estoque, lancamentos
        visualizador:        somente leitura (nunca pode escrever)

    Args:
        usuario: Objeto ORM do usuário autenticado.
        dominio: Nome do domínio funcional sendo acessado.

    Returns:
        bool: True se o usuário pode criar/editar/excluir no domínio, False caso contrário.
    """
    # Perfis de gestão têm permissão total de escrita em qualquer domínio
    if usuario.perfil in {"master", "admin", "gestor"}:
        return True

    # Visualizador é estritamente somente leitura em todo o sistema
    if usuario.perfil == "visualizador":
        return False

    # Financeiro: pode escrever apenas nos domínios financeiros e contábeis
    if usuario.perfil == "financeiro":
        return dominio in {"lancamentos", "contas", "relatorios", "ativos", "passivos", "folha"}

    # Operador: pode escrever nos domínios operacionais de transporte
    if usuario.perfil == "operador":
        return dominio in {"veiculos", "motoristas", "estoque", "lancamentos"}

    # Perfil desconhecido: nega por padrão (fail-safe)
    return False
