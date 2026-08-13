param(
    [string]$SigningProperties = $env:HGT_ANDROID_SIGNING_PROPERTIES,
    [switch]$ForceRebuild
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')

Push-Location $repoRoot
try {
    & git diff --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Commit tracked changes before building a release APK.' }
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Commit staged changes before building a release APK.' }
    if (-not $SigningProperties) {
        $defaultSigning = Join-Path $repoRoot '.local\android-signing\signing.properties'
        if (Test-Path -LiteralPath $defaultSigning) { $SigningProperties = $defaultSigning }
    }
    if (-not $SigningProperties -or -not (Test-Path -LiteralPath $SigningProperties)) {
        throw 'External Android signing.properties is unavailable.'
    }

    $commit = (& git rev-parse HEAD).Trim()
    $version = Get-Content -LiteralPath (Join-Path $repoRoot 'apps\app-android\release\version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $artifactDir = Join-Path $repoRoot "artifacts\android\$($version.versionName)"
    $manifestPath = Join-Path $artifactDir 'release-manifest.json'
    $reuse = $false
    $apkPath = $null
    if (-not $ForceRebuild -and (Test-Path -LiteralPath $manifestPath)) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $candidate = Join-Path $artifactDir $manifest.fileName
        $reuse = $manifest.configuration -eq 'release' -and
            $manifest.gitCommit -eq $commit -and
            $manifest.versionName -eq $version.versionName -and
            $manifest.versionCode -eq $version.versionCode -and
            (Test-Path -LiteralPath $candidate)
        if ($reuse) {
            $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
            $reuse = $candidateHash -eq $manifest.sha256
            if ($reuse) { $apkPath = $candidate }
        }
    }

    if (-not $reuse) {
        & npm run app:android:release -- -SigningProperties (Resolve-Path -LiteralPath $SigningProperties).Path
        if ($LASTEXITCODE -ne 0) { throw 'Android Release build failed.' }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $apkPath = Join-Path $artifactDir $manifest.fileName
    }
    & npm run app:android:verify -- -ApkPath $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'Android artifact verification failed.' }
    Write-Output "APK=$apkPath"
    Write-Output "REUSED_VERIFIED_ARTIFACT=$reuse"
} finally {
    Pop-Location
}
