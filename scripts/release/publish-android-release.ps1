param(
    [Parameter(Mandatory = $true)]
    [string]$Descriptor,
    [string]$ProductionHost = 'root@47.239.5.69',
    [switch]$ConfirmFullDeployment
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmFullDeployment) {
    throw 'Android release publishing requires -ConfirmFullDeployment and a current explicit user authorization for 全量部署.'
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$publisher = Join-Path $scriptRoot 'publish-android-release.mjs'
$remoteRunnerSource = Join-Path $scriptRoot 'publish-android-release.sh'
$descriptorCandidate = if ([IO.Path]::IsPathRooted($Descriptor)) { $Descriptor } else { Join-Path $repoRoot $Descriptor }
$descriptorPath = (Resolve-Path -LiteralPath $descriptorCandidate).Path
$descriptorData = Get-Content -LiteralPath $descriptorPath -Raw -Encoding UTF8 | ConvertFrom-Json
$remotePublisher = '/tmp/hgt-publish-android-release.mjs'
$remoteDescriptor = '/tmp/hgt-android-release.json'
$remoteRunner = '/tmp/hgt-publish-android-release.sh'
$remoteCleanupReady = $false

Push-Location $repoRoot
try {
    $remoteCleanupReady = $true
    & scp -o BatchMode=yes $publisher "${ProductionHost}:$remotePublisher"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the Android publisher.' }
    & scp -o BatchMode=yes $descriptorPath "${ProductionHost}:$remoteDescriptor"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the Android release descriptor.' }
    & scp -o BatchMode=yes $remoteRunnerSource "${ProductionHost}:$remoteRunner"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the Android release runner.' }
    & ssh -o BatchMode=yes $ProductionHost "sh $remoteRunner publish-hgt-android-release"
    if ($LASTEXITCODE -ne 0) { throw 'Android release publishing failed.' }

    $oldVersion = [Math]::Max(1, [int]$descriptorData.versionCode - 1)
    $oldManifest = Invoke-RestMethod -Uri "https://hgt.caqis.com/api/app/android-update?versionCode=$oldVersion" -TimeoutSec 20
    $newManifest = Invoke-RestMethod -Uri "https://hgt.caqis.com/api/app/android-update?versionCode=$($descriptorData.versionCode)" -TimeoutSec 20
    if (-not $oldManifest.updateAvailable -or $oldManifest.forceUpdate -or
        $oldManifest.latestVersionCode -ne $descriptorData.versionCode -or
        $oldManifest.apkUrl -ne $descriptorData.apkUrl) {
        throw 'Old-version Android update verification failed.'
    }
    if ($newManifest.updateAvailable -or $newManifest.latestVersionCode -ne $descriptorData.versionCode) {
        throw 'Latest-version Android update verification failed.'
    }
    Write-Output 'ANDROID_UPDATE_VERIFIED=true'
} finally {
    if ($remoteCleanupReady) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remotePublisher $remoteDescriptor $remoteRunner" 2>$null | Out-Null
    }
    Pop-Location
}
