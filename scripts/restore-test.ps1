<#
  Restore test for a TechNova backup.

  Starts a TEMPORARY local MySQL server (port 3399, localhost only), restores the
  backup into an empty database, counts the rows in every table and compares them:
    - with the manifest inside an in-app backup (-- ROWCOUNT lines), and/or
    - with the live Railway database (-CompareLive; you type the password in the
      mysql prompt, nothing is saved or printed).
  The temporary server and its data are deleted at the end.

  Usage (PowerShell):
    powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -DumpFile "D:\TechNovaBackups\technova-2026-09-28.sql"
    powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -DumpFile "D:\TechNovaBackups\technova-...sql.gz" -CompareLive
#>
param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [string]$MysqlDir = 'D:\mysql',
  [switch]$CompareLive,
  [int]$Port = 3399
)

# 'Continue': in Windows PowerShell 5.1, 'Stop' turns any native stderr line into a crash.
# Failures are checked through $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$bin = Join-Path $MysqlDir 'bin'
$mysqld = Join-Path $bin 'mysqld.exe'
$mysql = Join-Path $bin 'mysql.exe'
$mysqladmin = Join-Path $bin 'mysqladmin.exe'
foreach ($exe in @($mysqld, $mysql, $mysqladmin)) {
  if (-not (Test-Path $exe)) { throw "Not found: $exe (extract the MySQL ZIP to $MysqlDir)" }
}
if (-not (Test-Path $DumpFile)) { throw "Dump file not found: $DumpFile" }

# Temp data next to MySQL (same drive), not in %TEMP%: C: may be short on space.
$work = Join-Path (Split-Path $MysqlDir -Parent) ("technova-restore-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dataDir = Join-Path $work 'data'
New-Item -ItemType Directory -Force $work | Out-Null

# 1) Decompress .gz if needed
$sqlFile = $DumpFile
if ($DumpFile -like '*.gz') {
  $sqlFile = Join-Path $work 'restore.sql'
  $in = [System.IO.File]::OpenRead($DumpFile)
  $gz = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
  $out = [System.IO.File]::Create($sqlFile)
  $gz.CopyTo($out); $out.Close(); $gz.Close(); $in.Close()
}

# Manifest rows (in-app backups only)
$manifest = @{}
Select-String -Path $sqlFile -Pattern '^-- ROWCOUNT (\S+) (\d+)$' | ForEach-Object {
  $manifest[$_.Matches[0].Groups[1].Value.ToLower()] = [int64]$_.Matches[0].Groups[2].Value
}
$lastLine = Get-Content $sqlFile -Tail 1
Write-Host "Last line of dump: $lastLine"
if ($lastLine -notmatch 'Dump completed') { Write-Host 'WARNING: dump does not end with "Dump completed" - it may be truncated.' -ForegroundColor Yellow }

$server = $null
try {
  # 2) Temporary empty MySQL server
  Write-Host 'Starting temporary MySQL server...'
  & $mysqld --no-defaults --initialize-insecure "--basedir=$MysqlDir" "--datadir=$dataDir" --lower-case-table-names=2 2>&1 | Out-Null
  $server = Start-Process -FilePath $mysqld -PassThru -WindowStyle Hidden -ArgumentList @(
    '--no-defaults', "--basedir=$MysqlDir", "--datadir=$dataDir", "--port=$port",
    '--bind-address=127.0.0.1', '--mysqlx=OFF', '--lower-case-table-names=2', '--max-allowed-packet=256M'
  )
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    & $mysqladmin --no-defaults -h 127.0.0.1 -P $port -u root ping 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Temporary MySQL server did not start' }

  # 3) Restore
  Write-Host 'Restoring into empty database restore_test...'
  & $mysql --no-defaults -h 127.0.0.1 -P $port -u root -e 'CREATE DATABASE restore_test CHARACTER SET utf8mb4'
  $sourcePath = $sqlFile.Replace('\', '/')
  & $mysql --no-defaults -h 127.0.0.1 -P $port -u root --default-character-set=utf8mb4 restore_test -e "source $sourcePath"
  if ($LASTEXITCODE -ne 0) { throw 'Restore FAILED (see mysql error above)' }

  # 4) Row counts after restore
  $tables = & $mysql --no-defaults -h 127.0.0.1 -P $port -u root -B -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='restore_test' AND table_type='BASE TABLE' ORDER BY table_name"
  # Table names go into SQL below, so only plain names are accepted.
  foreach ($t in $tables) { if ($t -notmatch '^[A-Za-z0-9_]+$') { throw "Unexpected table name: $t" } }
  $countSql = ($tables | ForEach-Object { "SELECT '$_', COUNT(*) FROM ``$_``" }) -join ' UNION ALL '
  $restored = @{}
  & $mysql --no-defaults -h 127.0.0.1 -P $port -u root -B -N restore_test -e $countSql | ForEach-Object {
    $parts = $_ -split "`t"; $restored[$parts[0].ToLower()] = [int64]$parts[1]
  }

  # 5) Optional: live Railway counts
  $live = @{}
  if ($CompareLive) {
    Write-Host ''
    Write-Host 'Live Railway database (from MYSQL_PUBLIC_URL). Password is asked by mysql and is not saved.'
    $liveHost = Read-Host 'HOST (e.g. xxxx.proxy.rlwy.net)'
    $livePort = Read-Host 'PORT'
    $liveUser = Read-Host 'USER (usually root)'
    $liveDb = Read-Host 'DB (usually railway)'
    # READ-ONLY: only SELECT COUNT(*) inside a READ ONLY transaction, then ROLLBACK.
    # Even if something else slipped in, MySQL itself would refuse any write.
    $liveSql = "SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; $countSql; ROLLBACK;"
    & $mysql --no-defaults -h $liveHost -P $livePort -u $liveUser -p -B -N $liveDb -e $liveSql | ForEach-Object {
      $parts = $_ -split "`t"; $live[$parts[0].ToLower()] = [int64]$parts[1]
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not read counts from the live database' }
  }

  # 6) Report
  $rows = @()
  $mismatch = 0
  $allNames = @($restored.Keys) + @($manifest.Keys) + @($live.Keys) | Sort-Object -Unique
  foreach ($t in $allNames) {
    $r = $restored[$t]; $m = $manifest[$t]; $l = $live[$t]
    $ok = ($r -ne $null) -and (($manifest.Count -eq 0) -or ($m -eq $r)) -and ((-not $CompareLive) -or ($l -eq $r))
    if (-not $ok) { $mismatch++ }
    $rows += [pscustomobject]@{ Table = $t; Restored = $r; Manifest = $m; Live = $l; OK = $(if ($ok) { 'yes' } else { 'NO' }) }
  }
  $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
  $totalRows = ($restored.Values | Measure-Object -Sum).Sum
  Write-Host "Tables restored: $($restored.Count)   Total rows: $totalRows"
  if ($manifest.Count -eq 0 -and -not $CompareLive) {
    Write-Host 'No manifest in this file (plain mysqldump). Re-run with -CompareLive to compare against Railway.' -ForegroundColor Yellow
  }
  if ($mismatch -eq 0) { Write-Host 'RESULT: PASS - every table matches.' -ForegroundColor Green }
  else { Write-Host "RESULT: FAIL - $mismatch table(s) differ." -ForegroundColor Red; $global:LASTEXITCODE = 1 }
}
finally {
  if ($server) {
    & $mysqladmin --no-defaults -h 127.0.0.1 -P $port -u root shutdown 2>$null | Out-Null
    try { Wait-Process -Id $server.Id -Timeout 30 } catch { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
