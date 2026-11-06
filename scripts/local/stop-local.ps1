<#
  Stops TechNova on this computer: the app (port 3000) and the local database (port 3410). The data stays in D:\tn-local\data.
    powershell -ExecutionPolicy Bypass -File scripts\local\stop-local.ps1
#>
param([int]$Port = 3000, [int]$DbPort = 3410, [string]$MysqlDir = 'D:\mysql')

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
& "$MysqlDir\bin\mysqladmin.exe" --no-defaults -h 127.0.0.1 -P $DbPort -u root shutdown 2>$null
Write-Host '[local] stopped. The data is kept.' -ForegroundColor Cyan
