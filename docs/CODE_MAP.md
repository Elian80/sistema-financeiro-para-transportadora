# Mapa de Código — Financeiro

Este documento resume onde cada parte principal da aplicação está implementada para facilitar manutenção.

## 1) Entrada e execução
- `main.js`: processo principal Electron (abre janela desktop em `renderer/login.html`).
- `python/main.py`: API principal FastAPI (regras de negócio, middleware de segurança, rotas dos módulos).
- `python/web.py`: acopla frontend ao backend (rotas `/`, `/app`, `/motorista` e estáticos).

## 2) Backend (domínio e segurança)
- `python/backend/settings.py`: leitura e validação de variáveis de ambiente.
- `python/backend/database.py`: engine/sessão SQLAlchemy e ajustes de schema em runtime.
- `python/backend/models.py`: modelos ORM e estrutura de tabelas.
- `python/backend/schemas.py`: validação de entrada/saída com Pydantic.
- `python/backend/security.py`: JWT, hash/verificação de senha e regras de senha.
- `python/backend/dependencies.py`: autenticação e autorização por perfil/domínio.
- `python/backend/auth.py`: login do painel administrativo (`/auth/*`).
- `python/backend/admin_routes.py`: gestão de empresas, usuários, auditoria e acessos de motorista.

## 3) Frontend administrativo
- `renderer/login.html|css|js`: tela de login administrativo.
- `renderer/index.html`: shell da SPA (sidebar/topbar/conteúdo).
- `renderer/app.js`: aplicação principal (dashboard, veículos, motoristas, estoque, relatórios, admin, mapa).
- `renderer/style.css`: estilos globais do painel.

## 4) App de motorista (PWA)
- `renderer/motorista.html|css|js`: app mobile para viagens e GPS.
- `renderer/pwa.js`: instalação PWA e registro do service worker.
- `renderer/sw.js`: cache do app shell e estratégia de rede.

## 5) Migrações e utilitários de dados
- `python/backend/migrations/*`: Alembic (schema versionado).
- `python/migrate_to_postgres.py`: migração dos JSON legados para PostgreSQL.
- `scripts/*.py|*.ps1`: backup, migração e automações operacionais.

## 6) Deploy
- `deploy/README.md`: procedimento geral de publicação.
- `deploy/nginx/financeiro.conf`: exemplo de configuração Nginx.
- `deploy/systemd/financeiro.service`: serviço systemd da API.
