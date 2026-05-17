# Sistema Financeiro

Aplicacao FastAPI + PostgreSQL + PWA/Electron para gestao financeira e operacional com base multiempresa, preparada para evoluir para SaaS.

## Como Abrir Localmente

Para uso local no Windows:

```bat
iniciar_pwa.bat
```

Para testar pelo celular ou outro computador usando link temporario:

```bat
abrir_link_teste.bat
```

## Login Inicial

```text
Master: master@sistema.local / Master123
Admin:  admin@sistema.local  / trocar123
```

Troque as senhas iniciais depois de validar o acesso.

## Banco de Dados

O projeto usa PostgreSQL quando existe `.env` com `DATABASE_URL`.

Exemplo local:

```env
DATABASE_URL=postgresql+psycopg://admim:1234@localhost:5432/financeiro
JWT_SECRET_KEY=troque_esta_chave_por_uma_chave_forte_123456
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=development
CORS_ORIGINS=http://127.0.0.1:8001,http://localhost:8001,http://127.0.0.1:8000,http://localhost:8000
SECURE_COOKIES=false
```

Sem `.env`, o sistema usa SQLite apenas como fallback de desenvolvimento.

## Preparar PostgreSQL Local

No Windows, rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\configurar_postgres.ps1
```

Depois aplique banco/dados quando necessario:

```bash
alembic upgrade head
python scripts/migrar_json_para_postgres.py
```

## Publicar Online

Para subir em servidor e usar como SaaS, use os modelos e checklist em:

```text
deploy/README.md
```

Para gerar um `.zip` limpo para upload:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\gerar_pacote_deploy.ps1
```

O pacote fica em:

```text
dist/financeiro-saas.zip
```

Arquivos principais para upload:

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

Nao envie `.env`, `node_modules/`, `python/data/`, `backups/`, `tools/` nem logs.

## Documentacao

- Estrutura do projeto: `docs/PROJECT_STRUCTURE.md`
- Arquitetura: `docs/ARCHITECTURE.md`
- Fluxo do banco: `docs/DATABASE_FLOW.md`
- Backup: `docs/BACKUP.md`
- Auditoria de seguranca: `docs/SECURITY_AUDIT.md`
- Testes de seguranca: `docs/SECURITY_TESTS.md`
- Relatorio de implementacao: `docs/IMPLEMENTATION_REPORT.md`

---

## Arquitetura Tecnica

```
Financeiro/
├── python/                  ← Backend Python
│   ├── main.py              ← API FastAPI principal
│   ├── backend/
│   │   ├── models.py        ← Modelos SQLAlchemy (todas as tabelas)
│   │   ├── database.py      ← Engine, sessão, garantir_colunas_runtime
│   │   ├── auth.py          ← Login JWT com rate limiting
│   │   ├── security.py      ← bcrypt, hash de senhas
│   │   ├── admin_routes.py  ← CRUD de empresas e usuarios
│   │   ├── dependencies.py  ← Validacao de token e perfis RBAC
│   │   ├── settings.py      ← Variaveis de ambiente
│   │   └── migrations/      ← Alembic (migrations de banco)
│   └── data/                ← JSON legado (migrar para banco)
│
└── renderer/                ← Frontend (HTML/CSS/JS Vanilla PWA)
    ├── index.html           ← App principal (painel admin)
    ├── login.html           ← Tela de login
    ├── motorista.html       ← App mobile motoristas
    ├── app.js               ← Logica completa do frontend
    ├── style.css            ← Estilos do painel
    ├── login.js / login.css ← Login
    ├── motorista.js         ← App mobile
    ├── pwa.js / sw.js       ← Service Worker PWA
    └── manifest.webmanifest ← Manifesto PWA
```

## Fluxo Geral da Aplicacao

```
[Browser / PWA]
      |
      | HTTP + Bearer JWT
      v
[FastAPI - main.py]
      |
      |-- Middleware: valida token JWT
      |-- Router: direciona para o endpoint correto
      |-- Pydantic: valida dados de entrada
      |
      v
[SQLAlchemy ORM]
      |
      v
[PostgreSQL / SQLite]
```

## Tabelas do Banco de Dados

| Tabela | Descricao |
|--------|-----------|
| `empresas` | Tenants do sistema (multiempresa) |
| `usuarios` | Usuarios do painel com perfil de acesso |
| `veiculos` | Frota de veiculos |
| `motoristas` | Motoristas cadastrados |
| `lancamentos` | Lancamentos financeiros (nucleo do sistema) |
| `contas_receber` | Contratos e contas a receber |
| `ativos` | Ativos patrimoniais |
| `passivos` | Passivos/dividas |
| `estoque_produtos` | Produtos em estoque com quantidade atual |
| `estoque_movimentacoes` | Historico de entradas e saidas de estoque |
| `plano_contas` | Classificacoes personalizadas |
| `motorista_acessos` | Credenciais do app mobile dos motoristas |
| `viagens` | Viagens com rota GPS |
| `motorista_localizacoes` | Localizacao ao vivo (uma linha por motorista) |
| `audit_logs` | Auditoria de operacoes sensiveis |

## Perfis de Acesso (RBAC)

| Perfil | Acesso |
|--------|--------|
| `master` | Total — todas as empresas |
| `admin` | Total na propria empresa + usuarios |
| `gestor` | Total na propria empresa |
| `financeiro` | Lancamentos, contas, relatorios, folha |
| `operador` | Veiculos, motoristas, estoque, lancamentos |
| `visualizador` | Somente leitura |

## Endpoints da API

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| POST | `/auth/login` | Login — retorna JWT |
| GET | `/auth/me` | Usuario logado |
| GET/POST/PUT/DELETE | `/lancamentos` | Lancamentos financeiros |
| GET/POST/PUT/DELETE | `/contas-receber` | Contas a receber |
| GET/POST/PUT/DELETE | `/estoque/produtos` | Produtos do estoque |
| GET | `/estoque/produtos/busca?q=` | Busca rapida (autocomplete) |
| POST | `/estoque/movimentacoes` | Entrada/saida manual de estoque |
| GET/POST/PUT/DELETE | `/veiculos` | Veiculos da frota |
| GET/POST/PUT/DELETE | `/motoristas` | Motoristas |
| GET/POST/DELETE | `/folha-pagamento` | Folha de pagamento |
| GET | `/relatorios/*` | Relatorios financeiros |
| GET | `/mapa/motoristas` | Posicoes ao vivo |

## Funcionalidade: Vinculo de Estoque em Lancamentos

Ao criar ou editar um lancamento financeiro, e possivel vincular um item do estoque como saida:

- Campo de busca com autocomplete por nome do produto
- Validacao de estoque disponivel (client-side e server-side)
- Saida automatica registrada no modulo de estoque
- Historico rastreaavel com referencia ao lancamento (#ID)
- Ao editar: a saida anterior e estornada e a nova e aplicada
- Coluna "Estoque" exibida na tabela de lancamentos

## Seguranca

- Senhas com hash bcrypt
- Tokens JWT com secret key (definir `JWT_SECRET_KEY` em producao)
- Rate limiting: 5 tentativas de login por minuto por IP+email
- Auditoria completa em `audit_logs`
- CORS restrito as origens configuradas
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options
- Validacao Pydantic em todos os endpoints
