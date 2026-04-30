# Sistema Financeiro

Aplicação FastAPI + PWA/Electron para gestão financeira e operacional.

## Instalação

```bash
python -m pip install -r requirements.txt
npm install
```

## Configuração de ambiente

Copie `.env.example` para `.env` e ajuste:

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

O arquivo `.env` real não deve ser enviado ao Git.

## PostgreSQL

1. Instale o PostgreSQL.
2. Crie banco e usuário:

```sql
CREATE DATABASE financeiro;
CREATE USER financeiro_user WITH PASSWORD 'SENHA_FORTE';
GRANT ALL PRIVILEGES ON DATABASE financeiro TO financeiro_user;
```

3. Rode migrations:

```bash
alembic upgrade head
```

## Migração dos JSON atuais

```bash
python scripts/migrar_json_para_postgres.py
```

Isso cria:

- empresa padrão `GM7 Solucoes`;
- usuário admin inicial `admin@sistema.local`;
- senha inicial `trocar123`;
- registros JSON associados à empresa padrão.

## Rodar backend/PWA

```bash
npm.cmd run web
```

Acesse:

```text
http://127.0.0.1:8000
```

## Login

Depois de migrar:

```text
Email: admin@sistema.local
Senha: trocar123
```

Troque essa senha após o primeiro acesso.

## Segurança implementada

- Hash de senha com bcrypt.
- JWT bearer token.
- Rotas `/auth/login` e `/auth/me`.
- Rotas de empresas e usuários protegidas por perfil.
- Rotas legadas protegidas por token durante a transição.
- Bloqueio de usuários inativos.
- CORS configurável por ambiente.
- Headers básicos de segurança.
- Auditoria inicial em `SECURITY_AUDIT.md`.

## Backup

Veja `BACKUP.md`.
