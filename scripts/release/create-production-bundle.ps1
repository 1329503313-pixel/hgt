param(
    [string]$Commit = 'HEAD',
    [string]$OutputDirectory = 'artifacts/deploy'
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')

Push-Location $repoRoot
try {
    $resolvedCommit = (& git rev-parse --verify "$Commit^{commit}").Trim()
    if ($LASTEXITCODE -ne 0 -or $resolvedCommit -notmatch '^[0-9a-f]{40}$') {
        throw "Invalid Git commit: $Commit"
    }
    $shortCommit = $resolvedCommit.Substring(0, 7)
    $outputRoot = Join-Path $repoRoot $OutputDirectory
    New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
    $bundlePath = Join-Path $outputRoot "hgt-production-$shortCommit.tar.gz"

    # This allowlist is the exact Docker build context. It intentionally excludes
    # Android, historical apps/app, docs, design sources, artifacts and all local
    # environment/signing material.
    $paths = @(
        '.dockerignore',
        'Dockerfile',
        'package.json',
        'package-lock.json',
        '.npmrc',
        'apps/server/package.json',
        'apps/server/tsconfig.json',
        'apps/server/src',
        'scripts/release/check-production-auth-contract.mjs',
        'apps/web/package.json',
        'apps/web/vite.config.ts',
        'apps/web/postcss.config.js',
        'apps/web/tailwind.config.ts',
        'apps/web/index.html',
        'apps/web/src',
        'apps/web/public'
    )
    $archiveArgs = @('archive', '--format=tar.gz', "--output=$bundlePath", $resolvedCommit, '--') + $paths
    & git @archiveArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bundlePath)) {
        throw 'Unable to create the production bundle.'
    }

    $entries = @(& tar -tzf $bundlePath)
    if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) {
        throw 'Unable to inspect the production bundle.'
    }
    $forbidden = $entries | Where-Object {
        $_ -match '(^|/)(\.git|\.env($|\.)|\.claude|artifacts|\.local)(/|$)' -or
        $_ -match '(signing\.properties|\.keystore$|\.jks$|secret)'
    }
    if ($forbidden) {
        throw "Forbidden files entered the production bundle: $($forbidden -join ', ')"
    }

    $item = Get-Item -LiteralPath $bundlePath
    $hash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        commit = $resolvedCommit
        shortCommit = $shortCommit
        fileName = $item.Name
        fileSize = $item.Length
        sha256 = $hash
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $manifestPath = Join-Path $outputRoot "hgt-production-$shortCommit.json"
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Write-Output "BUNDLE=$bundlePath"
    Write-Output "COMMIT=$resolvedCommit"
    Write-Output "SHA256=$hash"
    Write-Output "SIZE=$($item.Length)"
} finally {
    Pop-Location
}
