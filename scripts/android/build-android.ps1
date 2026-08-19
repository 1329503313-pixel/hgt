param(
    [ValidateSet('debug', 'release')]
    [string]$Configuration = 'debug',
    [string]$SigningProperties = $env:HGT_ANDROID_SIGNING_PROPERTIES
)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$appRoot = Join-Path $repoRoot 'apps\app-android'
$androidRoot = Join-Path $appRoot 'android'
$versionFile = Join-Path $appRoot 'release\version.json'
$version = Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8 | ConvertFrom-Json

if ($Configuration -eq 'release') {
    $worktreeStatus = @(& git -C $repoRoot status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree before building a release APK.' }
    if ($worktreeStatus.Count -gt 0) {
        throw 'Release APK builds require a completely clean Git worktree, including no untracked files.'
    }
}

if (-not ($version.versionCode -is [int]) -or $version.versionCode -le 0) {
    throw 'release/version.json versionCode must be a positive integer.'
}
if ([string]::IsNullOrWhiteSpace([string]$version.versionName)) {
    throw 'release/version.json versionName must not be empty.'
}

$localSdkRoot = Join-Path $repoRoot '.local\android-sdk'
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $localSdkRoot }
if (-not $sdkRoot -or -not (Test-Path -LiteralPath $sdkRoot)) {
    throw 'Android SDK not found. Install Android SDK 36 and set ANDROID_SDK_ROOT.'
}
$env:ANDROID_SDK_ROOT = $sdkRoot
$localGradleHome = Join-Path $repoRoot '.local\gradle-home'
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = $localGradleHome }
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null
$localJdkRoot = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.local\jdk-21') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName -First 1
$jdkRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } elseif ($localJdkRoot) { $localJdkRoot } else {
    Get-ChildItem -LiteralPath 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
        Sort-Object FullName -Descending |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $jdkRoot -or -not (Test-Path -LiteralPath (Join-Path $jdkRoot 'bin\java.exe'))) {
    throw 'JDK 21 not found. Run npm run app:android:setup-jdk or set JAVA_HOME to JDK 21.'
}
$env:JAVA_HOME = $jdkRoot
$javaExe = Join-Path $jdkRoot 'bin\java.exe'
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$javaVersionOutput = & $javaExe -version 2>&1 | Out-String
$ErrorActionPreference = $previousErrorActionPreference
if ($javaVersionOutput -notmatch 'version "21\.') {
    throw "Capacitor 8 Android builds require JDK 21. Selected JAVA_HOME is $jdkRoot."
}

Push-Location $repoRoot
try {
    npm run app:android:brand
    if ($LASTEXITCODE -ne 0) { throw 'Android brand asset generation failed.' }
    npm run app:android:check
    if ($LASTEXITCODE -ne 0) { throw 'Android source contract gate failed.' }

    if ($Configuration -eq 'debug') {
        npm run build:android:local -w @hgt/web
        $env:HGT_ANDROID_PROFILE = 'local'
    } else {
        npm run build:android -w @hgt/web
        $env:HGT_ANDROID_PROFILE = 'release'
        if (-not $SigningProperties) {
            throw 'Release build requires external signing settings via -SigningProperties or HGT_ANDROID_SIGNING_PROPERTIES.'
        }
        $SigningProperties = (Resolve-Path -LiteralPath $SigningProperties).Path
    }

    npm run app:android:check:dist
    if ($LASTEXITCODE -ne 0) { throw 'Android dist contract gate failed.' }

    $adminChunks = @(Get-ChildItem -LiteralPath 'apps\web\dist-android\assets' -File | Where-Object { $_.Name -match 'Admin|Management' })
    if ($adminChunks.Count -gt 0) {
        throw "Android web output contains admin chunks: $($adminChunks.Name -join ', ')"
    }

    npm run sync -w @hgt/app-android

    [string[]]$gradleArguments = if ($Configuration -eq 'release') {
        @('--no-daemon', '--max-workers=1', '--console=plain', 'testDebugUnitTest', 'assembleRelease', "-PhgtSigningProperties=$SigningProperties")
    } else {
        @('--no-daemon', '--max-workers=1', '--console=plain', 'testDebugUnitTest', 'assembleDebug')
    }
    Push-Location $androidRoot
    try {
        & '.\gradlew.bat' $gradleArguments
        if ($LASTEXITCODE -ne 0) { throw "Gradle $Configuration build failed." }
    } finally {
        Pop-Location
    }

    $sourceApk = if ($Configuration -eq 'release') {
        Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
    } else {
        Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
    }
    if (-not (Test-Path -LiteralPath $sourceApk)) { throw "APK not found: $sourceApk" }

    $gitSha = (git rev-parse --short=7 HEAD).Trim()
    $artifactDir = Join-Path $repoRoot ("artifacts\android\{0}" -f $version.versionName)
    New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
    $artifactName = "hgt-android-{0}+{1}-{2}-{3}.apk" -f $version.versionName, $version.versionCode, $gitSha, $Configuration
    $artifactPath = Join-Path $artifactDir $artifactName
    Copy-Item -LiteralPath $sourceApk -Destination $artifactPath -Force

    $hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        applicationId = if ($Configuration -eq 'debug') { 'com.caqis.hgt.dev' } else { 'com.caqis.hgt' }
        versionName = [string]$version.versionName
        versionCode = [int]$version.versionCode
        channel = [string]$version.channel
        configuration = $Configuration
        gitCommit = (git rev-parse HEAD).Trim()
        fileName = $artifactName
        fileSize = (Get-Item -LiteralPath $artifactPath).Length
        sha256 = $hash
        builtAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDir 'release-manifest.json') -Encoding UTF8
    "$hash  $artifactName" | Set-Content -LiteralPath (Join-Path $artifactDir 'SHA256SUMS.txt') -Encoding ascii
    Write-Output "APK: $artifactPath"
    Write-Output "SHA256: $hash"
} finally {
    Pop-Location
}
