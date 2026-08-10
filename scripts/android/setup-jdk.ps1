$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$downloadRoot = Join-Path $repoRoot '.local\jdk-download'
$installRoot = Join-Path $repoRoot '.local\jdk-21'
$archiveName = 'microsoft-jdk-21.0.12-windows-x64.zip'
$archivePath = Join-Path $downloadRoot $archiveName
$downloadUrl = "https://aka.ms/download-jdk/$archiveName"
$expectedSha256 = 'bf27a5d6298c736af8daf5b8c883098e83291446e5766118d8a5ea6a2617195d'

$existingJdk = Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Select-Object -First 1
if ($existingJdk) {
    Write-Output "JDK 21 already installed: $($existingJdk.FullName)"
    exit 0
}

New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
if (-not (Test-Path -LiteralPath $archivePath) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant() -ne $expectedSha256) {
    & curl.exe -L --fail --retry 5 --retry-delay 2 -o $archivePath $downloadUrl
    if ($LASTEXITCODE -ne 0) { throw 'OpenJDK 21 download failed.' }
}

$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "OpenJDK 21 checksum mismatch: $actualSha256"
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot
$installedJdk = Get-ChildItem -LiteralPath $installRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Select-Object -First 1
if (-not $installedJdk) { throw 'OpenJDK 21 extraction did not produce a complete JDK.' }

Write-Output "JDK 21 installed: $($installedJdk.FullName)"
Write-Output "SHA256: $actualSha256"
