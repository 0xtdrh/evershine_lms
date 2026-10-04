<#
  Move the TechNova database to Aiven MySQL (2026-10-04, Railway trial ending).

  What it does:
    1. Restores the backup into a TEMPORARY empty MySQL on this computer (port 3398) and counts
       the rows in every table; checks them against the manifest inside the backup.
    2. Asks for the Aiven connection details (host / port / user / database). The PASSWORD is
       typed into the mysql prompt: it is never saved in a file, never printed, never committed.
    3. Checks the Aiven database is EMPTY and that sql_require_primary_key is OFF.
    4. Imports the backup into Aiven over SSL and counts the rows there.
    5. Compares every table: local restore = manifest = Aiven. PASS or FAIL.
  Nothing is changed on Railway. The temporary local server and its data are deleted at the end.

  Usage (PowerShell):
    powershell -ExecutionPolicy Bypass -File scripts\move-to-aiven.ps1 -DumpFile "D:\TechNovaBackups\technova-....sql.gz"
#>
param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [string]$MysqlDir = 'D:\mysql',
  [int]$Port = 3398
)

$ErrorActionPreference = 'Continue'
$bin = Join-Path $MysqlDir 'bin'
$mysqld = Join-Path $bin 'mysqld.exe'
$mysql = Join-Path $bin 'mysql.exe'
$mysqladmin = Join-Path $bin 'mysqladmin.exe'
foreach ($exe in @($mysqld, $mysql, $mysqladmin)) {
  if (-not (Test-Path $exe)) { throw "Not found: $exe (extract the MySQL ZIP to $MysqlDir)" }
}
if (-not (Test-Path $DumpFile)) { throw "Backup file not found: $DumpFile" }

$work = Join-Path (Split-Path $MysqlDir -Parent) ("technova-move-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dataDir = Join-Path $work 'data'
New-Item -ItemType Directory -Force $work | Out-Null

$sqlFile = $DumpFile
if ($DumpFile -like '*.gz') {
  $sqlFile = Join-Path $work 'restore.sql'
  $in = [System.IO.File]::OpenRead($DumpFile)
  $gz = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
  $out = [System.IO.File]::Create($sqlFile)
  $gz.CopyTo($out); $out.Close(); $gz.Close(); $in.Close()
}
$sourcePath = $sqlFile.Replace('\', '/')

$manifest = @{}
Select-String -Path $sqlFile -Pattern '^-- ROWCOUNT (\S+) (\d+)$' | ForEach-Object {
  $manifest[$_.Matches[0].Groups[1].Value.ToLower()] = [int64]$_.Matches[0].Groups[2].Value
}
$created = (Select-String -Path $sqlFile -Pattern '^-- Created: (.+)$' | Select-Object -First 1)
if ($created) { Write-Host "Backup taken: $($created.Matches[0].Groups[1].Value)" }

function Parse-Counts($lines) {
  $h = @{}
  foreach ($line in $lines) {
    $parts = "$line" -split "`t"
    if ($parts.Count -eq 2 -and $parts[1] -match '^\d+$') { $h[$parts[0].ToLower()] = [int64]$parts[1] }
  }
  return $h
}

$server = $null
try {
  # 1) Local restore test (owner rule: always restore into an empty local DB and compare row counts)
  Write-Host 'Step 1/4: restore test on a temporary local MySQL...'
  & $mysqld --no-defaults --initialize-insecure "--basedir=$MysqlDir" "--datadir=$dataDir" --lower-case-table-names=2 2>&1 | Out-Null
  $server = Start-Process -FilePath $mysqld -PassThru -WindowStyle Hidden -ArgumentList @(
    '--no-defaults', "--basedir=$MysqlDir", "--datadir=$dataDir", "--port=$Port",
    '--bind-address=127.0.0.1', '--mysqlx=OFF', '--lower-case-table-names=2', '--max-allowed-packet=256M'
  )
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    & $mysqladmin --no-defaults -h 127.0.0.1 -P $Port -u root ping 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Temporary MySQL server did not start' }
  & $mysql --no-defaults -h 127.0.0.1 -P $Port -u root -e 'CREATE DATABASE restore_test CHARACTER SET utf8mb4'
  & $mysql --no-defaults -h 127.0.0.1 -P $Port -u root --default-character-set=utf8mb4 restore_test -e "source $sourcePath"
  if ($LASTEXITCODE -ne 0) { throw 'Local restore FAILED (see the mysql error above). Nothing was sent to Aiven.' }
  $tables = & $mysql --no-defaults -h 127.0.0.1 -P $Port -u root -B -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='restore_test' AND table_type='BASE TABLE' ORDER BY table_name"
  foreach ($t in $tables) { if ($t -notmatch '^[A-Za-z0-9_]+$') { throw "Unexpected table name: $t" } }
  $countSql = ($tables | ForEach-Object { "SELECT '$_', COUNT(*) FROM ``$_``" }) -join ' UNION ALL '
  $restored = Parse-Counts (& $mysql --no-defaults -h 127.0.0.1 -P $Port -u root -B -N restore_test -e $countSql)
  $bad = @($restored.Keys | Where-Object { $manifest.Count -gt 0 -and $manifest[$_] -ne $restored[$_] })
  if ($bad.Count -gt 0) { throw "The backup does not match its own manifest ($($bad -join ', ')). Take a new backup. Nothing was sent to Aiven." }
  Write-Host "  OK: $($restored.Count) tables, $(($restored.Values | Measure-Object -Sum).Sum) rows." -ForegroundColor Green

  # 2) Aiven details (password typed into the mysql prompt only)
  Write-Host ''
  Write-Host 'Step 2/4: Aiven connection (Aiven console > your MySQL service > Overview > Connection information).'
  $aHost = Read-Host 'Host (e.g. mysql-xxxx.aivencloud.com)'
  $aPort = Read-Host 'Port'
  $aUser = Read-Host 'User [avnadmin]'; if (-not $aUser) { $aUser = 'avnadmin' }
  $aDb = Read-Host 'Database name [defaultdb]'; if (-not $aDb) { $aDb = 'defaultdb' }
  $remote = @('--no-defaults', '-h', $aHost, '-P', $aPort, '-u', $aUser, '-p', '--ssl-mode=REQUIRED', '--default-character-set=utf8mb4', '-B', '-N', $aDb)

  # 3) Must be empty + primary-key rule off
  Write-Host ''
  Write-Host 'Step 3/4: checking the Aiven database (type the Aiven password when asked)...'
  $check = & $mysql @remote -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE(); SELECT @@sql_require_primary_key;"
  if ($LASTEXITCODE -ne 0) { throw 'Could not connect to Aiven (check host, port, user, password; the service must be Running).' }
  $vals = @($check | Where-Object { "$_" -match '^\d+$' })
  if ($vals.Count -lt 2) { throw "Unexpected answer from Aiven: $check" }
  if ([int]$vals[0] -gt 0) { throw "The Aiven database '$aDb' is NOT empty ($($vals[0]) tables). Stopped so nothing is overwritten." }
  if ([int]$vals[1] -ne 0) {
    Write-Host ''
    Write-Host 'Aiven requires a primary key on every table, but 2 TechNova tables (_GuardianToStudent, _ParentToStudent) have none.' -ForegroundColor Yellow
    Write-Host 'Fix: Aiven console > your MySQL service > Service settings > Advanced configuration > Add configuration option >' -ForegroundColor Yellow
    Write-Host '     "sql_require_primary_key" = OFF (false) > Save. Wait until the service is Running again, then run this script again.' -ForegroundColor Yellow
    throw 'Stopped: sql_require_primary_key is ON.'
  }
  Write-Host '  OK: empty database, primary-key rule off.' -ForegroundColor Green

  # 4) Import + count in one session (one more password prompt)
  Write-Host ''
  Write-Host 'Step 4/4: importing into Aiven and counting rows (type the Aiven password again)...'
  $after = & $mysql @remote -e "source $sourcePath; $countSql;"
  if ($LASTEXITCODE -ne 0) { throw 'Import into Aiven FAILED (see the mysql error above). Railway is untouched; fix and run again on an EMPTY database.' }
  $aiven = Parse-Counts $after

  $rows = @(); $broken = @()
  foreach ($t in ($restored.Keys | Sort-Object)) {
    $ok = $aiven[$t] -eq $restored[$t]
    if (-not $ok) { $broken += "$t (local=$($restored[$t]) aiven=$($aiven[$t]))" }
    $rows += [pscustomobject]@{ Table = $t; Local = $restored[$t]; Manifest = $manifest[$t]; Aiven = $aiven[$t]; OK = $(if ($ok) { 'yes' } else { 'NO' }) }
  }
  $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
  if ($broken.Count -eq 0) {
    Write-Host "RESULT: PASS - all $($restored.Count) tables are on Aiven with the same row counts." -ForegroundColor Green
    Write-Host ''
    Write-Host 'Next (in Vercel > Project > Settings > Environment Variables): set DATABASE_URL to' -ForegroundColor Cyan
    Write-Host "  mysql://$($aUser):<AIVEN PASSWORD>@$($aHost):$($aPort)/$($aDb)?sslaccept=accept_invalid_certs" -ForegroundColor Cyan
    Write-Host '  (type the real password where it says <AIVEN PASSWORD>), save, then Deployments > Redeploy.' -ForegroundColor Cyan
    Write-Host '  Do NOT enter new data on the old site until the new one is confirmed working.' -ForegroundColor Cyan
  } else {
    Write-Host "RESULT: FAIL - $($broken.Count) table(s) differ:" -ForegroundColor Red
    $broken | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    $global:LASTEXITCODE = 1
  }
}
finally {
  if ($server) {
    & $mysqladmin --no-defaults -h 127.0.0.1 -P $Port -u root shutdown 2>$null | Out-Null
    try { Wait-Process -Id $server.Id -Timeout 30 } catch { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
