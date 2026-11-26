#!/usr/bin/env pwsh
# Builds the Windows installer so no single file exceeds GitHub's 100 MB per-file limit.
#
# Electron 45's runtime is ~238 MB uncompressed and stays that size even from the official release
# zip, so electron-builder's default one-file NSIS installer is ~107 MB and `git push` refuses it
# (Git LFS is not installed here). The nsis-web target's payload archive can be recreated with a
# 64 MB LZMA2 dictionary and solid blocks, which compresses the same files to ~89 MB.
#
#   1. build the nsis-web target  -> tiny stub + payload archive
#   2. recreate the payload with -md=64m -ms=on, and repoint latest.yml at it
#   3. copy the stub into dist/ (also as app-setup.exe, the name the landing page links to)
#
# Run after changing renderer.js / desktop-main.js:  powershell -File .\build-windows-installer.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$out = Join-Path $env:LOCALAPPDATA "NovaCoreAndroidBuild\win-out"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
# Build outside OneDrive: it locks files during sync and electron-builder fails with EBUSY.
npx electron-builder --win nsis-web --config.directories.output="$out"
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

$sevenZip = Get-ChildItem (Join-Path $env:LOCALAPPDATA "electron-builder\Cache\7zip@*") -Recurse -Filter 7za.exe |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $sevenZip) { throw "7za.exe not found in the electron-builder cache" }

$payload = "novacore-local-search-1.0.0-x64.nsis.7z"
$payloadPath = Join-Path $out "nsis-web\$payload"
Remove-Item $payloadPath -Force -ErrorAction SilentlyContinue
& $sevenZip a -t7z -m0=lzma2 -mx=9 -md=64m -ms=on $payloadPath (Join-Path $out "win-unpacked\*") | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z payload creation failed" }

$dist = Join-Path $root "dist"
Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item (Join-Path $out "nsis-web\NovaCore-Setup-1.0.0.exe") $dist -Force
Copy-Item (Join-Path $dist "NovaCore-Setup-1.0.0.exe") (Join-Path $dist "app-setup.exe") -Force
Copy-Item $payloadPath $dist -Force

$sha512 = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash(
  [System.IO.File]::ReadAllBytes($payloadPath)))
$stubSha = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash(
  [System.IO.File]::ReadAllBytes((Join-Path $dist "NovaCore-Setup-1.0.0.exe"))))
$latest = @"
version: 1.0.0
files:
  - url: NovaCore-Setup-1.0.0.exe
    sha512: $stubSha
path: NovaCore-Setup-1.0.0.exe
packages:
  x64:
    size: $((Get-Item $payloadPath).Length)
    sha512: $sha512
    path: $payload
    file: $payload
"@
Set-Content -Path (Join-Path $dist "latest.yml") -Value $latest -Encoding utf8

foreach ($file in Get-ChildItem $dist -File) {
  $mb = [math]::Round($file.Length / 1MB, 2)
  if ($mb -gt 99) { throw "$($file.Name) is $mb MB, above GitHub's 100 MB limit" }
  Write-Host ("{0,-46} {1,8} MB" -f $file.Name, $mb)
}
Write-Host "Windows installer ready in dist/"
