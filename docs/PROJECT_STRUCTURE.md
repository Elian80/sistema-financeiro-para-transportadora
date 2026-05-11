# Estrutura do Projeto

```text
Financeiro/
  python/                 Backend FastAPI e camada de banco
    backend/              Configuracoes, modelos, autenticacao e rotas admin
    backend/migrations/   Migrations Alembic
    main.py               API principal
    web.py                API + arquivos estaticos do frontend
  renderer/               Frontend PWA servido pelo FastAPI
    login.html
    index.html
    app.js
    style.css
    manifest.webmanifest
    icons/
  scripts/                Automacoes locais e operacionais
    configurar_postgres.ps1
    migrar_json_para_postgres.py
    backup_postgres.py
    abrir_link_teste.ps1
  deploy/                 Modelos para publicar online
    nginx/
    systemd/
    README.md
  docs/                   Documentacao tecnica do projeto
  requirements.txt        Dependencias Python
  package.json            Scripts locais/Electron
  alembic.ini             Configuracao de migrations
  .env.example            Exemplo local
  .env.production.example Exemplo para servidor
```

## Arquivos Que Nao Sobem

Estes arquivos sao locais ou temporarios e ficam protegidos pelo `.gitignore`:

- `.env`
- `node_modules/`
- `python/data/`
- `backups/`
- `tools/`
- `*.log`
- `ABRIR_LINK_PUBLICO.url`
- `LINK_PUBLICO_CELULAR.txt`

## Entrada da Aplicacao

- Local Windows: `iniciar_pwa.bat` ou `abrir_link_teste.bat`.
- Servidor Linux: `python -m uvicorn web:app --host 127.0.0.1 --port 8000`, normalmente via systemd.
- Navegador: `/` abre login e `/app` abre a aplicacao principal.

## Banco

O SaaS deve usar PostgreSQL via `DATABASE_URL`.

SQLite continua existindo apenas como fallback de desenvolvimento quando nao houver `.env`.
