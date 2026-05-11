# Deploy em Servidor Linux

Este guia prepara a aplicacao para rodar online como SaaS em um VPS Linux com PostgreSQL, Nginx e systemd.

## Estrutura Para Upload

Envie estes itens para o servidor:

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

Nao envie:

```text
.env
node_modules/
python/data/
backups/
tools/
*.log
ABRIR_LINK_PUBLICO.url
LINK_PUBLICO_CELULAR.txt
```

## Instalar Dependencias

Exemplo usando Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip postgresql postgresql-contrib nginx
```

Crie o usuario do sistema:

```bash
sudo useradd --system --create-home --shell /bin/bash financeiro
sudo mkdir -p /opt/financeiro
sudo chown -R financeiro:financeiro /opt/financeiro
```

Copie os arquivos do projeto para `/opt/financeiro`.

## Configurar Ambiente

No servidor:

```bash
cd /opt/financeiro
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.production.example .env
```

Edite o `.env`:

```bash
nano .env
```

Troque:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `CORS_ORIGINS`

## Criar Banco

Entre no PostgreSQL como administrador:

```bash
sudo -u postgres psql
```

Rode:

```sql
CREATE USER admim WITH PASSWORD '1234';
CREATE DATABASE financeiro OWNER admim;
GRANT ALL PRIVILEGES ON DATABASE financeiro TO admim;
\q
```

## Aplicar Banco Inicial

```bash
cd /opt/financeiro
. .venv/bin/activate
alembic upgrade head
python scripts/migrar_json_para_postgres.py
```

## Configurar Servico

```bash
sudo cp deploy/systemd/financeiro.service /etc/systemd/system/financeiro.service
sudo systemctl daemon-reload
sudo systemctl enable financeiro
sudo systemctl start financeiro
sudo systemctl status financeiro
```

## Configurar Nginx

```bash
sudo cp deploy/nginx/financeiro.conf /etc/nginx/sites-available/financeiro.conf
sudo ln -s /etc/nginx/sites-available/financeiro.conf /etc/nginx/sites-enabled/financeiro.conf
sudo nginx -t
sudo systemctl reload nginx
```

Depois configure HTTPS com Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```

## Atualizar Aplicacao

```bash
cd /opt/financeiro
. .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
sudo systemctl restart financeiro
```

## Logs

```bash
sudo journalctl -u financeiro -f
sudo tail -f /var/log/nginx/error.log
```
