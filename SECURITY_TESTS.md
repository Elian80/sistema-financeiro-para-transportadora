# Testes de Seguranca

Data: 2026-04-30

## Testes Executados

| # | Cenario | Resultado esperado |
|---|---|---|
| 1 | Usuario sem token acessa `GET /veiculos` | `401` |
| 2 | Token invalido em rota protegida | `401` |
| 3 | Login master `master@sistema.local` | `200` e sem senha na resposta |
| 4 | Master acessa `GET /admin/resumo` | `200` |
| 5 | Usuario pendente/bloqueado/inativo tenta login | `403` |
| 6 | Perfil `visualizador` tenta criar lancamento | `403` |
| 7 | Perfil `operador` tenta criar usuario | `403` |
| 8 | Usuario comum de outra empresa acessa rotas JSON legadas | `403` |
| 9 | Payload simples de SQL injection em busca/login | Sem execucao SQL indevida |
| 10 | Texto HTML em campos administrativos | Escapado nas novas telas |

## Comandos de Validacao

```bash
python -m py_compile python/main.py python/web.py python/backend/*.py scripts/*.py
node --check renderer/app.js
node --check renderer/login.js
alembic upgrade head
python scripts/migrar_json_para_postgres.py
```

Tambem foi usado `fastapi.testclient.TestClient` para validar autenticacao, perfis e bloqueios.

## Pendencias de Teste

- Testar em PostgreSQL real com dados completos de producao.
- Criar suite `pytest` permanente.
- Validar visualmente o painel master em celular.
- Validar Cloudflare Tunnel em rede externa real.
- Revisar XSS em todos os modulos antigos com `innerHTML`.
