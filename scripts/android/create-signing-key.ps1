param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot '.local\android-signing'
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$keystorePath = Join-Path $OutputDirectory 'hgt-release.keystore'
$propertiesPath = Join-Path $OutputDirectory 'signing.properties'
if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw "Signing material already exists under $OutputDirectory. Refusing to overwrite it."
}

$keytool = (Get-Command keytool.exe -ErrorAction SilentlyContinue).Source
if (-not $keytool -and $env:JAVA_HOME) {
    $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    if (Test-Path -LiteralPath $candidate) { $keytool = $candidate }
}
if (-not $keytool) {
    $keytool = Get-ChildItem -LiteralPath 'C:\Program Files\Java' -Recurse -Filter 'keytool.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $keytool) { throw 'keytool.exe was not found. Install JDK 21 or set JAVA_HOME.' }

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$randomBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
$password = [Convert]::ToBase64String($randomBytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
$env:HGT_NEW_KEYSTORE_PASSWORD = $password
try {
    & $keytool -genkeypair -noprompt `
        -alias hgt-release `
        -keyalg RSA `
        -keysize 4096 `
        -sigalg SHA256withRSA `
        -validity 10000 `
        -dname 'CN=HGT Android, OU=Mobile, O=CAQIS, L=Beijing, ST=Beijing, C=CN' `
        -storetype PKCS12 `
        -keystore $keystorePath `
        -storepass:env HGT_NEW_KEYSTORE_PASSWORD `
        -keypass:env HGT_NEW_KEYSTORE_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed to create the release keystore.' }

    $lines = @(
        'storeFile=hgt-release.keystore',
        "storePassword=$password",
        'keyAlias=hgt-release',
        "keyPassword=$password"
    )
    [System.IO.File]::WriteAllLines($propertiesPath, $lines, [System.Text.Encoding]::ASCII)
    & $keytool -list -v -alias hgt-release -keystore $keystorePath -storepass:env HGT_NEW_KEYSTORE_PASSWORD |
        Select-String -Pattern 'SHA256:'
} finally {
    Remove-Item Env:HGT_NEW_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    $password = $null
}

Write-Output "Keystore created: $keystorePath"
Write-Output "Signing settings created: $propertiesPath"
Write-Output 'Back up both files to secure offline storage. Losing them makes future in-place upgrades impossible.'
