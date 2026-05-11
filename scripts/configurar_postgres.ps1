$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$PostgresBin = "C:\Program Files\PostgreSQL\18\bin"
$Psql = Join-Path $PostgresBin "psql.exe"
$Createdb = Join-Path $PostgresBin "createdb.exe"
$EnvFile = Join-Path $AppDir ".env"

$DbName = "financeiro"
$DbUser = "admim"
$DbPassword = "1234"
$JwtSecret = "troque_esta_chave_por_uma_chave_forte_123456"

if (-not (Test-Path $Psql)) {
  $PsqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($PsqlCommand) {
    $Psql = $PsqlCommand.Source
    $Createdb = Join-Path (Split-Path -Parent $Psql) "createdb.exe"
  } else {
    Write-Host "Nao encontrei o psql.exe. Instale o PostgreSQL ou adicione o bin ao PATH." -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "Configurando PostgreSQL para o Sistema Financeiro" -ForegroundColor Cyan
Write-Host "Banco: $DbName"
Write-Host "Usuario da aplicacao: $DbUser"
Write-Host ""

$AdminUser = if ($env:POSTGRES_ADMIN_USER) { $env:POSTGRES_ADMIN_USER } else { "postgres" }
$AdminPasswordCandidates = @()
if ($env:POSTGRES_ADMIN_PASSWORD) {
  $AdminPasswordCandidates += $env:POSTGRES_ADMIN_PASSWORD
}
if ($env:PGPASSWORD) {
  $AdminPasswordCandidates += $env:PGPASSWORD
}
$AdminPasswordCandidates += @("0809", "1234", "postgres", "admin", "")
$AdminPasswordCandidates = $AdminPasswordCandidates | Select-Object -Unique

$AdminPasswordFound = $false
$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
foreach ($Candidate in $AdminPasswordCandidates) {
  if ($Candidate) {
    $env:PGPASSWORD = $Candidate
  } else {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }

  & $Psql -h localhost -U $AdminUser -d postgres -w -tAc "SELECT 1;" *> $null
  if ($LASTEXITCODE -eq 0) {
    $AdminPasswordFound = $true
    break
  }
}
$ErrorActionPreference = $PreviousErrorActionPreference

if (-not $AdminPasswordFound) {
  Write-Host "Nao consegui acessar o PostgreSQL como $AdminUser automaticamente." -ForegroundColor Red
  Write-Host "Tentei sem senha e tambem as senhas padrao: 0809, 1234, postgres e admin." -ForegroundColor Yellow
  Write-Host "Para nao pedir senha no terminal, salve a senha administrativa em POSTGRES_ADMIN_PASSWORD uma unica vez." -ForegroundColor Yellow
  exit 1
}

Write-Host "Acesso administrativo ao PostgreSQL confirmado automaticamente." -ForegroundColor Green

$RoleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE $DbUser LOGIN PASSWORD '$DbPassword';
  ELSE
    ALTER ROLE $DbUser WITH LOGIN PASSWORD '$DbPassword';
  END IF;
END
`$`$;
"@

& $Psql -h localhost -U $AdminUser -d postgres -w -v ON_ERROR_STOP=1 -c $RoleSql
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao criar/configurar o usuario PostgreSQL automaticamente." -ForegroundColor Red
  Write-Host "O script nao pede usuario nem senha. Se o PostgreSQL exigir senha administrativa, defina POSTGRES_ADMIN_PASSWORD antes de rodar." -ForegroundColor Yellow
  exit 1
}

$DbExists = & $Psql -h localhost -U $AdminUser -d postgres -w -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName';"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao verificar se o banco existe." -ForegroundColor Red
  exit 1
}

if (-not ($DbExists -match "1")) {
  & $Createdb -h localhost -U $AdminUser -w -O $DbUser $DbName
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao criar o banco PostgreSQL." -ForegroundColor Red
    exit 1
  }
}

& $Psql -h localhost -U $AdminUser -d postgres -w -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser;"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao conceder permissoes no banco PostgreSQL." -ForegroundColor Red
  exit 1
}

$EnvContent = @"
DATABASE_URL=postgresql+psycopg://$DbUser`:$DbPassword@localhost:5432/$DbName
JWT_SECRET_KEY=$JwtSecret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=development
CORS_ORIGINS=http://127.0.0.1:8001,http://localhost:8001,http://127.0.0.1:8000,http://localhost:8000
SECURE_COOKIES=false
"@

Set-Content -Path $EnvFile -Value $EnvContent -Encoding ASCII

Write-Host ""
Write-Host "Arquivo .env configurado para PostgreSQL." -ForegroundColor Green
Write-Host "Aplicando migrations..." -ForegroundColor Cyan

Set-Location $AppDir
python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao aplicar migrations. Confira a conexao com o PostgreSQL." -ForegroundColor Red
  exit 1
}

Write-Host "Preparando dados iniciais..." -ForegroundColor Cyan
python scripts\migrar_json_para_postgres.py
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao preparar dados iniciais." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "PostgreSQL pronto para uso." -ForegroundColor Green
Write-Host "Login master: master@sistema.local / Master123" -ForegroundColor Green
