# Sistema Financeiro

Aplicacao FastAPI + PostgreSQL + PWA/Electron para gestao financeira e operacional com base multiempresa, preparada para evoluir para SaaS.

## Como Abrir Localmente

Para uso local no Windows:

```bat
iniciar_pwa.bat
```

Para testar pelo celular ou outro computador usando link temporario:

```bat
abrir_link_teste.bat
```

## Login Inicial

```text
Master: master@sistema.local / Master123
Admin:  admin@sistema.local  / trocar123
```

Troque as senhas iniciais depois de validar o acesso.

## Banco de Dados

O projeto usa PostgreSQL quando existe `.env` com `DATABASE_URL`.

Exemplo local:

```env
DATABASE_URL=postgresql+psycopg://admim:1234@localhost:5432/financeiro
JWT_SECRET_KEY=troque_esta_chave_por_uma_chave_forte_123456
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=development
CORS_ORIGINS=http://127.0.0.1:8001,http://localhost:8001,http://127.0.0.1:8000,http://localhost:8000
SECURE_COOKIES=false
```

Sem `.env`, o sistema usa SQLite apenas como fallback de desenvolvimento.

## Preparar PostgreSQL Local

No Windows, rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\configurar_postgres.ps1
```

Depois aplique banco/dados quando necessario:

```bash
alembic upgrade head
python scripts/migrar_json_para_postgres.py
```

## Publicar Online

Para subir em servidor e usar como SaaS, use os modelos e checklist em:

```text
deploy/README.md
```

Para gerar um `.zip` limpo para upload:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\gerar_pacote_deploy.ps1
```

O pacote fica em:

```text
dist/financeiro-saas.zip
```

Arquivos principais para upload:

```text
python/
renderer/
scripts/
deploy/
requirements.txt
package.json
package-lock.json
alembic.ini
.env.production.example
```

Nao envie `.env`, `node_modules/`, `python/data/`, `backups/`, `tools/` nem logs.

## Documentacao

- Estrutura do projeto: `docs/PROJECT_STRUCTURE.md`
- Arquitetura: `docs/ARCHITECTURE.md`
- Fluxo do banco: `docs/DATABASE_FLOW.md`
- Backup: `docs/BACKUP.md`
- Auditoria de seguranca: `docs/SECURITY_AUDIT.md`
- Testes de seguranca: `docs/SECURITY_TESTS.md`
- Relatorio de implementacao: `docs/IMPLEMENTATION_REPORT.md`
