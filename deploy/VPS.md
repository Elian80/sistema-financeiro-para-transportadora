# VPS de Producao

Host/IP: `191.252.103.63`

Usuario SSH: `root`

Aplicacao no servidor: `/opt/financeiro`

Servico systemd: `financeiro`

Comandos de atualizacao no servidor:

```bash
cd /opt/financeiro
. .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
sudo systemctl restart financeiro
```
