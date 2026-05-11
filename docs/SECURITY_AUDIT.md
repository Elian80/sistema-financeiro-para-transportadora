# Auditoria de Seguranca

Data: 2026-04-30

Backups criados antes das alteracoes principais:

- `C:\Users\julia\Desktop\PROJETO FINANCEIRO\backup_20260430_1858`
- `C:\Users\julia\Desktop\PROJETO FINANCEIRO\backup_20260430_2006`

## Problemas Encontrados e Tratamento

| Risco | Problema | Situacao Atual |
|---|---|---|
| Alto | Login falso no frontend | Substituido por `POST /auth/login` com JWT e bcrypt |
| Alto | Rotas de dados sem autenticacao | Middleware exige token nas rotas legadas |
| Alto | Ausencia de usuario dono do sistema | Criado perfil `master` com painel global |
| Alto | Usuarios bloqueados ainda poderiam manter sessao | `get_current_user` bloqueia novas requisicoes de usuarios nao ativos |
| Alto | CORS amplo | Origens controladas por `CORS_ORIGINS` |
| Medio | Dados JSON globais sem `empresa_id` | Protegidos por JWT durante transicao; migracao SQL preparada |
| Medio | Falta de auditoria administrativa | Criada tabela `audit_logs` e eventos de login/gestao |
| Medio | Upload de logo sem politica clara | Campo limitado no schema; pendente armazenamento dedicado |
| Medio | XSS por `innerHTML` em telas antigas | `escapeHtml` existe e novas telas usam escape; pendente aplicar em todos os renders antigos |
| Medio | Brute force no login | Rate limit simples em memoria; pendente backend persistente |
| Baixo | Documentacao incompleta | Criados `docs/ARCHITECTURE.md` e `docs/DATABASE_FLOW.md` |

## Controles Implementados

- Hash de senha com bcrypt/passlib.
- JWT com expiracao configuravel.
- Validacao de usuario ativo em login e requisicoes.
- Perfis `master`, `admin`, `gestor`, `financeiro`, `operador`, `visualizador`.
- Rotas administrativas protegidas por perfil.
- Separacao por empresa nas rotas SQL.
- Headers basicos de seguranca.
- `.env.example` sem segredo real e `.env` ignorado.
- Script de migracao JSON para banco.
- Script/BAT de inicializacao local e tunel remoto de teste.

## Plano de Correcao Restante

1. Migrar todos os CRUDs legados de JSON para SQLAlchemy.
2. Criar testes automatizados permanentes.
3. Trocar rate limit em memoria por Redis ou tabela SQL em producao.
4. Criar politica final para armazenamento de logos e arquivos.
5. Revisar todos os usos antigos de `innerHTML`.
6. Configurar CORS, CSP e dominio real antes de producao.
7. Implementar refresh token revogavel.
