# Testes de Segurança

Data: 2026-04-30

## Testes Executados

| # | Cenário | Resultado |
|---|---|---|
| 1 | Usuário sem token acessando `GET /veiculos` | `401` |
| 2 | Usuário de outra empresa acessando rotas legadas JSON | `403` |
| 3 | Perfil `visualizador` tentando criar lançamento | `403` |
| 4 | Perfil `operador` tentando criar usuário | `403` |
| 5 | Senha/hash retornando no login | Não retorna |
| 6 | Token inválido em rota protegida | `401` |
| 7 | Usuário inativo tentando logar | `403` |
| 8 | Busca com payload simples de SQL injection | Sem efeito SQL, rota retorna controlado |
| 9 | XSS no frontend | Criada função `escapeHtml`; aplicada no cadastro de usuários. Pendência: aplicar em todos os renders antigos |
| 10 | CORS com origem desconhecida em produção | CORS agora vem de `CORS_ORIGINS`; pendente validar com domínio real de produção |

## Comandos Usados

```bash
python -m py_compile python/main.py python/web.py python/backend/*.py scripts/*.py
node --check renderer/app.js
node --check renderer/login.js
```

Também foi usado `fastapi.testclient.TestClient` para validar autenticação e permissões.

## Pendências de Teste

- Testar PostgreSQL real local com `alembic upgrade head`.
- Testar migração JSON em uma base PostgreSQL vazia.
- Revisar visualmente a tela de usuários.
- Aplicar escape HTML em todos os pontos antigos que usam `innerHTML`.
