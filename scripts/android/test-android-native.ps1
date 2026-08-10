$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$androidRoot = Join-Path $repoRoot 'apps\app-android\android'
$localJdkRoot = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.local\jdk-21') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName -First 1
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = $localJdkRoot }
if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = Join-Path $repoRoot '.local\android-sdk' }
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $repoRoot '.local\gradle-home' }
Push-Location $androidRoot
try {
    & '.\gradlew.bat' --no-daemon --max-workers=1 --console=plain testDebugUnitTest
    if ($LASTEXITCODE -ne 0) { throw 'Android native unit tests failed.' }
} finally {
    Pop-Location
}
