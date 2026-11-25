$ErrorActionPreference = "Stop"

$requiredVariables = @(
  "NOVACORE_ANDROID_KEYSTORE",
  "NOVACORE_ANDROID_STORE_PASSWORD",
  "NOVACORE_ANDROID_KEY_ALIAS",
  "NOVACORE_ANDROID_KEY_PASSWORD"
)

foreach ($name in $requiredVariables) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Set $name in this local PowerShell session before building a signed APK."
  }
}

if (-not (Test-Path -LiteralPath $env:NOVACORE_ANDROID_KEYSTORE -PathType Leaf)) {
  throw "The Android keystore path does not exist."
}

$gradleWrapper = Join-Path $PSScriptRoot "gradlew.bat"
$gradleCommand = $gradleWrapper
if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
  $installedGradle = Get-Command gradle -ErrorAction SilentlyContinue
  if (-not $installedGradle) {
    throw "Gradle 8.13 is required. Install Gradle or add the Android Gradle wrapper to this project."
  }
  $gradleCommand = $installedGradle.Source
}

Push-Location $PSScriptRoot
try {
  & $gradleCommand "assembleRelease"
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle failed to build the signed Android release."
  }
} finally {
  Pop-Location
}

$apk = Join-Path $PSScriptRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
  throw "The signed release APK was not created."
}

$downloadDirectory = Join-Path $PSScriptRoot "..\downloads"
$download = Join-Path $downloadDirectory "NovaCore-Android.apk"
New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
Copy-Item -LiteralPath $apk -Destination $download -Force
Write-Output "Signed Android APK ready: $download"
