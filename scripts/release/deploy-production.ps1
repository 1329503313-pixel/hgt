param(
    [string]$Commit = 'HEAD',
    [string]$ProductionHost = 'root@47.239.5.69',
    [string]$VoiceEnvironmentFile,
    [string]$SmsEnvironmentFile,
    [switch]$BuildImageLocally,
    [switch]$ConfirmFullDeployment
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmFullDeployment) {
    throw 'Production deployment requires -ConfirmFullDeployment and a current explicit user authorization for 全量部署.'
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$bundleScript = Join-Path $scriptRoot 'create-production-bundle.ps1'
$remoteScript = Join-Path $scriptRoot 'production-deploy.sh'
$preflightScript = Join-Path $scriptRoot 'production-preflight.sh'
$remoteCleanupReady = $false
$remoteVoiceDirectory = $null
$remoteSmsDirectory = $null
$smsTransferPath = $null
$remoteImage = $null

Push-Location $repoRoot
try {
    $worktreeStatus = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree before deployment.' }
    if ($worktreeStatus.Count -gt 0) { throw 'Production deployment requires a completely clean Git worktree.' }

    & npm run release:check:auth
    if ($LASTEXITCODE -ne 0) { throw 'Production authentication source contract failed.' }

    $resolvedCommit = (& git rev-parse --verify "$Commit^{commit}").Trim()
    if ($LASTEXITCODE -ne 0 -or $resolvedCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid deployment commit.' }
    $shortCommit = $resolvedCommit.Substring(0, 7)
    $voicePath = $null
    $smsPath = $null
    if ($VoiceEnvironmentFile) {
        $voicePath = (Resolve-Path -LiteralPath $VoiceEnvironmentFile).Path
        $voiceLines = @(Get-Content -LiteralPath $voicePath -Encoding UTF8)
        $voiceKeys = @('VOICE_ROOMS_ENABLED', 'TRTC_ADVANCED_PERMISSION', 'TRTC_SDK_APP_ID', 'TRTC_SDK_SECRET', 'TRTC_SECRET_ID', 'TRTC_SECRET_KEY')
        if ($voiceLines.Count -ne $voiceKeys.Count) { throw 'RTC environment must contain exactly six allowlisted entries.' }
        foreach ($key in $voiceKeys) {
            if (@($voiceLines | Where-Object { $_ -match "^${key}=[A-Za-z0-9_+/=.-]+$" }).Count -ne 1) {
                throw "RTC environment has a missing or invalid entry: $key"
            }
        }
        if ($voiceLines -notcontains 'VOICE_ROOMS_ENABLED=true' -or $voiceLines -notcontains 'TRTC_ADVANCED_PERMISSION=true') {
            throw 'RTC activation requires both feature and advanced-permission flags.'
        }
    }
    if ($SmsEnvironmentFile) {
        $smsPath = (Resolve-Path -LiteralPath $SmsEnvironmentFile).Path
        $smsLines = @(Get-Content -LiteralPath $smsPath -Encoding UTF8)
        $smsKeys = @('ALIYUN_SMS_ENDPOINT', 'ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE')
        if ($smsLines.Count -ne $smsKeys.Count) { throw 'SMS environment must contain exactly five allowlisted entries.' }
        foreach ($key in $smsKeys) {
            if (@($smsLines | Where-Object { $_ -match "^${key}=[^=\r\n]+$" }).Count -ne 1) {
                throw "SMS environment has a missing or invalid entry: $key"
            }
        }
        if (@($smsLines | Where-Object { $_ -match '^ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE=SMS_[0-9]+$' }).Count -ne 1) {
            throw 'SMS verification template code must match SMS_<digits>.'
        }
        if (@($smsLines | Where-Object { $_ -match '^ALIYUN_SMS_ENDPOINT=[A-Za-z0-9.-]+$' }).Count -ne 1) {
            throw 'SMS endpoint must be a hostname.'
        }
        $smsTransferPath = Join-Path $repoRoot ('.local\sms-transfer-' + [guid]::NewGuid().ToString('N') + '.env')
        [IO.File]::WriteAllText($smsTransferPath, ($smsLines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    }
    & $bundleScript -Commit $resolvedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Production bundle creation failed.' }

    $manifestPath = Join-Path $repoRoot "artifacts\deploy\hgt-production-$shortCommit.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundlePath = Join-Path $repoRoot "artifacts\deploy\$($manifest.fileName)"
    $imageManifest = $null
    if ($BuildImageLocally) {
        & (Join-Path $scriptRoot 'build-production-image.ps1') -Commit $resolvedCommit
        if ($LASTEXITCODE -ne 0) { throw 'Local production image preparation failed.' }
        $imageManifest = Get-Content -LiteralPath (Join-Path $repoRoot "artifacts\deploy\hgt-image-$shortCommit.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($imageManifest.commit -ne $resolvedCommit -or $imageManifest.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid local image manifest.' }
    }
    $remoteRoot = '/opt/hgt-releases'
    $remoteBundle = "$remoteRoot/incoming/$($manifest.fileName)"
    $remoteDeployScript = "$remoteRoot/production-deploy.sh"
    $remotePreflightScript = "$remoteRoot/production-preflight.sh"
    $remoteCleanupReady = $true

    & ssh -o BatchMode=yes $ProductionHost "mkdir -p $remoteRoot/incoming"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the remote release directory.' }
    & scp -o BatchMode=yes $preflightScript "${ProductionHost}:$remotePreflightScript"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the production preflight script.' }
    & ssh -o BatchMode=yes $ProductionHost "sh $remotePreflightScript"
    if ($LASTEXITCODE -ne 0) { throw 'Production authentication preflight failed; no application bundle was uploaded.' }
    $remoteVoiceArgument = '-'
    if ($voicePath) {
        $remoteVoiceDirectory = "$remoteRoot/incoming/voice-$shortCommit"
        & ssh -o BatchMode=yes $ProductionHost "umask 077; mkdir -m 700 $remoteVoiceDirectory"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the private RTC transfer directory.' }
        & scp -o BatchMode=yes $voicePath "${ProductionHost}:$remoteVoiceDirectory/runtime.env"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to transfer RTC configuration.' }
        & ssh -o BatchMode=yes $ProductionHost "chmod 600 $remoteVoiceDirectory/runtime.env"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict RTC configuration permissions.' }
        $remoteVoiceArgument = "$remoteVoiceDirectory/runtime.env"
    }
    $remoteSmsArgument = ''
    if ($smsPath) {
        $remoteSmsDirectory = "$remoteRoot/incoming/sms-$shortCommit"
        & ssh -o BatchMode=yes $ProductionHost "umask 077; mkdir -m 700 $remoteSmsDirectory"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the private SMS transfer directory.' }
        & scp -o BatchMode=yes $smsTransferPath "${ProductionHost}:$remoteSmsDirectory/runtime.env"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to transfer SMS configuration.' }
        & ssh -o BatchMode=yes $ProductionHost "chmod 600 $remoteSmsDirectory/runtime.env"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict SMS configuration permissions.' }
        $remoteSmsArgument = "$remoteSmsDirectory/runtime.env"
    }
    & scp -o BatchMode=yes $bundlePath "${ProductionHost}:$remoteBundle"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the production bundle.' }
    & scp -o BatchMode=yes $remoteScript "${ProductionHost}:$remoteDeployScript"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the production deployment script.' }
    $remoteImageArguments = ''
    if ($imageManifest) {
        $localImage = Join-Path $repoRoot "artifacts\deploy\$($imageManifest.fileName)"
        $remoteImage = "$remoteRoot/incoming/$($imageManifest.fileName)"
        & scp -o BatchMode=yes $localImage "${ProductionHost}:$remoteImage"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the locally built image.' }
        $remoteImageArguments = "$remoteImage $($imageManifest.sha256)"
    }

    $currentContainerId = (& ssh -o BatchMode=yes $ProductionHost "docker inspect -f '{{.Id}}' hgt-app").Trim()
    if ($LASTEXITCODE -ne 0 -or $currentContainerId -notmatch '^[0-9a-f]{64}$') {
        throw 'Unable to read the current production container ID.'
    }
    & ssh -o BatchMode=yes $ProductionHost "sh $remoteDeployScript $remoteBundle $resolvedCommit $($manifest.sha256) $currentContainerId deploy-hgt-production $remoteVoiceArgument $remoteImageArguments $remoteSmsArgument"
    if ($LASTEXITCODE -ne 0) { throw 'Production deployment failed or rolled back.' }

    foreach ($url in @('https://hgt.caqis.com/api/health', 'https://hgt.caqis.com/')) {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
        if ($response.StatusCode -ne 200) { throw "Production verification failed: $url" }
    }
    Write-Output "PRODUCTION_COMMIT=$resolvedCommit"
    Write-Output 'PUBLIC_HEALTH=ok'
} finally {
    if ($remoteCleanupReady) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remoteBundle $remoteDeployScript $remotePreflightScript" 2>$null | Out-Null
    }
    if ($remoteVoiceDirectory) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remoteVoiceDirectory/runtime.env; rmdir $remoteVoiceDirectory" 2>$null | Out-Null
    }
    if ($remoteSmsDirectory) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remoteSmsDirectory/runtime.env; rmdir $remoteSmsDirectory" 2>$null | Out-Null
    }
    if ($smsTransferPath -and (Test-Path -LiteralPath $smsTransferPath)) {
        Remove-Item -LiteralPath $smsTransferPath -Force
    }
    if ($remoteImage) {
        & ssh -o BatchMode=yes $ProductionHost "rm -f $remoteImage" 2>$null | Out-Null
    }
    Pop-Location
}
