# Arquitetura

Data: 2026-04-30

## Componentes

- `python/main.py`: API FastAPI principal, rotas legadas e middlewares de seguranca.
- `python/web.py`: serve o frontend PWA e reaproveita a API.
- `python/backend/`: camada nova com configuracao, banco, modelos, schemas, auth, dependencias e rotas administrativas.
- `renderer/`: frontend HTML/CSS/JavaScript usado no navegador, PWA e Electron.
- `python/data/`: arquivos JSON legados e SQLite local de desenvolvimento.
- `scripts/`: migracao JSON para banco e backup.

## Fluxo de Autenticacao

1. `renderer/login.html` envia e-mail e senha para `POST /auth/login`.
2. `python/backend/auth.py` localiza o usuario, valida status e confere a senha com bcrypt.
3. O backend cria JWT com `sub`, `usuario_id`, `empresa_id` e `perfil`.
4. O frontend salva o token em `sessionStorage`.
5. Toda chamada do app envia `Authorization: Bearer <token>`.
6. `get_current_user` valida token, existencia do usuario e status ativo.

Usuarios com status `inativo`, `bloqueado` ou `pendente` nao conseguem acessar. Se um usuario for bloqueado depois de logado, a proxima requisicao protegida retorna erro.

## Perfis

- `master`: dono do sistema, acesso global a empresas, usuarios, auditoria e dados administrativos.
- `admin`: acesso total dentro da propria empresa.
- `gestor`: gerencia operacao e usuarios da propria empresa.
- `financeiro`: lancamentos, contas, relatorios e dados financeiros.
- `operador`: veiculos, motoristas, estoque e operacao basica.
- `visualizador`: somente leitura.

## Multiempresa

As tabelas novas possuem `empresa_id` quando o dado pertence a uma empresa. O usuario `master` pode consultar o ambiente inteiro. Os demais usuarios ficam limitados a `usuario.empresa_id`.

Rotas legadas que ainda usam JSON estao protegidas por JWT e permissao de perfil. Durante a transicao, usuarios comuns de outra empresa nao acessam os dados JSON globais.

## Painel Administrativo

A aba `Admin` no frontend chama:

- `GET /admin/resumo`
- `GET /empresas`
- `POST /empresas`
- `PUT /empresas/{id}`
- `POST /empresas/{id}/bloquear`
- `POST /empresas/{id}/aprovar`
- `GET /usuarios`
- `POST /usuarios`
- `PUT /usuarios/{id}`
- `POST /usuarios/{id}/bloquear`
- `POST /usuarios/{id}/aprovar`
- `POST /usuarios/{id}/forcar-troca-senha`
- `GET /audit-logs`

## Acesso Remoto de Teste

`abrir_link_teste.bat` inicia o backend local em `http://127.0.0.1:8001` e cria um tunel publico temporario com Cloudflare Tunnel. O link publico deve ser usado apenas para testes.

## Pendencias Arquiteturais

- Migrar CRUDs operacionais de JSON para SQLAlchemy por modulo.
- Persistir refresh tokens e revogacoes.
- Criar testes automatizados permanentes com pytest.
- Definir dominio final e CORS de producao.
