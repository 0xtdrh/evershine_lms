<#
  TechNova on this computer (2026-11-06): the database and the app run here, nothing goes to the internet.
  The live database is not used and never touched.

  First time (or to start again from a backup):
    powershell -ExecutionPolicy Bypass -File scripts\local\start-local.ps1 -Restore "D:\TechNovaBackups\technova-....sql.gz"
  Every other time:
    powershell -ExecutionPolicy Bypass -File scripts\local\start-local.ps1
  After new code (git pull):           add -Rebuild
  Forgot the Super Admin password:     add -ResetAdmin  (you type the new one; it is never saved in a file)
  Stop everything:                     scripts\local\stop-local.ps1

  Open http://localhost:3000 here, or http://<this computer's IP>:3000 from a phone on the same Wi-Fi.
  Data:    D:\tn-local\data (kept between runs). Backup: once a day to D:\TechNovaBackups\local-YYYY-MM-DD.sql.gz
  Uploads (photos, payment proofs, files) need Cloudinary keys: put them in D:\tn-local\cloudinary.env as
    CLOUDINARY_CLOUD_NAME=...
    CLOUDINARY_API_KEY=...
    CLOUDINARY_API_SECRET=...
  Protected videos work without Cloudinary (stored in this folder).
#>
param(
  [string]$Restore = '',
  [switch]$Rebuild,
  [switch]$ResetAdmin,
  [switch]$Force,
  [int]$Port = 3000,
  [int]$DbPort = 3410,
  [string]$MysqlDir = 'D:\mysql',
  [string]$Home_ = 'D:\tn-local'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$bin = Join-Path $MysqlDir 'bin'
$data = Join-Path $Home_ 'data'
$db = 'technova'
$url = "mysql://root@127.0.0.1:$DbPort/$db"
New-Item -ItemType Directory -Force $Home_ | Out-Null

function Say($t) { Write-Host "[local] $t" -ForegroundColor Cyan }
function DbUp { try { & "$bin\mysqladmin.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root ping 2>$null | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false } }
function StartDb {
  if (DbUp) { return }
  Say "starting the database (port $DbPort)..."
  Start-Process -WindowStyle Hidden -FilePath "$bin\mysqld.exe" -ArgumentList @('--no-defaults', "--basedir=$MysqlDir", "--datadir=$data", "--port=$DbPort", '--bind-address=127.0.0.1', '--mysqlx=OFF', '--lower-case-table-names=2', '--max-allowed-packet=256M')
  for ($i = 0; $i -lt 60; $i++) { if (DbUp) { return }; Start-Sleep -Seconds 1 }
  throw 'The database did not start. See D:\tn-local\data\*.err'
}

# ── 1. the database ──────────────────────────────────────────────────────────────────────────────────────────
if ($Restore) {
  if (-not (Test-Path $Restore)) { throw "Backup not found: $Restore" }
  if (Test-Path $data) {
    if (-not $Force) {
      $ans = Read-Host "This REPLACES the local data with the backup. Type YES to go on"
      if ($ans -ne 'YES') { Say 'stopped, nothing changed'; exit 1 }
    }
    # keep what was there, just in case
    $keep = "D:\TechNovaBackups\local-before-restore-$(Get-Date -Format 'yyyy-MM-dd-HHmm').sql"
    if (DbUp) { & "$bin\mysqldump.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root --single-transaction --default-character-set=utf8mb4 "--result-file=$keep" $db 2>$null }
    if (DbUp) { & "$bin\mysqladmin.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root shutdown | Out-Null; Start-Sleep -Seconds 4 }
    Remove-Item -Recurse -Force $data
  }
  Say 'making a new local database...'
  & "$bin\mysqld.exe" --no-defaults --initialize-insecure "--basedir=$MysqlDir" "--datadir=$data" --lower-case-table-names=2 2>$null
  StartDb
  & "$bin\mysql.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root -e "CREATE DATABASE $db CHARACTER SET utf8mb4"
  Say "restoring $Restore ..."
  $sql = Join-Path $Home_ 'restore.sql'
  $in = [IO.File]::OpenRead($Restore); $gz = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
  $out = [IO.File]::Create($sql); $gz.CopyTo($out); $out.Close(); $gz.Close(); $in.Close()
  & "$bin\mysql.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root --default-character-set=utf8mb4 $db -e "source $($sql -replace '\\','/')"
  Remove-Item $sql
  $needSchema = $true
} else {
  if (-not (Test-Path $data)) { throw 'No local data yet. Run once with -Restore "D:\TechNovaBackups\<backup>.sql.gz"' }
  StartDb
  $needSchema = $Rebuild
}

Push-Location $repo
try {
  $env:DATABASE_URL = $url
  if ($needSchema) {
    # local only: an old backup may need columns the code added since (never run against the live database)
    Say 'bringing the tables up to the current code...'
    npx prisma db push --skip-generate --accept-data-loss
    if ($LASTEXITCODE -ne 0) { throw 'schema update failed' }
  }

  # ── 2. a backup once a day ────────────────────────────────────────────────────────────────────────────────
  $today = Get-Date -Format 'yyyy-MM-dd'
  $bk = "D:\TechNovaBackups\local-$today.sql.gz"
  if (-not (Test-Path $bk)) {
    Say "daily backup -> $bk"
    New-Item -ItemType Directory -Force 'D:\TechNovaBackups' | Out-Null
    $tmp = Join-Path $Home_ 'backup.sql'
    & "$bin\mysqldump.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root --single-transaction --routines --default-character-set=utf8mb4 "--result-file=$tmp" $db
    $in = [IO.File]::OpenRead($tmp); $out = [IO.File]::Create($bk); $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
    $in.CopyTo($gz); $gz.Close(); $out.Close(); $in.Close(); Remove-Item $tmp
    Get-ChildItem 'D:\TechNovaBackups\local-*.sql.gz' | Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item
  }

  # ── 3. the Super Admin password ──────────────────────────────────────────────────────────────────────────
  if ($ResetAdmin) {
    $email = Read-Host 'Super Admin email'
    $sec = Read-Host 'New password (10+ letters and numbers)' -AsSecureString
    $env:TN_NEW_PW = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    $env:TN_EMAIL = $email
    npx tsx scripts/local/reset-admin.ts
    Remove-Item Env:TN_NEW_PW, Env:TN_EMAIL
  }

  # ── 4. the app ────────────────────────────────────────────────────────────────────────────────────────────
  if ($Rebuild -or -not (Test-Path '.next\BUILD_ID')) {
    Say 'building the app (a few minutes)...'
    npx next build --webpack
    if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  }
  $secretFile = Join-Path $Home_ 'secret.txt'
  if (-not (Test-Path $secretFile)) { [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ })) | Set-Content -Encoding ascii $secretFile }
  $secret = (Get-Content $secretFile -Raw).Trim()
  $env:AUTH_SECRET = $secret; $env:NEXTAUTH_SECRET = $secret
  $env:NEXTAUTH_URL = "http://localhost:$Port"; $env:AUTH_TRUST_HOST = 'true'
  $env:CRON_SECRET = 'local-cron'; $env:VIDEO_STORAGE = 'local'
  $cl = Join-Path $Home_ 'cloudinary.env'
  if (Test-Path $cl) { Get-Content $cl | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.+)$' } | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)$') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim() } }; Say 'Cloudinary keys loaded: uploads work' }
  else { Say 'no Cloudinary keys: photos / proofs / files cannot be uploaded (videos still work)' }
  # the Wi-Fi / network card that has a gateway (not a virtual adapter)
  $ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
  Say "open http://localhost:$Port   (phones on the same Wi-Fi: http://$($ip):$Port)"
  Say 'press Ctrl+C to stop the app; the database keeps running until stop-local.ps1'
  npx next start -p $Port -H 0.0.0.0
} finally {
  Pop-Location
}
