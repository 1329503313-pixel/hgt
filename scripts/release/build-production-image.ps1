param([Parameter(Mandatory = $true)][string]$Commit)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'file-hash.ps1')
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'A full release commit is required.' }
$short = $Commit.Substring(0, 7)
$output = Join-Path $repoRoot 'artifacts\deploy'
$bundle = Join-Path $output "hgt-production-$short.tar.gz"
# A fresh context prevents a retry from retaining files with previously garbled names.
$context = Join-Path $output "docker-context-$short-$([Guid]::NewGuid().ToString('N'))"
$assetManifest = Join-Path $output "hgt-public-assets-$short.json"
$assetChecker = Join-Path $PSScriptRoot 'check-production-assets.mjs'
$imageTar = Join-Path $output "hgt-image-$short.tar"
$archive = "$imageTar.gz"
$imageTag = "hgt:$short"
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Create the allowlisted source bundle first.' }
New-Item -ItemType Directory -Force -Path $context | Out-Null
# Windows bsdtar otherwise decodes Git's UTF-8 filenames using the system code page.
& tar --options hdrcharset=UTF-8 -xzf $bundle -C $context
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the allowlisted build context.' }
& node $assetChecker create --commit $Commit --manifest $assetManifest
if ($LASTEXITCODE -ne 0) { throw 'Cannot create the committed public asset manifest.' }
& node $assetChecker verify --manifest $assetManifest --root (Join-Path $context 'apps/web/public')
if ($LASTEXITCODE -ne 0) { throw 'Extracted public assets differ from the release commit.' }
& docker build --pull=false --platform linux/amd64 --label "org.opencontainers.image.revision=$Commit" -t $imageTag $context
if ($LASTEXITCODE -ne 0) { throw 'Local production image build failed.' }
& docker run --rm --entrypoint sh $imageTag -lc 'test ! -e /app/.env; test ! -e /app/apps/server/.env; test ! -e /app/apps/web/.env'
if ($LASTEXITCODE -ne 0) { throw 'Local image contains an unexpected environment file.' }
& docker run --rm --network none --mount "type=bind,source=$assetChecker,target=/tmp/check-assets.mjs,readonly" --mount "type=bind,source=$assetManifest,target=/tmp/public-assets.json,readonly" --entrypoint node $imageTag /tmp/check-assets.mjs verify --manifest /tmp/public-assets.json --root /app/apps/web/dist
if ($LASTEXITCODE -ne 0) { throw 'Production image public assets differ from the release commit.' }
& docker save --output $imageTar $imageTag
if ($LASTEXITCODE -ne 0) { throw 'Cannot export the local production image.' }
$inputStream = [IO.File]::OpenRead($imageTar)
$outputStream = [IO.File]::Create($archive)
$gzip = [IO.Compression.GZipStream]::new($outputStream, [IO.Compression.CompressionMode]::Compress)
try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose(); $outputStream.Dispose(); $inputStream.Dispose() }
Remove-Item -LiteralPath $imageTar
$hash = Get-HgtFileSha256 -LiteralPath $archive
[ordered]@{commit=$Commit;fileName=[IO.Path]::GetFileName($archive);sha256=$hash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output "hgt-image-$short.json") -Encoding UTF8
Write-Output "LOCAL_PRODUCTION_IMAGE=$imageTag"
Write-Output "IMAGE_ARCHIVE_SHA256=$hash"
