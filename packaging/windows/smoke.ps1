# Install each installer per user (no elevation), start the app with DITHER_SMOKE, check what it
# reports, and uninstall.
param([string]$Variant = 'standard')
$ErrorActionPreference = 'Stop'
$bundle = Join-Path $PSScriptRoot '..\..\src-tauri\target\release\bundle'

function Check-Report($path) {
  $r = Get-Content $path -Raw | ConvertFrom-Json
  Write-Host ($r | ConvertTo-Json -Depth 5)
  if ($r.error) { throw "smoke failed: $($r.error)" }
  if ($r.storage -ne 'sqlite') { throw "storage is $($r.storage), expected sqlite" }
  if ($r.modelStore -ne 'tauri') { throw "model store is $($r.modelStore), expected tauri" }
  if ($r.errors.Count -gt 0) { throw "start-up errors: $($r.errors -join '; ')" }
}

function Run-Smoke($exe) {
  $report = Join-Path $env:RUNNER_TEMP "smoke-$([guid]::NewGuid()).json"
  $env:DITHER_SMOKE = $report
  $p = Start-Process -FilePath $exe -PassThru
  if (-not $p.WaitForExit(150000)) { $p.Kill(); throw "the app did not exit" }
  if ($p.ExitCode -ne 0) { throw "the app exited with $($p.ExitCode)" }
  Check-Report $report
}

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs'

# NSIS, current user
$nsis = Get-ChildItem (Join-Path $bundle 'nsis\*.exe') | Select-Object -First 1
Start-Process -FilePath $nsis.FullName -ArgumentList '/S' -Wait
$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'DITHER'), $installRoot -Recurse -Filter 'dither.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'NSIS: dither.exe not found under the user profile' }
Run-Smoke $exe.FullName
$uninstaller = Get-ChildItem -Path $exe.DirectoryName -Filter 'uninstall*.exe' | Select-Object -First 1
if ($uninstaller) { Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait }

# MSI, per user: must not need elevation
$msi = Get-ChildItem (Join-Path $bundle 'msi\*.msi') | Select-Object -First 1
$log = Join-Path $env:RUNNER_TEMP 'msi.log'
$p = Start-Process msiexec.exe -ArgumentList '/i', "`"$($msi.FullName)`"", '/qn', '/l*v', "`"$log`"" -Wait -PassThru
if ($p.ExitCode -ne 0) { Get-Content $log -Tail 80; throw "msiexec /i failed with $($p.ExitCode)" }
$exe = Get-ChildItem -Path $installRoot -Recurse -Filter 'dither.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Get-Content $log -Tail 80; throw 'MSI: dither.exe not under %LOCALAPPDATA%\Programs (not a per-user install)' }
Run-Smoke $exe.FullName
$p = Start-Process msiexec.exe -ArgumentList '/x', "`"$($msi.FullName)`"", '/qn' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec /x failed with $($p.ExitCode)" }
Write-Host "Windows installers OK ($Variant)"
