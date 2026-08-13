param(
    [string]$Commit = 'HEAD',
    [string]$ProductionHost = 'root@47.239.5.69',
    [switch]$ConfirmFullDeployment
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmFullDeployment) {
    throw 'Production deployment requires -ConfirmFullDeployment and a current explicit user authorization for 全量部署.'
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$bundleScript = Join-Path $scriptRoot 'create-production-bundle.ps1'
$remoteScript = Join-Path $scriptRoot 'production-deploy.sh'
$remoteCleanupReady = $false

Push-Location $repoRoot
try {
    & git diff --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Tracked working tree changes must be committed before deployment.' }
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Staged changes must be committed before deployment.' }

    $resolvedCommit = (& git rev-parse --verify "$Commit^{commit}").Trim()
    if ($LASTEXITCODE -ne 0 -or $resolvedCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid deployment commit.' }
    $shortCommit = $resolvedCommit.Substring(0, 7)
    & $bundleScript -Commit $resolvedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Production bundle creation failed.' }

    $manifestPath = Join-Path $repoRoot "artifacts\deploy\hgt-production-$shortCommit.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundlePath = Join-Path $repoRoot "artifacts\deploy\$($manifest.fileName)"
    $remoteRoot = '/opt/hgt-releases'
    $remoteBundle = "$remoteRoot/incoming/$($manifest.fileName)"
    $remoteDeployScript = "$remoteRoot/production-deploy.sh"
    $remoteCleanupReady = $true

    & ssh -o BatchMode=yes $ProductionHost "mkdir -p $remoteRoot/incoming"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the remote release directory.' }
    & scp -o BatchMode=yes $bundlePath "${ProductionHost}:$remoteBundle"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the production bundle.' }
    & scp -o BatchMode=yes $remoteScript "${ProductionHost}:$remoteDeployScript"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the production deployment script.' }

    $currentContainerId = (& ssh -o BatchMode=yes $ProductionHost "docker inspect -f '{{.Id}}' hgt-app").Trim()
    if ($LASTEXITCODE -ne 0 -or $currentContainerId -notmatch '^[0-9a-f]{64}$') {
        throw 'Unable to read the current production container ID.'
    }
    & ssh -o BatchMode=yes $ProductionHost "sh $remoteDeployScript $remoteBundle $resolvedCommit $($manifest.sha256) $currentContainerId deploy-hgt-production"
    if ($LASTEXITCODE -ne 0) { throw 'Production deployment failed or rolled back.' }

    foreach ($url in @('https://hgt.caqis.com/api/health', 'https://hgt.caqis.com/')) {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
        if ($response.StatusCode -ne 200) { throw "Production verification failed: $url" }
    }
    Write-Output "PRODUCTION_COMMIT=$resolvedCommit"
    Write-Output 'PUBLIC_HEALTH=ok'
} finally {
    if ($remoteCleanupReady) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remoteBundle $remoteDeployScript" 2>$null | Out-Null
    }
    Pop-Location
}
