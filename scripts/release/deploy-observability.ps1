param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [string]$ProductionHost = 'root@47.239.5.69',
    [switch]$ConfirmFullDeployment
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmFullDeployment -or $Commit -notmatch '^[0-9a-f]{40}$') {
    throw 'A valid release commit and current explicit full-deployment authorization are required.'
}
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$remote = '/opt/hgt-observability/incoming-' + $Commit.Substring(0, 7)
& ssh -o BatchMode=yes $ProductionHost "mkdir -p $remote"
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the observability staging directory.' }
$files = @('nginx-http.conf', 'nginx-server.conf', 'nginx-proxy.conf', 'install-production.sh', 'probe-request-logs.py')
foreach ($file in $files) {
    & scp -o BatchMode=yes (Join-Path $repoRoot "scripts\observability\$file") "${ProductionHost}:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to transfer the reviewed observability files.' }
}
& scp -o BatchMode=yes (Join-Path $PSScriptRoot 'production-preflight.sh') "${ProductionHost}:$remote/production-preflight.sh"
if ($LASTEXITCODE -ne 0) { throw 'Unable to transfer authentication preflight.' }
& ssh -o BatchMode=yes $ProductionHost "sh $remote/install-production.sh $Commit install-hgt-request-logging"
if ($LASTEXITCODE -ne 0) { throw 'Nginx logging installation failed; configuration rollback was attempted.' }
Write-Output 'PRODUCTION_OBSERVABILITY=verified'
