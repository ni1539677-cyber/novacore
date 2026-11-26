# NovaCore local build environment (this machine)

Paths used to build the packaged clients on 2026-11-26. Nothing here is secret; secrets
(keystore passwords, API keys) stay in the environment, never in the repo.

## Android `.apk`

Nothing on the machine's `PATH` provides Java or the Android SDK, so both are pointed at the
toolchain installed under `%LOCALAPPDATA%\NovaCoreAndroidBuild`:

```powershell
$env:JAVA_HOME      = "C:\Users\user\AppData\Local\NovaCoreAndroidBuild\jdk\jdk-21.0.13+9"
$env:ANDROID_HOME   = "C:\Users\user\AppData\Local\NovaCoreAndroidBuild\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

cd "c:\Users\user\OneDrive\Desktop\Nova Core\android"
.\gradlew.bat assembleDebug --offline --console=plain
```

- `android/local.properties` already points `sdk.dir` at the same SDK (the file is git-ignored).
- `--offline` uses the Gradle cache (`~/.gradle`, `~/.m2`); drop it when dependencies change.
- Output: `android/app/build/outputs/apk/debug/app-debug.apk` (debug build, `applicationId`
  suffix `.debug`). Copy it to the served location:

  ```powershell
  Copy-Item .\app\build\outputs\apk\debug\app-debug.apk ..\downloads\NovaCore-Android-debug.apk -Force
  ```

- Release builds additionally need the four `NOVACORE_ANDROID_*` signing variables
  (`android/build-release.ps1` refuses to run without them).

## Windows `.exe`

```powershell
cd "c:\Users\user\OneDrive\Desktop\Nova Core"
npm install
npm run desktop:windows
```

- Output: `dist\NovaCore-Setup-1.0.0.exe` plus `dist\win-unpacked\` (`dist/` is git-ignored).
- Verify the API wiring that shipped inside the installer:

  ```powershell
  node verify-desktop-build.cjs
  ```

  It prints `asar files`, the `liveApiBaseUrl` / proxy paths baked into `renderer.js`, and checks
  that every relative `require()` in `desktop-main.js` is actually inside the asar.
- The installer is unsigned, so Windows SmartScreen warns on first run.
