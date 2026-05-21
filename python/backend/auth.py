"""
# =============================================================================
# auth.py — Rotas de Autenticação do Sistema Financeiro para Transportadoras
# =============================================================================
#
# Este módulo define as rotas públicas de autenticação do sistema:
#   - POST /auth/login  → valida credenciais e retorna JWT
#   - GET  /auth/me     → retorna dados do usuário logado
#   - POST /auth/logout → encerra sessão no lado do cliente
#
# FLUXO DE AUTENTICAÇÃO:
#   1. O frontend (app.js) chama POST /auth/login com email + senha
#   2. O backend valida as credenciais e devolve um access_token JWT
#   3. O frontend armazena o token e o envia no header Authorization
#      nas chamadas subsequentes às rotas protegidas
#   4. O middleware global (main.py) intercepta as rotas em ROTAS_PROTEGIDAS
#      e valida o token via get_current_user (dependencies.py)
#
# TOKENS:
#   - "access": token para usuários administrativos (admin, gestor, etc.)
#   - "motorista_access": token específico para motoristas no app mobile PWA
#     (motorista.html/js). Esse tipo NÃO é gerado aqui — veja o router de motoristas.
#
# MULTI-TENANT:
#   O token JWT embute empresa_id, garantindo que cada usuário só acesse
#   os dados da sua própria empresa.
#
# DEPENDÊNCIAS EXTERNAS:
#   - security.py: criação e verificação de tokens JWT e hash de senha
#   - models.py: modelo ORM de Usuario e AuditLog
#   - dependencies.py: dependency get_current_user para rotas protegidas
# =============================================================================
"""

from datetime import datetime
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuditLog, Usuario
from .schemas import LoginIn, TokenOut, UsuarioOut
from .security import criar_access_token, verificar_senha
from .dependencies import get_current_user


# =============================================================================
# Configuração do Router
# =============================================================================

# Todas as rotas deste módulo ficam sob o prefixo /auth
# e aparecem agrupadas como "auth" na documentação Swagger (/docs)
router = APIRouter(prefix="/auth", tags=["auth"])

# =============================================================================
# Rate Limiting de Login (proteção contra força bruta)
# =============================================================================

# Dicionário em memória que registra os timestamps das tentativas de login
# por chave "{ip}:{email}". É reiniciado a cada restart do servidor.
# Chave: string "ip:email" | Valor: lista de timestamps (float, epoch Unix)
LOGIN_ATTEMPTS: dict[str, list[float]] = {}


def verificar_rate_limit_login(chave: str) -> None:
    """Bloqueia tentativas de login em excesso (proteção contra força bruta).

    Mantém um contador deslizante de tentativas de login em memória.
    Se o mesmo IP + email fizer mais de 5 tentativas em 60 segundos,
    lança HTTP 429 e obriga o cliente a aguardar antes de tentar novamente.

    Chamada internamente por `login()` antes de qualquer consulta ao banco,
    evitando que ataques de força bruta sobrecarreguem o banco de dados.

    Args:
        chave: Identificador único da tentativa, normalmente "{ip}:{email}".
               Combinar IP e email evita que um atacante contorne o limite
               apenas trocando de email (mesmo IP) ou de IP (mesmo email).

    Raises:
        HTTPException 429: Se o limite de tentativas for excedido.
    """
    agora = time()
    janela = 60          # janela de tempo em segundos (1 minuto)
    max_tentativas = 5   # máximo de tentativas permitidas dentro da janela

    # Filtra apenas as tentativas que ocorreram dentro da janela deslizante.
    # Tentativas mais antigas são descartadas automaticamente aqui.
    tentativas = [item for item in LOGIN_ATTEMPTS.get(chave, []) if agora - item < janela]

    if len(tentativas) >= max_tentativas:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Aguarde um minuto."
        )

    # Registra a tentativa atual e atualiza o dicionário com a lista limpa
    tentativas.append(agora)
    LOGIN_ATTEMPTS[chave] = tentativas


# =============================================================================
# Endpoint de Login
# =============================================================================

@router.post("/login", response_model=TokenOut)
def login(dados: LoginIn, request: Request, db: Session = Depends(get_db)):
    """Autentica um usuário e retorna um token JWT de acesso.

    Endpoint público (não requer token). Chamado pelo frontend (app.js)
    na tela de login. Também pode ser chamado por ferramentas de integração.

    Fluxo:
        1. Verifica rate limit para o IP + email (proteção força bruta)
        2. Busca o usuário pelo email no banco de dados
        3. Valida a senha com bcrypt (verificar_senha em security.py)
        4. Recusa login se o usuário não estiver com status "ativo"
        5. Gera token JWT com sub=usuario_id, empresa_id e perfil
        6. Registra evento no AuditLog para rastreabilidade
        7. Retorna o token e os dados públicos do usuário (UsuarioOut)

    Args:
        dados: Body JSON com `email` e `senha` (validados por LoginIn).
        request: Objeto da requisição HTTP, usado para capturar o IP do cliente.
        db: Sessão de banco de dados injetada pelo FastAPI (Depends).

    Returns:
        TokenOut: access_token JWT + tipo "bearer" + dados do usuário (UsuarioOut).

    Raises:
        HTTPException 429: Muitas tentativas de login do mesmo IP/email.
        HTTPException 401: Email não encontrado ou senha incorreta.
        HTTPException 403: Usuário existe mas está inativo, suspenso, etc.
    """
    # Captura o IP do cliente para o rate limit e para o log de auditoria.
    # request.client pode ser None em testes ou por trás de alguns proxies.
    ip = request.client.host if request.client else "desconhecido"

    # Aplica rate limit usando IP + email em minúsculas como chave composta
    verificar_rate_limit_login(f"{ip}:{dados.email.lower()}")

    # Busca o usuário pelo email (sempre em minúsculas para evitar duplicatas)
    usuario = db.query(Usuario).filter(Usuario.email == dados.email.lower()).first()

    # Valida existência do usuário e a senha com hash bcrypt.
    # A mensagem de erro é propositalmente genérica para não revelar
    # se o email existe ou não no sistema (prevenção de enumeração de usuários).
    if not usuario or not verificar_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login ou senha invalidos."
        )

    # Bloqueia usuários que não estão com status "ativo" (ex: "inativo", "suspenso")
    # e registra a tentativa bloqueada no AuditLog para auditoria de segurança
    if usuario.status != "ativo":
        db.add(AuditLog(
            empresa_id=usuario.empresa_id,
            usuario_id=usuario.id,
            acao="login_bloqueado",
            entidade="usuario",
            entidade_id=str(usuario.id),
            detalhes=f"Status: {usuario.status}",  # ex: "Status: inativo"
            ip=ip,
        ))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Usuario {usuario.status}."
        )

    # Atualiza o timestamp do último login antes de gerar o token
    usuario.ultimo_login = datetime.now()

    # Gera o JWT de acesso. O token embute: sub=id, empresa_id e perfil.
    # O perfil no token permite que o middleware verifique permissões
    # sem precisar consultar o banco a cada requisição.
    token = criar_access_token(str(usuario.id), usuario.empresa_id, usuario.perfil)

    # Registra o login bem-sucedido no AuditLog para rastreabilidade completa
    db.add(AuditLog(
        empresa_id=usuario.empresa_id,
        usuario_id=usuario.id,
        acao="login",
        entidade="usuario",
        entidade_id=str(usuario.id),
        detalhes="Login realizado",
        ip=request.client.host if request.client else "",
    ))
    db.commit()

    # Recarrega os dados do usuário do banco para garantir que ultimo_login
    # está atualizado no objeto antes de serializar para a resposta
    db.refresh(usuario)

    return TokenOut(access_token=token, usuario=UsuarioOut.model_validate(usuario))


# =============================================================================
# Endpoint "Quem sou eu?" (dados do usuário autenticado)
# =============================================================================

@router.get("/me", response_model=UsuarioOut)
def me(usuario: Usuario = Depends(get_current_user)):
    """Retorna os dados do usuário atualmente autenticado.

    Requer token JWT válido no header Authorization: Bearer <token>.
    Usado pelo frontend (app.js) para:
      - Preencher o menu com o nome e perfil do usuário logado
      - Verificar permissões de interface (quais menus exibir)
      - Detectar se deve_trocar_senha está ativo e redirecionar

    A injeção de `usuario` via Depends(get_current_user) já valida o token
    e garante que o usuário existe e está ativo no banco.

    Args:
        usuario: Objeto Usuario já validado, injetado por get_current_user.

    Returns:
        UsuarioOut: Dados públicos do usuário (sem senha_hash).
    """
    return usuario


# =============================================================================
# Endpoint de Logout
# =============================================================================

@router.post("/logout")
def logout():
    """Sinaliza que o logout foi solicitado.

    O sistema utiliza tokens JWT stateless (sem sessão no servidor),
    portanto o logout real acontece no cliente, que descarta o token
    do localStorage/sessionStorage.

    Este endpoint existe para:
      - Permitir que o frontend faça uma chamada semântica de logout
      - Facilitar a adição futura de uma blacklist de tokens revogados
      - Manter consistência na API (equivalência com endpoints de login)

    Não registra no AuditLog pois não há informação de usuário disponível
    sem decodificar o token — o frontend pode chamar sem token também.

    Returns:
        dict: Mensagem confirmando que o logout deve ser tratado pelo cliente.
    """
    return {"mensagem": "Logout realizado no cliente."}
