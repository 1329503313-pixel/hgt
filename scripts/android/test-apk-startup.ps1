param([Parameter(Mandatory = $true)][string]$ApkPath)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $repoRoot '.local'
$extractRoot = Join-Path $localRoot ('apk-startup-' + [guid]::NewGuid().ToString('N'))
$extractPrefix = [IO.Path]::GetFullPath($extractRoot) + [IO.Path]::DirectorySeparatorChar
if (-not $extractPrefix.StartsWith(([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'APK test extraction directory is outside the workspace.'
}
$previousDist = $env:HGT_STARTUP_ANDROID_DIST
$archive = $null
Push-Location $repoRoot
try {
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
    foreach ($entry in $archive.Entries) {
        if (-not $entry.FullName.StartsWith('assets/public/', [StringComparison]::Ordinal) -or $entry.FullName.EndsWith('/')) { continue }
        $relative = $entry.FullName.Substring('assets/public/'.Length)
        $destination = [IO.Path]::GetFullPath((Join-Path $extractRoot $relative))
        if (-not $destination.StartsWith($extractPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe APK asset path.' }
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
    }
    $archive.Dispose()
    $archive = $null
    $env:HGT_STARTUP_ANDROID_DIST = $extractRoot
    npm run test:application-startup -- --android-only
    if ($LASTEXITCODE -ne 0) { throw 'The signed APK web assets failed the startup / microphone browser gate.' }
} finally {
    if ($archive) { $archive.Dispose() }
    $env:HGT_STARTUP_ANDROID_DIST = $previousDist
    Pop-Location
    if (Test-Path -LiteralPath $extractRoot) {
        $cleanupPath = (Resolve-Path -LiteralPath $extractRoot).Path
        if ($cleanupPath -eq $extractPrefix.TrimEnd([IO.Path]::DirectorySeparatorChar) -and $cleanupPath.StartsWith(([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $cleanupPath -Recurse -Force
        } else { throw 'Refusing to remove an unexpected APK test directory.' }
    }
}
