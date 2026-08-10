$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$localRoot = Join-Path $repoRoot '.local'
$sdkRoot = Join-Path $localRoot 'android-sdk'
$archive = Join-Path $localRoot 'commandlinetools-win-15859902_latest.zip'
$downloadUrl = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
$expectedSha256 = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$latestTools = Join-Path $sdkRoot 'cmdline-tools\latest'
$sdkManager = Join-Path $latestTools 'bin\sdkmanager.bat'

New-Item -ItemType Directory -Force -Path $localRoot, $sdkRoot | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -UseBasicParsing
}
$actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "Android command-line tools checksum mismatch: $actualSha256"
}

if (-not (Test-Path -LiteralPath $sdkManager)) {
    if (Test-Path -LiteralPath $latestTools) {
        throw "Incomplete Android command-line tools directory exists: $latestTools"
    }
    $staging = Join-Path $localRoot 'android-commandline-tools-staging'
    if (Test-Path -LiteralPath $staging) {
        throw "Android SDK staging directory already exists: $staging"
    }
    New-Item -ItemType Directory -Path $staging | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $latestTools) | Out-Null
    Move-Item -LiteralPath (Join-Path $staging 'cmdline-tools') -Destination $latestTools
}

$jdkRoot = Get-ChildItem -LiteralPath 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName -First 1
if (-not $jdkRoot) { throw 'JDK 17 was not found under C:\Program Files\Java.' }
$env:JAVA_HOME = $jdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

$licenseAnswers = 1..20 | ForEach-Object { 'y' }
$licenseAnswers | & $sdkManager --sdk_root=$sdkRoot --licenses | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Android SDK license acceptance failed.' }

& $sdkManager --sdk_root=$sdkRoot 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK package installation failed.' }
Write-Output "Android SDK ready: $sdkRoot"
