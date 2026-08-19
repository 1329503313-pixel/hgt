function Get-HgtFileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath).Path
    $stream = [System.IO.File]::OpenRead($resolvedPath)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}
