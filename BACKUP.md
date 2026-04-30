# Backup do Banco PostgreSQL

## Backup manual

```bash
pg_dump financeiro > backup_financeiro.sql
```

Com `DATABASE_URL`:

```bash
pg_dump postgresql://financeiro_user:SENHA_FORTE@localhost:5432/financeiro > backup_financeiro.sql
```

## Restore manual

```bash
psql financeiro < backup_financeiro.sql
```

Com `DATABASE_URL`:

```bash
psql postgresql://financeiro_user:SENHA_FORTE@localhost:5432/financeiro < backup_financeiro.sql
```

## Script automático

Configure o `.env` com `DATABASE_URL` e rode:

```bash
python scripts/backup_postgres.py
```

O arquivo será gerado em `backups/backup_postgres_YYYYMMDD_HHMMSS.sql`.

## Backup completo do projeto

Antes desta migração foi criado:

`C:\Users\julia\Desktop\PROJETO FINANCEIRO\backup_20260430_1858`
