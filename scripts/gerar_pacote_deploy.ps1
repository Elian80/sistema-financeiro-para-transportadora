$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $AppDir "dist"
$PackageName = "financeiro-saas.zip"
$PackagePath = Join-Path $DistDir $PackageName
$StageDir = Join-Path $DistDir "financeiro-saas"
$AppDirFull = (Resolve-Path $AppDir).Path.TrimEnd("\") + "\"

$IncludeItems = @(
  "python",
  "renderer",
  "scripts",
  "deploy",
  "docs",
  "requirements.txt",
  "package.json",
  "package-lock.json",
  "alembic.ini",
  "README.md",
  ".env.example",
  ".env.production.example"
)

$ExcludeDirs = @(
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  "python\data",
  "backups",
  "tools",
  "dist",
  ".git"
)

$ExcludeFiles = @(
  ".env",
  "ABRIR_LINK_PUBLICO.url",
  "ABRIR_LINK_PUBLICO.html",
  "LINK_PUBLICO_CELULAR.txt",
  "cloudflare_tunnel.log",
  "cloudflare_tunnel_error.log",
  "server_login_debug.log"
)

function Test-ExcludedPath {
  param([string]$RelativePath)

  $normalized = $RelativePath.Replace("/", "\")
  if ($normalized -eq "__pycache__" -or $normalized.Contains("\__pycache__")) {
    return $true
  }
  foreach ($dir in $ExcludeDirs) {
    if ($normalized -eq $dir -or $normalized.StartsWith("$dir\")) {
      return $true
    }
  }
  foreach ($file in $ExcludeFiles) {
    if ($normalized -eq $file) {
      return $true
    }
  }
  if ($normalized.EndsWith(".log") -or $normalized.EndsWith(".pyc") -or $normalized.EndsWith(".db") -or $normalized.EndsWith(".sqlite") -or $normalized.EndsWith(".sqlite3")) {
    return $true
  }
  return $false
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
if (Test-Path $StageDir) {
  Remove-Item -LiteralPath $StageDir -Recurse -Force
}
if (Test-Path $PackagePath) {
  Remove-Item -LiteralPath $PackagePath -Force
}
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

foreach ($item in $IncludeItems) {
  $source = Join-Path $AppDir $item
  if (-not (Test-Path $source)) {
    continue
  }

  if ((Get-Item $source).PSIsContainer) {
    Get-ChildItem -LiteralPath $source -Recurse -Force | ForEach-Object {
      $relative = $_.FullName.Substring($AppDirFull.Length)
      if (Test-ExcludedPath -RelativePath $relative) {
        return
      }
      $target = Join-Path $StageDir $relative
      if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
      } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
      }
    }
  } else {
    if (-not (Test-ExcludedPath -RelativePath $item)) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $StageDir $item) -Force
    }
  }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($PackagePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $StageDir -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($StageDir.Length).TrimStart("\", "/").Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip,
      $_.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Host "Pacote gerado em:" -ForegroundColor Green
Write-Host $PackagePath
