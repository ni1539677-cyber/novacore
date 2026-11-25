Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipEntry($zip, $name) {
  $entry = $zip.Entries | Where-Object { $_.FullName -eq $name }
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  $content = $reader.ReadToEnd()
  $reader.Close()
  return $content
}

$root = "c:\Users\user\OneDrive\Desktop\Nova Core"

# --- Android APK ---
$apk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
$renderer = Read-ZipEntry $zip "assets/renderer.js"
$config = Read-ZipEntry $zip "assets/novacore-config.js"
$sw = Read-ZipEntry $zip "assets/service-worker.js"
$zip.Dispose()

"=== Android APK ==="
"file            : $apk"
"size            : $((Get-Item $apk).Length) bytes"
"novacore-config : $(if ($config) { 'present' } else { 'MISSING' })"
"config value    : $((($config -split "`r?`n") | Where-Object { $_ -match '^window.NOVACORE_API_BASE' }) -join '')"
"api base logic  : $($renderer.Contains('window.NOVACORE_API_BASE'))"
"service worker  : $((($sw -split "`r?`n") | Select-Object -First 1))"

# --- Windows installer ---
$setup = Join-Path $root "dist\NovaCore-Setup-1.0.0.exe"
"`n=== Windows installer ==="
"file            : $setup"
"size            : $((Get-Item $setup).Length) bytes"
"built           : $((Get-Item $setup).LastWriteTime)"

# electron-builder stores app files in app.asar inside the installer's app-64.7z payload.
# Read the packed app.asar from the win-unpacked build, which is the same payload.
$asar = Join-Path $root "dist\win-unpacked\resources\app.asar"
if (-not (Test-Path $asar)) {
  $asar = Get-ChildItem (Join-Path $root "dist") -Recurse -Filter "app.asar" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if ($asar -and (Test-Path $asar)) {
  "app.asar        : $asar"
  $bytes = [System.IO.File]::ReadAllBytes($asar)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  "contains novacore-config.js  : $($text.Contains('novacore-config.js'))"
  "contains API base logic      : $($text.Contains('NOVACORE_API_BASE'))"
  "contains fetchable /api/search: $($text.Contains('/api/search'))"
} else {
  "app.asar        : not found in dist"
}
