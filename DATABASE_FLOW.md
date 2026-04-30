# Banco de Dados e Fluxo das Informacoes

Data: 2026-04-30

## Banco Atual

O projeto suporta duas formas de banco:

- Desenvolvimento sem `.env`: SQLite em `python/data/financeiro_dev.db`.
- Ambiente real: PostgreSQL definido por `DATABASE_URL` no `.env`.

Exemplo PostgreSQL:

```env
DATABASE_URL=postgresql+psycopg://financeiro_user:SENHA_FORTE@localhost:5432/financeiro
```

## Tabelas Preparadas

- `empresas`
- `usuarios`
- `veiculos`
- `motoristas`
- `lancamentos`
- `contas_receber`
- `ativos`
- `passivos`
- `estoque_produtos`
- `estoque_movimentacoes`
- `plano_contas`
- `audit_logs`

As tabelas administrativas (`empresas`, `usuarios`, `audit_logs`) ja sao usadas diretamente pelo backend novo. As tabelas operacionais ja existem para a migracao completa, mas os CRUDs antigos ainda mantem compatibilidade com JSON.

## Dados JSON

Arquivos atuais mantidos:

- `veiculos.json`
- `motoristas.json`
- `lancamentos.json`
- `contas_receber.json`
- `ativos.json`
- `passivos.json`
- `estoque_produtos.json`
- `estoque_movimentacoes.json`
- `plano_contas.json`

O script `scripts/migrar_json_para_postgres.py` cria uma empresa padrao, cria usuarios iniciais e copia os registros JSON para as tabelas SQL associando tudo a empresa padrao.

## Fluxo Frontend ate Banco

1. O usuario autentica no frontend.
2. O frontend recebe JWT e salva em `sessionStorage`.
3. A requisicao chega ao FastAPI com `Authorization`.
4. `get_current_user` identifica usuario, empresa e perfil.
5. Rotas administrativas usam SQLAlchemy e filtram por `empresa_id`.
6. Rotas legadas usam JSON, mas exigem token e perfil autorizado.
7. Acoes sensiveis gravam eventos em `audit_logs`.

## Separacao por Empresa

- `master` pode ver todas as empresas.
- `admin` e `gestor` ficam limitados a propria empresa.
- Perfis operacionais so acessam dados permitidos da propria empresa.
- Nas rotas SQL, o filtro por `empresa_id` e obrigatorio para usuarios nao master.
- Nas rotas JSON legadas, o acesso fica restrito ao ambiente padrao ate a migracao completa.

## Migrations

Comandos:

```bash
alembic upgrade head
python scripts/migrar_json_para_postgres.py
```

O backend tambem possui verificacao runtime para adicionar colunas administrativas novas em bases antigas durante esta fase de transicao.

## O Que Falta Migrar

- Reescrever CRUDs de veiculos, motoristas, lancamentos, contas, estoque, ativos, passivos, folha e relatorios para SQLAlchemy.
- Remover dependencia operacional de JSON depois de validar todos os modulos em PostgreSQL.
- Criar migrations formais para cada coluna nova em vez de depender da compatibilidade runtime.
