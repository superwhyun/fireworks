# PYRO LAN access — run this in an elevated PowerShell (Run as Administrator)
# Opens inbound TCP 5173 (dev) and 4173 (preview) for the Private network profile.

$ports = @(5173, 4173)
foreach ($port in $ports) {
  $name = "PYRO dev $port"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
      -DisplayName $name `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $port `
      -Profile Private,Domain `
      -Description "Allow the PYRO fireworks app on the local network" | Out-Null
    Write-Host "Added firewall rule: $name"
  } else {
    Write-Host "Rule already exists: $name"
  }
}
