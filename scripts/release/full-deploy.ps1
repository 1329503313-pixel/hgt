param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseNotes,
    [string]$ProductionHost = 'root@47.239.5.69',
    [switch]$ConfirmFullDeployment
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmFullDeployment) {
    throw 'The complete Web/Server/Android release requires -ConfirmFullDeployment and a current explicit user authorization for 全量部署.'
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$notesCandidate = if ([IO.Path]::IsPathRooted($ReleaseNotes)) { $ReleaseNotes } else { Join-Path $repoRoot $ReleaseNotes }
$notesPath = (Resolve-Path -LiteralPath $notesCandidate).Path
$versionPath = Join-Path $repoRoot 'apps\app-android\release\version.json'
$version = Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8 | ConvertFrom-Json
$descriptorPath = Join-Path $repoRoot "artifacts\android\$($version.versionName)\android-release.json"

function Invoke-ReleaseCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )
    Write-Output "RELEASE_STEP_START=$Label"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Release step failed: $Label" }
    Write-Output "RELEASE_STEP_COMPLETE=$Label"
}

Push-Location $repoRoot
try {
    $worktreeStatus = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree.' }
    if ($worktreeStatus.Count -gt 0) { throw 'The complete release requires a completely clean Git worktree.' }
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve the release commit.' }

    $notes = @(Get-Content -LiteralPath $notesPath -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($notes.Count -lt 1 -or $notes.Count -gt 30) { throw 'Release notes must contain 1-30 non-empty lines.' }

    $onlineRelease = Invoke-RestMethod -Uri 'https://hgt.caqis.com/api/app/android-update?versionCode=1' -TimeoutSec 20
    if ($onlineRelease.latestVersionCode -and [int]$version.versionCode -le [int]$onlineRelease.latestVersionCode) {
        throw "Android versionCode $($version.versionCode) must be greater than the published versionCode $($onlineRelease.latestVersionCode)."
    }

    Invoke-ReleaseCommand 'type-and-contract-checks' { npm run check }
    Invoke-ReleaseCommand 'server-tests' { npm test }
    Invoke-ReleaseCommand 'web-server-build' { npm run build:all }
    Invoke-ReleaseCommand 'production-auth-source-contract' { npm run release:check:auth }
    Invoke-ReleaseCommand 'android-prepare-and-verify' { npm run release:android:prepare }
    Invoke-ReleaseCommand 'android-upload-and-public-hash-verification' { npm run app:android:upload -- --confirm-upload }
    Invoke-ReleaseCommand 'android-release-descriptor' { npm run release:android:descriptor -- --notes $notesPath }
    if (-not (Test-Path -LiteralPath $descriptorPath)) { throw 'Android release descriptor was not created.' }
    Invoke-ReleaseCommand 'production-web-server-deployment' {
        & (Join-Path $scriptRoot 'deploy-production.ps1') -Commit $commit -ProductionHost $ProductionHost -ConfirmFullDeployment
    }
    Invoke-ReleaseCommand 'android-update-record-publication' {
        & (Join-Path $scriptRoot 'publish-android-release.ps1') -Descriptor $descriptorPath -ProductionHost $ProductionHost -ConfirmFullDeployment
    }

    Write-Output 'FULL_DEPLOYMENT=complete'
    Write-Output "PRODUCTION_COMMIT=$commit"
    Write-Output "ANDROID_VERSION=$($version.versionName)"
    Write-Output "ANDROID_VERSION_CODE=$($version.versionCode)"
    Write-Output 'ANDROID_FORCE_UPDATE=false'
} finally {
    Pop-Location
}
