$ErrorActionPreference = "Continue"

$AppDir = Split-Path -Parent $PSScriptRoot
$AppPort = 8001
$AppUrl = "http://127.0.0.1:$AppPort"
$AppPageUrl = "$AppUrl/app"
$ToolsDir = Join-Path $AppDir "tools"
$LocalCloudflared = Join-Path $ToolsDir "cloudflared.exe"
$TunnelLog = Join-Path $AppDir "cloudflare_tunnel.log"
$TunnelErrorLog = Join-Path $AppDir "cloudflare_tunnel_error.log"
$PublicLinkFile = Join-Path $AppDir "LINK_PUBLICO_CELULAR.txt"
$PublicMotoristaLinkFile = Join-Path $AppDir "LINK_PUBLICO_MOTORISTA.txt"
$PublicShortcutFile = Join-Path $AppDir "ABRIR_LINK_PUBLICO.url"
$PublicAppShortcutFile = Join-Path $AppDir "ABRIR_LINK_PUBLICO_APP.url"
$PublicMotoristaShortcutFile = Join-Path $AppDir "ABRIR_LINK_PUBLICO_MOTORISTA.url"
$LegacyPublicLauncherFile = Join-Path $AppDir "ABRIR_LINK_PUBLICO.html"
$PostgresSetupScript = Join-Path $AppDir "scripts\configurar_postgres.ps1"
$EnvFile = Join-Path $AppDir ".env"
param(
  [switch]$Setup
)

if ($Setup) {
  $env:FINANCEIRO_SETUP = "1"
}

$PublicUrl = $null
$TunnelProcess = $null

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host $Message -ForegroundColor Cyan
}

function Test-App {
  try {
    $response = Invoke-WebRequest -Uri $AppPageUrl -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-MapApi {
  try {
    $response = Invoke-WebRequest -Uri "$AppUrl/localizacoes-motoristas" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
      return $true
    }
    return $false
  }
}

function Stop-LocalServer {
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "uvicorn web:app" -and $_.CommandLine -match "--port $AppPort"
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Wait-App {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if (Test-App) {
      return $true
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Test-Database {
  Push-Location (Join-Path $AppDir "python")
  try {
    python -c "from backend.database import engine; from sqlalchemy import text; conn = engine.connect(); conn.execute(text('select 1')); conn.close()" 2>$null
    return ($LASTEXITCODE -eq 0)
  } finally {
    Pop-Location
  }
}

function Use-SqliteFallback {
  $DbPath = (Join-Path $AppDir "python\data\financeiro_dev.db").Replace("\", "/")
  $EnvContent = @"
DATABASE_URL=sqlite:///$DbPath
JWT_SECRET_KEY=troque_esta_chave_por_uma_chave_forte_123456
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=development
CORS_ORIGINS=http://127.0.0.1:8001,http://localhost:8001,http://127.0.0.1:8000,http://localhost:8000
SECURE_COOKIES=false
"@

  Set-Content -Path $EnvFile -Value $EnvContent -Encoding ASCII
  Write-Host "Usei SQLite local temporariamente para conseguir abrir o link de teste sem pedir senha." -ForegroundColor Yellow
}

function Ensure-Database {
  if (Test-Database) {
    return
  }

  Write-Host ""
  Write-Host "Nao consegui conectar no banco configurado no .env." -ForegroundColor Yellow
  Write-Host "Como o sistema esta configurado para PostgreSQL, vou tentar configurar o banco automaticamente." -ForegroundColor Yellow

  if (-not (Test-Path $PostgresSetupScript)) {
    Write-Host "Nao encontrei o script de configuracao: $PostgresSetupScript" -ForegroundColor Red
    exit 1
  }

  & powershell -NoProfile -ExecutionPolicy Bypass -File $PostgresSetupScript
  if ($LASTEXITCODE -ne 0) {
    Write-Host "A configuracao automatica do PostgreSQL nao foi concluida." -ForegroundColor Yellow
    Use-SqliteFallback
    if (Test-Database) {
      return
    }
    Write-Host "Tambem nao consegui iniciar o banco local SQLite." -ForegroundColor Red
    exit 1
  }

  if (-not (Test-Database)) {
    Write-Host "O PostgreSQL ainda nao aceitou a conexao do sistema." -ForegroundColor Yellow
    Use-SqliteFallback
    if (Test-Database) {
      return
    }
    Write-Host "Tambem nao consegui iniciar o banco local SQLite." -ForegroundColor Red
    exit 1
  }
}

function Wait-PublicUrl {
  param([string[]]$LogPaths)

  $deadline = (Get-Date).AddSeconds(35)
  do {
    foreach ($LogPath in $LogPaths) {
      if (-not (Test-Path $LogPath)) {
        continue
      }
      $text = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
      if ([string]::IsNullOrWhiteSpace($text)) {
        continue
      }
      $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
      if ($match.Success) {
        return $match.Value
      }
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Wait-UrlReady {
  param([string]$Url)

  $deadline = (Get-Date).AddSeconds(18)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
      continue
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Save-PublicLinks {
  param(
    [string]$BaseUrl,
    [string]$AppUrl,
    [string]$MotoristaUrl
  )

  $baseShortcut = @"
[InternetShortcut]
URL=$BaseUrl
"@
  $appShortcut = @"
[InternetShortcut]
URL=$AppUrl
"@
  $motoristaShortcut = @"
[InternetShortcut]
URL=$MotoristaUrl
"@

  Set-Content -Path $PublicShortcutFile -Value $baseShortcut -Encoding ASCII
  Set-Content -Path $PublicAppShortcutFile -Value $appShortcut -Encoding ASCII
  Set-Content -Path $PublicMotoristaShortcutFile -Value $motoristaShortcut -Encoding ASCII
  Set-Content -Path $PublicLinkFile -Value $AppUrl -Encoding UTF8
  Set-Content -Path $PublicMotoristaLinkFile -Value $MotoristaUrl -Encoding UTF8
}

function Open-TestUrl {
  param([string]$Url)

  try {
    Set-Clipboard -Value $Url
    Write-Host "Link copiado para a area de transferencia." -ForegroundColor DarkGray
  } catch {
    Write-Host "Nao consegui copiar o link automaticamente." -ForegroundColor DarkGray
  }

  $browserPaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($browserPath in $browserPaths) {
    if ($browserPath -and (Test-Path $browserPath)) {
      try {
        Start-Process -FilePath $browserPath -ArgumentList @("--new-window", $Url) -ErrorAction Stop
        return
      } catch {
        continue
      }
    }
  }

  try {
    Start-Process -FilePath "explorer.exe" -ArgumentList $Url -ErrorAction Stop
    return
  } catch {
    Write-Host "Nao consegui abrir com explorer.exe. Tentando fallback." -ForegroundColor Yellow
  }

  try {
    Start-Process -FilePath $Url -ErrorAction Stop
    return
  } catch {
    Write-Host "Nao consegui abrir diretamente com Start-Process. Tentando cmd /c start." -ForegroundColor Yellow
  }

  Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "start", '""', $Url) -WindowStyle Hidden -ErrorAction SilentlyContinue
}

Set-Location $AppDir

Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host " FINANCEIRO - LINK PUBLICO DE TESTE" -ForegroundColor DarkCyan
Write-Host "============================================================" -ForegroundColor DarkCyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "Nao encontrei o Python no PATH." -ForegroundColor Red
  exit 1
}

if ($env:FINANCEIRO_SETUP -eq "1") {
  Write-Step "[1/6] Verificando dependencias Python..."
  $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
  python -m pip install -q -r requirements.txt
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao instalar dependencias Python." -ForegroundColor Red
    exit 1
  }

  Write-Step "[2/6] Aplicando migrations do banco, se disponivel..."
  python -m alembic upgrade head
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Aviso: nao consegui aplicar migrations agora. Vou continuar para abrir o link de teste." -ForegroundColor Yellow
  }

  Write-Step "[3/6] Preparando dados iniciais, se necessario..."
  $MigrationScript = Join-Path $AppDir "scripts\migrar_json_para_postgres.py"
  if (Test-Path $MigrationScript) {
    python $MigrationScript
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Aviso: nao consegui preparar os dados iniciais agora. Vou continuar para abrir o link de teste." -ForegroundColor Yellow
    }
  }
} else {
  Write-Step "[1/6] Modo rapido ativado..."
  Write-Host "Pulando instalacao, migrations e migracao inicial para abrir o link mais rapido." -ForegroundColor DarkGray
  Write-Host "Se precisar rodar o setup completo, abra o CMD e execute:" -ForegroundColor DarkGray
  Write-Host "set FINANCEIRO_SETUP=1" -ForegroundColor DarkGray
  Write-Host "abrir_link_teste.bat" -ForegroundColor DarkGray
}

Write-Step "[2/6] Verificando banco de dados..."
Ensure-Database

Write-Step "[4/6] Verificando Cloudflare Tunnel..."
$CloudflaredCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if ($CloudflaredCommand) {
  $CloudflaredPath = $CloudflaredCommand.Source
} elseif (Test-Path $LocalCloudflared) {
  $CloudflaredPath = $LocalCloudflared
} else {
  Write-Host "Baixando cloudflared automaticamente..."
  New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $LocalCloudflared
  $CloudflaredPath = $LocalCloudflared
}

if (-not (Test-Path $CloudflaredPath)) {
  Write-Host "Nao consegui localizar o cloudflared.exe." -ForegroundColor Red
  exit 1
}

Write-Step "[5/6] Iniciando servidor local..."
if ((Test-App) -and (Test-MapApi)) {
  Write-Host "Servidor local ja esta respondendo em $AppPageUrl"
} else {
  if (Test-App) {
    Write-Host "Servidor local antigo detectado. Reiniciando para carregar as atualizacoes..." -ForegroundColor Yellow
    Stop-LocalServer
    Start-Sleep -Seconds 2
  }

  Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "cd '$AppDir\python'; python -m uvicorn web:app --host 127.0.0.1 --port $AppPort"
  ) -WindowStyle Hidden

  if (-not (Wait-App)) {
    Write-Host "Nao consegui confirmar o servidor local em $AppPageUrl." -ForegroundColor Red
    exit 1
  }
}

Write-Step "[6/6] Gerando link HTTPS..."
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $TunnelLog -Force -ErrorAction SilentlyContinue
Remove-Item $TunnelErrorLog -Force -ErrorAction SilentlyContinue
Remove-Item $LegacyPublicLauncherFile -Force -ErrorAction SilentlyContinue

$TunnelProcess = Start-Process -FilePath $CloudflaredPath -ArgumentList @(
  "tunnel",
  "--no-autoupdate",
  "--protocol",
  "http2",
  "--url",
  $AppUrl
) -WindowStyle Hidden -RedirectStandardOutput $TunnelLog -RedirectStandardError $TunnelErrorLog -PassThru
$PublicUrl = Wait-PublicUrl -LogPaths @($TunnelLog, $TunnelErrorLog)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
if ($PublicUrl) {
  $FinalUrl = $PublicUrl
  $AppFinalUrl = "$PublicUrl/app"
  $MotoristaFinalUrl = "$PublicUrl/motorista"
  Write-Host " LINK PUBLICO HTTPS:" -ForegroundColor Green
  Write-Host " $FinalUrl" -ForegroundColor White
  Write-Host " Apos fazer login, o sistema abre a aplicacao em:" -ForegroundColor Green
  Write-Host " $AppFinalUrl" -ForegroundColor White
  Write-Host " Link de motorista:" -ForegroundColor Green
  Write-Host " $MotoristaFinalUrl" -ForegroundColor White
  Write-Host ""
  Write-Host "Tambem salvei os links nestes arquivos:" -ForegroundColor Green
  Write-Host " $PublicLinkFile" -ForegroundColor White
  Write-Host " $PublicMotoristaLinkFile" -ForegroundColor White
  Write-Host " $PublicShortcutFile" -ForegroundColor White
  Write-Host " $PublicAppShortcutFile" -ForegroundColor White
  Write-Host " $PublicMotoristaShortcutFile" -ForegroundColor White
  Write-Host ""
  Write-Host "Aguardando o link publico responder antes de abrir..." -ForegroundColor DarkGray
  if (-not (Wait-UrlReady -Url $FinalUrl)) {
    Write-Host "O link foi gerado, mas ainda pode levar alguns segundos para responder." -ForegroundColor Yellow
  }
  Save-PublicLinks -BaseUrl $FinalUrl -AppUrl $AppFinalUrl -MotoristaUrl $MotoristaFinalUrl
  Open-TestUrl -Url $AppFinalUrl
} else {
  $FinalUrl = $AppPageUrl
  Write-Host "Nao consegui capturar o link HTTPS automaticamente." -ForegroundColor Yellow
  Write-Host "Abri somente o link local. Confira os arquivos:" -ForegroundColor Yellow
  Write-Host " $TunnelLog" -ForegroundColor Yellow
  Write-Host " $TunnelErrorLog" -ForegroundColor Yellow
  Open-TestUrl -Url $FinalUrl
}

Write-Host ""
Write-Host " Login master:" -ForegroundColor Green
Write-Host " Email: master@sistema.local"
Write-Host " Senha: Master123"
Write-Host ""
Write-Host " Apenas uma aba do navegador foi aberta." -ForegroundColor Green
Write-Host " MANTENHA ESTA JANELA ABERTA para o celular conseguir acessar." -ForegroundColor Green
Write-Host " Se fechar esta janela ou apertar ENTER, o link HTTPS para de funcionar." -ForegroundColor Yellow
Write-Host " Pressione ENTER somente quando quiser encerrar o acesso externo." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green

[void][Console]::ReadLine()

if ($TunnelProcess -and -not $TunnelProcess.HasExited) {
  Stop-Process -Id $TunnelProcess.Id -Force -ErrorAction SilentlyContinue
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
