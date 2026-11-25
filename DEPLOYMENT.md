# Deploying NovaCore

This is the operational guide: how to put `server.js` on a live server first, and later how to ship
the Windows `.exe` and the Android `.apk` that talk to that server. For product/architecture
details see [README.md](README.md).

Everything here assumes PowerShell on Windows (your current machine) and the project root:

```powershell
cd "c:\Users\user\OneDrive\Desktop\Nova Core"
```

---

## 0. How NovaCore decides whether a request is allowed

Understand this first; almost every deployment failure is an origin problem.

| Situation | Allowed automatically? |
| --- | --- |
| Server bound to `localhost` / `127.0.0.1` (the `npm start` default) | Only that device's own page |
| Server bound to `0.0.0.0` (a tunnel, container, VPS, Render/Fly/Railway) | Yes for the page served by that same server, on **any** domain |
| A different website calling your API | No, unless listed in `NOVACORE_PUBLIC_ORIGIN` |
| The packaged `.exe` / `.apk` (a `file://` page, origin `null`) | No, unless `NOVACORE_PUBLIC_ORIGIN` includes `null` |

When bound publicly, the server compares the browser's `Origin` with the request's own `Host`
header. That is why a tunnel (`https://abc.trycloudflare.com`) or a host domain
(`https://novacore-api.onrender.com`) needs no configuration, while another site is still refused.

---

## 1. Deploy `server.js` to a live server

Pick one option. **Option A is the fastest way to get a public URL today**; Option B is the one to
keep for real users.

### Option A — a public tunnel (no host account, no DNS)

Best for "I want a live link in the next five minutes". The tunnel is only up while your PC and the
tunnel process run.

1. Install `cloudflared` once:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

2. In one PowerShell window, start the server bound publicly:

   ```powershell
   $env:HOST = "0.0.0.0"
   $env:PORT = "3000"
   node server.js
   ```

   You should see `NovaCore server: https://your-server.example.com/` and
   `Listening on 0.0.0.0:3000 ...`. (The placeholder URL is cosmetic; set
   `$env:NOVACORE_PUBLIC_URL` to your tunnel URL to print the real one.)

3. In a second PowerShell window, start the tunnel:

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

   Copy the `https://<random-words>.trycloudflare.com` URL it prints. That is your live site:

   - `https://<tunnel>/` → the landing page (download buttons)
   - `https://<tunnel>/index.html` → the app
   - `https://<tunnel>/api/health` → JSON health check

4. Verify from a phone or another network: open the landing page and run one search. No origin
   configuration is needed for the page the server itself serves.

**Known limitation:** Cloudflare Quick Tunnels expose the URL through a proxy that may block the
server's outbound DuckDuckGo lookup, in which case searches show "DuckDuckGo could not return search
results". If that happens, use Option B — it is a real server with its own egress.

### Option B — a real host (recommended)

The repository already contains everything the platform needs: `Dockerfile`, `render.yaml`,
`.dockerignore`. No `node_modules` are required — the server uses only Node built-ins.

#### B0. Run the deployment preflight

Before pushing, prove the image is deployable (works without Docker — it stages exactly the files
`Dockerfile` ships and probes the live routes):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-check.ps1
```

It must end with `DEPLOY GATE PASSED`. If it reports a failure, fix that before deploying; this is
the same class of problem that would otherwise only appear in Render's build log.

#### B1. Put the code in a Git repository

Render/Railway/Fly deploy from Git, so this step is mandatory, and Git must be installed (it is
**not** on this machine yet):

```powershell
winget install --id Git.Git -e
```

Then open a new PowerShell window and, from the project root:

```powershell
git init -b main
git add .
git status --short
git commit -m "NovaCore: deployable server"
```

Check `git status` output before committing: `.env` must **not** appear. In the GitHub website
create an empty repository named `novacore` (no README, no .gitignore), then:

```powershell
git remote add origin https://github.com/<your-username>/novacore.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules/`, `dist/`, `android/**/build/` and the built
APK, so no secrets or 120 MB build output are committed.

#### B2. Deploy on Render (uses `render.yaml`)

1. Sign in at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, select the `novacore` repository, click **Apply**.
   Render reads `render.yaml`: it builds the `Dockerfile` and health-checks `/api/health`.
   When Render asks for `NOVACORE_GEMINI_API_KEY` (`sync: false`), leave it blank to run without a
   shared key; each user then supplies their own.
3. Wait for the first build, then open the URL Render shows,
   e.g. `https://novacore-api.onrender.com`. That URL is the live production URL — the service
   trusts the request's own Host, so no URL has to be configured anywhere.
4. Smoke-test it from your machine (replace the host):

   ```powershell
   $url = "https://novacore-api.onrender.com"
   (Invoke-WebRequest "$url/api/health" -UseBasicParsing).Content
   (Invoke-WebRequest "$url/" -UseBasicParsing).StatusCode
   (Invoke-WebRequest "$url/app-debug.apk" -UseBasicParsing -Method Head).StatusCode
   ```

   Expected: health JSON with `"provider":"DuckDuckGo"`, `200`, `200`.

Every later `git push` to `main` redeploys automatically.

Checklist after the first deploy:

| Check | Expected |
| --- | --- |
| `https://<your-url>/` | Landing page with the two download buttons |
| `https://<your-url>/index.html` | The NovaCore app |
| `https://<your-url>/api/health` | `{"provider":"DuckDuckGo","requiresApiKey":false,...}` |
| Sign up, then run one search | Live web + image results |

Notes for the Render free plan: the service sleeps after ~15 minutes without traffic, so the first
request afterwards takes 30–60 s. Upgrade to a paid instance for always-on use.

#### B3. Environment variables (dashboard → Environment)

All are optional now that the server derives its origin from the request.

| Variable | When you need it |
| --- | --- |
| `NOVACORE_GEMINI_API_KEY` | Users should get Gemini answers without saving their own key. It is billed to your key — set a budget alert in Google AI Studio. |
| `NOVACORE_PUBLIC_ORIGIN` | Only for callers on another origin. Add `null` for the packaged `.exe`/`.apk`; add `https://your-other-site.com` if you host the page elsewhere. Comma-separate several. |
| `NOVACORE_TRUST_PROXY` | `true` on Render (already set in `render.yaml`) so rate limits are per client, not per proxy. |
| `NOVACORE_PUBLIC_URL` | Cosmetic: the URL printed in the startup log. |

#### B4. Other hosts

- **Railway / Fly.io / any VPS:** deploy the repository; it builds `Dockerfile`. Set `HOST=0.0.0.0`
  (already in the image) and let the platform inject `PORT`. For a VPS without Docker:

  ```bash
  HOST=0.0.0.0 PORT=3000 node server.js
  ```

  then put nginx/Caddy in front for TLS.
- **Vercel:** `api/_proxy.js` + `api/search.js` / `api/gemini.js` / `api/health.js` expose the same
  API as serverless functions (`vercel.json` sets a 30 s limit). Vercel only serves these functions
  from its own domain, so open the app from the Vercel URL.

### Option C — test the same deployment on your own machine (needs Docker)

If you install Docker Desktop you can prove the container works before renting a host:

```powershell
docker build -t novacore .
docker run --rm -p 3000:3000 -e NOVACORE_PUBLIC_URL=http://localhost:3000 novacore
```

Docker is **not** currently installed on this machine, so this step is optional.

---

## 2. Make the apps use the live server (instead of localhost)

The desktop and Android builds load their page from disk (`file://`), where `/api/...` does not
exist. They therefore need an absolute API origin in `novacore-config.js`:

```js
window.NOVACORE_API_BASE = "https://novacore-api.onrender.com";
```

Rules:

- Use `https://` — a `file://` page calling `http://` is blocked as mixed content.
- Leave it empty **only** for the browser version served by the same server.
- Whenever it is set, the server must also allow the packaged origin:
  `NOVACORE_PUBLIC_ORIGIN=null` (a `file://` page sends `Origin: null`).
- `novacore-config.js` is also used by `npm start` and the Docker image, so keep a copy of the empty
  version (or set your production value last, right before building) if you still run locally.

`desktop-main.js` and `android/app/build.gradle` copy the file in as-is, so edit it **before**
building.

---

## 3. Build the Windows `.exe`

On Windows (this machine):

```powershell
npm install
npm run desktop:windows
```

Output: `dist/NovaCore-Setup-1.0.0.exe` — a per-user NSIS installer, Start-menu and desktop
shortcuts, no separate Node.js needed.

What to verify before shipping:

1. Double-click the installer, launch NovaCore.
2. Create an account, run one search, ask Gemini one question.
3. The desktop app runs the DuckDuckGo client in its own main process (`desktop-main.js`), so search
   works **without** any server; Gemini needs a key saved in **Gemini AI settings** (stored encrypted
   with the OS keychain).

The installer is unsigned, so Windows SmartScreen will warn users ("Unknown publisher"). For public
distribution you need a code-signing certificate; without one, expect that warning.

The landing page serves this file at `/app-setup.exe` and `/downloads/NovaCore-Setup-1.0.0.exe`
**only if `dist/` exists next to `server.js`**. A deployed container does not ship it, so put the
installer on a release page (GitHub Releases, Google Drive, S3) and point the landing page there for
public downloads.

---

## 4. Build the Android `.apk`

Prerequisites: JDK 17+, Android SDK platform/build-tools 35. The Gradle wrapper is in `android/`.

**Debug APK** (fastest, for testing; `applicationId` suffix `.debug`):

```powershell
cd android
.\gradlew.bat assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the folder the server serves:

```powershell
Copy-Item .\app\build\outputs\apk\debug\app-debug.apk ..\downloads\NovaCore-Android-debug.apk -Force
```

That is the file behind `/app-debug.apk`. `Dockerfile` copies `downloads/` into the image, so after
rebuilding the APK commit the new file and push — Render then redeploys with the fresh download:

```powershell
git add downloads/NovaCore-Android-debug.apk
git commit -m "APK: rebuild"
git push
```

**Release APK** (signed, for real users):

```powershell
# create a keystore once, then keep it and its passwords safe and backed up
keytool -genkeypair -v -keystore novacore-release.jks -alias novacore -keyalg RSA -keysize 2048 -validity 10000

$env:NOVACORE_ANDROID_KEYSTORE = "C:\path\to\novacore-release.jks"
$env:NOVACORE_ANDROID_STORE_PASSWORD = "..."
$env:NOVACORE_ANDROID_KEY_ALIAS = "novacore"
$env:NOVACORE_ANDROID_KEY_PASSWORD = "..."

cd "c:\Users\user\OneDrive\Desktop\Nova Core"
.\android\build-release.ps1
```

The script fails fast if signing details are missing, builds the signed release, and copies it to
`downloads/NovaCore-Android.apk` (served at `/downloads/NovaCore-Android.apk`). Losing the keystore
means you can never update the same app identity again.

**How the APK reaches your server:** Gradle's `prepareNovaCoreWebAssets` task copies `app.html` →
`index.html`, `renderer.js`, `novacore-config.js`, `style.css` and the rest from the project root
into `android/app/src/main/assets/` on every build, and injects `connect-src` rules. So the value in
`novacore-config.js` at build time is what ships. The packaged page's CSP allows `https:` connections,
which covers your hosted API.

---

## 5. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every search returns 403 `only from approved NovaCore origins` | The page's origin is not trusted. Served by this same server → make sure `HOST=0.0.0.0` (public bind). Served elsewhere or packaged → add its origin to `NOVACORE_PUBLIC_ORIGIN`. |
| `Browser origins allowed to call the API: https://your-site.example.com` in the log but still a 403 | That literal placeholder never matches. Remove it, or set your real URL. |
| App loads, but the landing page's download buttons 404 | The VPS/container has no `dist/` or `downloads/` build. The Windows installer path (`dist/`) is not shipped in the image by design — publish it as a GitHub Release. The Android APK **is** shipped; if it 404s, `downloads/NovaCore-Android-debug.apk` is missing or not committed. |
| Render build log: `COPY downloads: no such file or directory` | `downloads/` is empty or was not pushed to Git. Commit `downloads/NovaCore-Android-debug.apk` and push. |
| "Live search needs a reachable NovaCore server at a local NovaCore server" | The packaged app has an empty `NOVACORE_API_BASE` and its IPC search is unavailable. Set the absolute API origin and rebuild. |
| "Could not reach NovaCore's search service at https://..." | Wrong URL, server asleep (free tier), or `NOVACORE_PUBLIC_ORIGIN` does not include `null` for a packaged app. |
| First request after idle takes ~1 minute | Render free tier waking up. Use a paid instance or an uptime pinger. |
| `NovaCore server: http://localhost:3000/` while testing from a phone | `HOST` was not set; the server is not reachable from other devices. Restart with `$env:HOST = "0.0.0.0"`. |
| Port already in use | Another copy is running. Stop it, or set `$env:PORT` to a free port. |
| `ERR_CONNECTION_REFUSED` on the tunnel URL | The server was not started, or the tunnel points at a different port than `PORT`. |

Run the automated checks any time you change deployment code:

```powershell
npm run check
npm run test
```
