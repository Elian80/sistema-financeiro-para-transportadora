# Auditoria Inicial de Segurança

Data: 2026-04-30

Backup completo criado antes das alterações em:

`C:\Users\julia\Desktop\PROJETO FINANCEIRO\backup_20260430_1858`

## Estrutura Encontrada

- Backend FastAPI principal em `python/main.py`, com `python/web.py` servindo o frontend.
- Frontend PWA/Electron em `renderer/`.
- Armazenamento atual em arquivos JSON dentro de `python/data/`.
- Login visual em `renderer/login.html` com validação simulada em `renderer/login.js`.
- Chamadas HTTP centralizadas em `apiGet`, `apiSend` e `apiDelete` em `renderer/app.js`.

## Problemas Encontrados

| Risco | Problema | Impacto | Correção Planejada |
|---|---|---|---|
| Alto | Ausência de autenticação real no backend | Qualquer pessoa com acesso à URL pode consultar, criar, alterar e excluir dados | Implementar JWT, `/auth/login`, `/auth/me` e proteção das rotas |
| Alto | CORS com `allow_origins=["*"]` | Permite chamadas de origens desconhecidas | Usar `CORS_ORIGINS` por ambiente |
| Alto | Dados globais em JSON sem `empresa_id` | Não existe isolamento multiempresa | Criar PostgreSQL com `empresa_id` e migração controlada |
| Alto | Senha fake no frontend (`teste/teste`) | Autenticação bypassada no cliente | Conectar login visual ao backend real |
| Alto | Endpoints de escrita sem controle de perfil | Usuários sem permissão poderiam excluir/alterar dados | Implementar perfis e `require_roles` |
| Médio | Uso intenso de `innerHTML` com dados de usuário | Risco de XSS se texto malicioso for salvo | Criar `escapeHtml` e aplicar nos fluxos críticos |
| Médio | Upload de imagens base64 sem limite forte | Risco de consumo excessivo de memória/armazenamento | Limitar tamanho e validar tipo |
| Médio | Erros podem expor mensagens internas em desenvolvimento | Vazamento de detalhes técnicos | Middleware de erro/ambiente e mensagens seguras |
| Médio | Ausência de logs/auditoria | Ações sensíveis não são rastreáveis | Criar tabela `audit_logs` |
| Médio | Sem proteção contra brute force no login | Tentativas automatizadas de senha | Adicionar base para rate limit |
| Baixo | `.env` já ignorado, mas sem `.env.example` | Configuração sensível não documentada | Criar `.env.example` |

## Plano de Correção

1. Criar configuração segura por variáveis de ambiente.
2. Adicionar estrutura `backend/` com SQLAlchemy, modelos, schemas, segurança e dependências.
3. Criar PostgreSQL/Alembic com tabelas multiempresa.
4. Implementar autenticação real com hash bcrypt e JWT.
5. Criar rotas de empresas e usuários com permissões.
6. Proteger endpoints existentes por middleware JWT durante a transição.
7. Criar script de migração dos JSON para PostgreSQL.
8. Conectar login visual ao endpoint real sem alterar aparência.
9. Adicionar headers de segurança e CORS restrito.
10. Documentar backup, testes de segurança e operação.

## Observação de Transição

Os JSON atuais serão mantidos para compatibilidade. Durante a transição, rotas legadas ficam protegidas por autenticação e restritas à empresa padrão até a migração total dos CRUDs para PostgreSQL.
