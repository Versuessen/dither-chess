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
  if (-not $r.model.installed -or $r.model.legalMoves -ne 20) { throw "model pack check failed: $($r.model | ConvertTo-Json -Compress)" }
}

function Run-Smoke($exe) {
  $report = Join-Path $env:RUNNER_TEMP "smoke-$([guid]::NewGuid()).json"
  $env:DITHER_SMOKE = $report
  $p = Start-Process -FilePath $exe -PassThru
  if (-not $p.WaitForExit(300000)) { $p.Kill(); throw "the app did not exit" }
  if ($p.ExitCode -ne 0) {
    # A timeout report says where start-up stalled.
    if (Test-Path $report) { Write-Host (Get-Content $report -Raw) }
    throw "the app exited with $($p.ExitCode)"
  }
  Check-Report $report
}

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs'

# Serve the model packs so the app installs one through its own (Rust) download path.
$packs = Resolve-Path (Join-Path $PSScriptRoot '..\..\models\packs')
$server = Start-Process python -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', "`"$packs`"" -PassThru -WindowStyle Hidden
$env:DITHER_SMOKE_PACKS = 'http://127.0.0.1:8765/'

# NSIS, current user
$nsis = Get-ChildItem (Join-Path $bundle 'nsis\*.exe') | Select-Object -First 1
Start-Process -FilePath $nsis.FullName -ArgumentList '/S' -Wait
$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'DITHER'), $installRoot -Recurse -Filter 'dither.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'NSIS: dither.exe not found under the user profile' }
Run-Smoke $exe.FullName
$uninstaller = Get-ChildItem -Path $exe.DirectoryName -Filter 'uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'NSIS: no uninstaller next to dither.exe' }
Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait
# An NSIS uninstaller reruns itself from a temporary copy and returns at once: wait until the files
# are gone, so the MSI check below cannot find this install's dither.exe instead of its own.
$deadline = (Get-Date).AddSeconds(120)
while ((Test-Path $exe.FullName) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (Test-Path $exe.FullName) { throw 'NSIS: the uninstaller left dither.exe behind' }

# MSI, per user: it has to land in the user's profile, never under Program Files. The folder is
# %LOCALAPPDATA%\Programs\DITHER on a fresh machine; Tauri's MSI reuses the folder of an earlier
# install it finds in HKCU (the NSIS one above), which is also in the profile.
$msi = Get-ChildItem (Join-Path $bundle 'msi\*.msi') | Select-Object -First 1
$log = Join-Path $env:RUNNER_TEMP 'msi.log'
$p = Start-Process msiexec.exe -ArgumentList '/i', "`"$($msi.FullName)`"", '/qn', '/l*v', "`"$log`"" -Wait -PassThru
if ($p.ExitCode -ne 0) { Get-Content $log -Tail 80; throw "msiexec /i failed with $($p.ExitCode)" }
foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if ($pf -and (Test-Path (Join-Path $pf 'DITHER'))) { throw "MSI: installed under $pf (not a per-user install)" }
}
$exe = Get-ChildItem -Path $env:LOCALAPPDATA -Recurse -Depth 3 -Filter 'dither.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  Select-String -Path $log -Pattern 'INSTALLDIR|ProgramFiles64Folder' | Select-Object -Last 20 | ForEach-Object { $_.Line }
  throw 'MSI: dither.exe not found under %LOCALAPPDATA% (not a per-user install)'
}
Write-Host "MSI installed per user to $($exe.DirectoryName)"
Run-Smoke $exe.FullName
$p = Start-Process msiexec.exe -ArgumentList '/x', "`"$($msi.FullName)`"", '/qn' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec /x failed with $($p.ExitCode)" }
Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
Write-Host "Windows installers OK ($Variant)"
