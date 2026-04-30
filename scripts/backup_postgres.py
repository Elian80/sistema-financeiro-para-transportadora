import os
import subprocess
from datetime import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from backend.settings import settings


BACKUP_DIR = ROOT / "backups"


def main() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    destino = BACKUP_DIR / f"backup_postgres_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
    env = os.environ.copy()
    comando = ["pg_dump", settings.database_url, "-f", str(destino)]
    subprocess.run(comando, check=True, env=env)
    print(f"Backup gerado em: {destino}")


if __name__ == "__main__":
    main()
