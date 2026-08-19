param([string]$ApkPath)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$appRoot = Join-Path $repoRoot 'apps\app-android'
$version = Get-Content -LiteralPath (Join-Path $appRoot 'release\version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedCertificate = (Get-Content -LiteralPath (Join-Path $appRoot 'release\signing-certificate.sha256') -Raw).Trim().Replace(':', '').ToLowerInvariant()
$localSdkRoot = Join-Path $repoRoot '.local\android-sdk'
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $localSdkRoot }
if (-not $sdkRoot -or -not (Test-Path -LiteralPath $sdkRoot)) {
    throw 'Android SDK not found. Set ANDROID_SDK_ROOT before verifying an APK.'
}

if (-not $ApkPath) {
    $latest = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'artifacts\android') -Recurse -Filter '*-release.apk' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) { throw 'No release APK exists under artifacts/android.' }
    $ApkPath = $latest.FullName
}
$ApkPath = (Resolve-Path -LiteralPath $ApkPath).Path

$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android SDK build-tools are missing.' }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
if (-not (Test-Path -LiteralPath $apksigner)) { throw "apksigner not found: $apksigner" }
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
if (-not (Test-Path -LiteralPath $aapt)) { throw "aapt not found: $aapt" }

$signatureOutput = & $apksigner verify --verbose --print-certs $ApkPath 2>&1
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$signatureOutput | Write-Output
$certificateLine = $signatureOutput | Select-String -Pattern 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)' | Select-Object -First 1
if (-not $certificateLine -or $certificateLine.Matches[0].Groups[1].Value.ToLowerInvariant() -ne $expectedCertificate) {
    throw 'APK signing certificate does not match release/signing-certificate.sha256.'
}

$badging = & $aapt dump badging $ApkPath
if ($LASTEXITCODE -ne 0) { throw 'Unable to read APK package metadata.' }
$packageLine = $badging | Select-String -Pattern "^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'" | Select-Object -First 1
if (-not $packageLine) { throw 'APK package metadata is missing.' }
$packageMatch = $packageLine.Matches[0]
if ($packageMatch.Groups[1].Value -ne 'com.caqis.hgt') { throw "Unexpected applicationId: $($packageMatch.Groups[1].Value)" }
if ($packageMatch.Groups[2].Value -ne [string]$version.versionCode) { throw "Unexpected versionCode: $($packageMatch.Groups[2].Value)" }
if ($packageMatch.Groups[3].Value -ne [string]$version.versionName) { throw "Unexpected versionName: $($packageMatch.Groups[3].Value)" }

$permissions = (& $aapt dump permissions $ApkPath) -join "`n"
foreach ($requiredPermission in @('android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES')) {
    if ($permissions -notmatch [regex]::Escape($requiredPermission)) { throw "Required APK permission is missing: $requiredPermission" }
}
foreach ($forbiddenPermission in @('android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.MANAGE_EXTERNAL_STORAGE')) {
    if ($permissions -match [regex]::Escape($forbiddenPermission)) { throw "Unexpected sensitive APK permission: $forbiddenPermission" }
}

$apkStream = [System.IO.File]::OpenRead($ApkPath)
try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($apkStream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
} finally {
    $apkStream.Dispose()
}
Write-Output "Package: com.caqis.hgt"
Write-Output "Version: $($version.versionName) ($($version.versionCode))"
Write-Output "Certificate SHA256: $expectedCertificate"
Write-Output "APK: $ApkPath"
Write-Output "SHA256: $hash"
