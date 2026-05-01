$ErrorActionPreference = "Continue"

$AppDir = Split-Path -Parent $PSScriptRoot
$AppPort = 8001
$AppUrl = "http://127.0.0.1:$AppPort"
$AppPageUrl = "$AppUrl/app"
$ToolsDir = Join-Path $AppDir "tools"
$LocalCloudflared = Join-Path $ToolsDir "cloudflared.exe"
$TunnelLog = Join-Path $AppDir "cloudflare_tunnel.log"
$TunnelErrorLog = Join-Path $AppDir "cloudflare_tunnel_error.log"
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

function Open-TestUrl {
  param([string]$Url)

  try {
    Set-Clipboard -Value $Url
    Write-Host "Link copiado para a area de transferencia." -ForegroundColor DarkGray
  } catch {
    Write-Host "Nao consegui copiar o link automaticamente." -ForegroundColor DarkGray
  }

  $ChromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )

  foreach ($ChromePath in $ChromePaths) {
    if ($ChromePath -and (Test-Path $ChromePath)) {
      Start-Process -FilePath $ChromePath -ArgumentList @("--new-window", $Url)
      return
    }
  }

  $ChromeCommand = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($ChromeCommand) {
    Start-Process -FilePath $ChromeCommand.Source -ArgumentList @("--new-window", $Url)
    return
  }

  $EdgePath = "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe"
  if (Test-Path $EdgePath) {
    Start-Process -FilePath $EdgePath -ArgumentList @("--new-window", $Url)
    return
  }

  Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "start", '""', $Url) -WindowStyle Hidden
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
if (Test-App) {
  Write-Host "Servidor local ja esta respondendo em $AppPageUrl"
} else {
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
  $FinalUrl = "$PublicUrl/app"
  Write-Host " LINK PUBLICO HTTPS:" -ForegroundColor Green
  Write-Host " $FinalUrl" -ForegroundColor White
  Write-Host ""
  Write-Host "Se o navegador do computador demorar por DNS local, teste direto no celular em outra rede ou dados moveis." -ForegroundColor Yellow
  Open-TestUrl -Url $FinalUrl
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
