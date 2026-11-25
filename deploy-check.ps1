# NovaCore deployment preflight.
#
# Reproduces exactly what the Dockerfile copies into the image (no Docker required), starts the
# server from that isolated folder with the same env the host injects, and probes the routes a
# live deployment must answer. Run this before pushing:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-check.ps1
#
# Exit code 0 = the image contents are deployable. Non-zero = fix the reported problem first.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$failures = New-Object System.Collections.Generic.List[string]
$port = 3179
$stage = Join-Path $env:TEMP ("novacore-deploy-gate-" + [Guid]::NewGuid().ToString("N"))
$proc = $null

function Fail([string]$message) { $script:failures.Add($message) | Out-Null }

try {
  # 1. Every path the Dockerfile COPYs must exist, or the image build fails in the cloud.
  $imageFiles = @(
    "package.json", "server.js", "gemini-api.js", "content-filter.js",
    "app.html", "landing.html", "style.css", "bootstrap.js", "novacore-config.js",
    "renderer.js", "manifest.webmanifest", "service-worker.js",
    "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/icon.ico",
    "downloads/NovaCore-Android-debug.apk"
  )
  # A file counts as shipped when the Dockerfile names it (COPY file) or its folder (COPY folder).
  $dockerfile = Get-Content (Join-Path $root "Dockerfile") -Raw
  foreach ($relative in $imageFiles) {
    if (-not (Test-Path (Join-Path $root $relative))) { Fail "Missing file required by the image: $relative" }
    $name = Split-Path $relative -Leaf
    $folder = Split-Path $relative -Parent
    $shipped = $dockerfile -match [regex]::Escape($name) -or ($folder -and $dockerfile -match "COPY\s+$([regex]::Escape($folder))\s")
    if (-not $shipped) { Fail "Dockerfile does not COPY $relative (or its folder $folder)" }
  }

  # 2. Nothing the image needs may be excluded by .dockerignore.
  $ignore = Get-Content (Join-Path $root ".dockerignore")
  foreach ($pattern in @("downloads", "app.html", "landing.html", "icons")) {
    if ($ignore -contains $pattern) { Fail ".dockerignore excludes '$pattern', which the image needs" }
  }

  # 3. Stage the image contents only, so a missing COPY cannot hide behind the local folder.
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item (Join-Path $root "package.json"), (Join-Path $root "server.js"), (Join-Path $root "gemini-api.js"), (Join-Path $root "content-filter.js") -Destination $stage
  Copy-Item (Join-Path $root "app.html"), (Join-Path $root "landing.html"), (Join-Path $root "style.css"), (Join-Path $root "bootstrap.js"), (Join-Path $root "novacore-config.js"), (Join-Path $root "renderer.js"), (Join-Path $root "manifest.webmanifest"), (Join-Path $root "service-worker.js") -Destination $stage
  Copy-Item (Join-Path $root "icons") -Destination $stage -Recurse
  Copy-Item (Join-Path $root "downloads") -Destination $stage -Recurse

  # 4. Start it the way the container does: HOST=0.0.0.0, injected PORT, no browser.
  $env:HOST = "0.0.0.0"
  $env:PORT = "$port"
  $env:NOVACORE_TRUST_PROXY = "true"
  $stdout = Join-Path $stage "server.log"
  $proc = Start-Process -FilePath "node" -ArgumentList "server.js", "--no-open" -WorkingDirectory $stage -PassThru -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $stage "server.err.log")
  Start-Sleep -Seconds 3

  if ($proc.HasExited) {
    Fail "server.js exited during startup: $((Get-Content $stdout -ErrorAction SilentlyContinue) -join ' ')"
  } else {
    $base = "http://127.0.0.1:$port"

    # 5. Probe the routes the live URL is expected to serve.
    $health = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 10
    if ($health.StatusCode -ne 200) { Fail "GET /api/health returned $($health.StatusCode)" }
    if ($health.Content -notmatch '"provider"') { Fail "/api/health did not return the expected JSON" }

    $landing = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
    if ($landing.StatusCode -ne 200) { Fail "GET / returned $($landing.StatusCode)" }

    $app = Invoke-WebRequest -Uri "$base/index.html" -UseBasicParsing -TimeoutSec 10
    if ($app.StatusCode -ne 200) { Fail "GET /index.html returned $($app.StatusCode)" }

    $apk = Invoke-WebRequest -Uri "$base/app-debug.apk" -UseBasicParsing -TimeoutSec 10
    if ($apk.StatusCode -ne 200) { Fail "GET /app-debug.apk returned $($apk.StatusCode) (Android download button would 404)" }

    # The page served by this host must be allowed to call the API, exactly as a browser sends it:
    # same origin as the request's own Host (this is what a tunnel/host domain needs no config for).
    try {
      $allowed = Invoke-WebRequest -Uri "$base/api/search" -Method Post -UseBasicParsing -TimeoutSec 15 `
        -Headers @{ Origin = $base; "Content-Type" = "application/json" } `
        -Body '{"query":"novacore deployment check"}'
      if ($allowed.StatusCode -ne 200) { Fail "Same-origin /api/search returned $($allowed.StatusCode)" }
      elseif ($allowed.Headers["Access-Control-Allow-Origin"] -ne $base) { Fail "/api/search did not echo the same-origin Access-Control-Allow-Origin" }
    } catch {
      Fail "Same-origin /api/search failed with $($_.Exception.Response.StatusCode.value__); the served page could not search"
    }

    try {
      Invoke-WebRequest -Uri "$base/api/search" -Method Post -UseBasicParsing -TimeoutSec 10 `
        -Headers @{ Origin = "https://evil.example.com"; "Content-Type" = "application/json" } `
        -Body '{"query":"novacore deployment check"}' | Out-Null
      Fail "A cross-site origin was allowed to call /api/search"
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -ne 403) { Fail "Cross-site /api/search answered $($_.Exception.Response.StatusCode.value__), expected 403" }
    }
  }
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($failures.Count -gt 0) {
  Write-Output ""
  Write-Output "DEPLOY GATE FAILED:"
  $failures | ForEach-Object { Write-Output "  - $_" }
  Write-Output ""
  exit 1
}

Write-Output ""
Write-Output "DEPLOY GATE PASSED: the image contents start, serve the page, the APK, and enforce origins."
Write-Output "Next: commit and push, then deploy with render.yaml (see DEPLOYMENT.md section 1)."
exit 0
