# Sistema Financeiro

Aplicacao FastAPI + PWA/Electron para gestao financeira e operacional de transportadora.

## Inicio Rapido

Para uso local:

```bat
iniciar_pwa.bat
```

Para testar em celular ou outro computador pela internet:

```bat
abrir_link_teste.bat
```

O BAT remoto inicia o servidor, prepara o banco, baixa o `cloudflared` se precisar, abre a aplicacao local e mostra no terminal o link publico `trycloudflare.com`.

## Login Inicial

Usuario master do sistema:

```text
Email: master@sistema.local
Senha: Master123
```

Admin da empresa padrao:

```text
Email: admin@sistema.local
Senha: trocar123
```

Troque as senhas iniciais apos validar o acesso.

## Instalacao Manual

```bash
python -m pip install -r requirements.txt
npm install
```

Copie `.env.example` para `.env` e ajuste os dados sensiveis:

```env
DATABASE_URL=postgresql+psycopg://financeiro_user:SENHA_FORTE@localhost:5432/financeiro
JWT_SECRET_KEY=troque_esta_chave_por_uma_chave_forte
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=development
CORS_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
SECURE_COOKIES=false
```

O arquivo `.env` real fica no computador e nao deve ser enviado ao Git.

## PostgreSQL

Em producao ou teste com banco real:

```sql
CREATE DATABASE financeiro;
CREATE USER financeiro_user WITH PASSWORD 'SENHA_FORTE';
GRANT ALL PRIVILEGES ON DATABASE financeiro TO financeiro_user;
```

Depois rode:

```bash
alembic upgrade head
python scripts/migrar_json_para_postgres.py
npm.cmd run web
```

Sem `.env`, o sistema usa SQLite de desenvolvimento em `python/data/financeiro_dev.db` para facilitar testes locais.

## Fluxo do Sistema

1. O frontend abre `login.html`.
2. O usuario envia e-mail e senha para `POST /auth/login`.
3. O backend valida senha com hash bcrypt e retorna JWT.
4. O frontend salva o token em `sessionStorage`.
5. As chamadas `apiGet`, `apiSend` e `apiDelete` enviam `Authorization: Bearer TOKEN`.
6. O backend valida usuario ativo e perfil.
7. Dados administrativos usam PostgreSQL/SQLite via SQLAlchemy.
8. Rotas operacionais legadas continuam em JSON durante a transicao, protegidas por JWT.

Detalhes completos em `ARCHITECTURE.md` e `DATABASE_FLOW.md`.

## Painel Master

Ao entrar como `master`, use a aba `Admin` para:

- ver resumo global;
- cadastrar e editar empresas;
- aprovar, bloquear ou inativar empresas;
- cadastrar usuarios;
- aprovar, bloquear, inativar e forcar troca de senha;
- consultar logs de auditoria.

## Backup

Veja `BACKUP.md`.

## Seguranca

Veja `SECURITY_AUDIT.md` e `SECURITY_TESTS.md`.
