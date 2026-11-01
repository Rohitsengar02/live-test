# Windows: detects your LAN IP, writes .env, starts the stack.  Run:  powershell -ExecutionPolicy Bypass -File start.ps1
Set-Location $PSScriptRoot
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
if (-not $ip) { Write-Host "Could not detect LAN IP - set LAN_IP in .env manually"; exit 1 }
(Get-Content .env) -replace '^LAN_IP=.*', "LAN_IP=$ip" | Set-Content .env
Write-Host "LAN IP: $ip"
docker compose up -d --build
Write-Host ""
Write-Host "  Open on this computer:   https://localhost"
Write-Host "  Open on phone/laptop:    https://$ip   (same Wi-Fi; accept the certificate warning once)"
Write-Host "  Moderator dashboard:     https://$ip/moderator   (password in .env, default admin123)"
Write-Host ""
Write-Host "  If other devices can't connect: allow ports 443/TCP, 7881/TCP, 7882/UDP in Windows Firewall."
