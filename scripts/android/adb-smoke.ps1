param([string]$ApkPath = "apps\app-android\android\app\build\outputs\apk\debug\app-debug.apk")

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$adb = Join-Path $repoRoot '.local\android-sdk\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw 'adb.exe not found. Run npm run app:android:setup-sdk.' }
$ready = @(& $adb devices | Select-String -Pattern '^\S+\s+device$')
if ($ready.Count -ne 1) { throw "Exactly one online Android device/emulator is required; found $($ready.Count)." }
$resolvedApk = (Resolve-Path -LiteralPath (Join-Path $repoRoot $ApkPath)).Path
& $adb install -r $resolvedApk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $adb shell am force-stop com.caqis.hgt.dev
& $adb shell monkey -p com.caqis.hgt.dev -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 3
$activity = & $adb shell dumpsys activity activities
if ($activity -notmatch 'com\.caqis\.hgt\.dev/.MainActivity') { throw 'MainActivity did not reach the foreground.' }
$fatal = & $adb logcat -d -t 400 '*:E'
if ($fatal -match 'FATAL EXCEPTION.*com\.caqis\.hgt\.dev') { throw 'A fatal exception was found after launch.' }
Write-Output 'ADB smoke gate passed: install, launch, foreground activity, fatal-log scan.'
