# NovaCore

NovaCore is served by a small Node.js process. Live web and image searches use DuckDuckGo through that proxy; no paid search API key or third-party package is required. It runs locally by default and can also be deployed publicly so the app works anywhere without a running PC — see [Deploy NovaCore publicly](#deploy-novacore-publicly).

## Install on desktop and mobile

NovaCore includes a PWA manifest, platform icons, and a small service worker. It caches the app shell for offline use and does not cache API responses. Serve the app from `localhost` or a trusted HTTPS origin; browsers do not allow PWA installation from ordinary insecure HTTP pages. Use the browser's **Install app** prompt where available, or its **Add to Home Screen** action on iOS. Account data remains local to each browser/device and does not sync.

The standalone product landing page is served at the root (`http://localhost:3000/`) and as `landing.html` while the local server is running; the app itself is at `/index.html` and `/app.html`. The landing page's Windows button downloads the NSIS installer at `dist/`, and its Android button downloads the debug APK from `downloads/`. If those builds do not exist yet, the buttons answer a clear "not built yet" notice. For a deployed instance, upload the installer and APK alongside the server (or link a release page). The debug APK is intended for testing, not production distribution.

## Android app package

The native Android WebView project is in `android/`. It packages the existing NovaCore web app locally and uses application ID `com.novacore.mobile`. Install JDK 17+, Gradle 8.13, and Android SDK platform/build tools 35, then build a release APK from the project root:

```powershell
cd android
.\gradlew.bat assembleRelease
```

Release signing is deliberately not stored in the repository. Set these environment variables locally to an existing production keystore before building: `NOVACORE_ANDROID_KEYSTORE` (absolute keystore path), `NOVACORE_ANDROID_STORE_PASSWORD`, `NOVACORE_ANDROID_KEY_ALIAS`, and `NOVACORE_ANDROID_KEY_PASSWORD`. Keep the keystore and passwords private and backed up; losing them prevents publishing updates under the same app identity. From the project root, run `.\android\build-release.ps1`; it rejects missing signing details, builds the signed release, and copies it to `downloads/NovaCore-Android.apk`. The landing page currently links to the debug APK for testing; replace it with a production-signed package before public distribution.

The packaged assistant and local accounts work offline on-device. Live web search and server diagnostics require the Node service and are not available from the standalone Android asset bundle.

The Node server binds to `localhost` unless you configure hosting (below). For a PWA served to other devices, deploy the static app over HTTPS and point it at a hosted `/api/search` proxy; the offline assistant works without that API.

## Deploy NovaCore publicly

With no environment variables, NovaCore behaves exactly as before: it listens on `localhost:3000` and only this device's own page may call the API. Step-by-step instructions for going live, then building the `.exe` and `.apk`, are in [DEPLOYMENT.md](DEPLOYMENT.md). Two deployment shapes are supported.

### Option A — one server hosts the page and the API (recommended)

Static hosting services cannot run this backend: `/api/search` parses live HTML from DuckDuckGo, and Vercel/Netlify-style static sites have no long-lived process. Host the Node server somewhere that runs a container, and it serves the page *and* the API from one origin.

When the server binds a public address (`HOST=0.0.0.0`), it trusts the request's own `Host` header, so the page works on whatever domain reaches it — a tunnel, a container's published port, or a host domain — with no origin configuration. Another site's page is still refused.

| Host | How |
| --- | --- |
| **Render** | Push the repo, then **New → Blueprint** and select `render.yaml`. Free tier sleeps after inactivity, so the first search can take ~30–60 s to wake. |
| **Fly.io / Railway / any VPS** | Build `Dockerfile`; set the variables below. |
| **Any machine with Node 18+** | `HOST=0.0.0.0 npm start` behind a reverse proxy, or a `cloudflared` tunnel for a quick public URL. |

```powershell
docker build -t novacore-api .
docker run -p 3000:3000 -e NOVACORE_PUBLIC_URL=http://localhost:3000 novacore-api
```

### Option B — static page + serverless API (Vercel)

Deploy the repo to Vercel. `api/search.js`, `api/gemini.js`, and `api/health.js` are serverless functions that reuse the same handlers as `server.js` (validation, content filter, CORS, rate limiting), so behaviour does not drift. Because `api/search.js` occupies `/api/search` in a Vercel deployment, the page must be served by Vercel too. If you host the page elsewhere, use a proxy rewrite to `/api/*` or deploy Option A.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NOVACORE_PUBLIC_ORIGIN` | Comma-separated *extra* origins allowed to call the API. Only needed for callers on a different origin: another site hosting the page, or the packaged `.exe`/`.apk` (a `file://` page sends `Origin: null`, so list `null`). The page served by this same server needs no entry. |
| `NOVACORE_TRUST_PROXY` | `true` behind Render/Fly/Vercel/reverse proxies, so the rate limit keys off the real client instead of the proxy. |
| `HOST` / `PORT` | Bind address and port. Use `HOST=0.0.0.0` in containers; most hosts inject `PORT`. |
| `NOVACORE_PUBLIC_URL` | Optional. The URL printed in the startup banner (e.g. your tunnel or host URL). Cosmetic only. |
| `NOVACORE_GEMINI_API_KEY` | Optional. Supplying a server-side Gemini key lets every user get answers without saving their own. Each request still travels through your key and your quota — set a budget alert. Without it, each user enters their own key, as today. |

See `.env.example`; a local `.env` is read on startup for any variable that is not already set, so hosting environment variables always win. Request origin checks stay strict: an origin that is neither this server's own page nor listed in `NOVACORE_PUBLIC_ORIGIN` is rejected with HTTP 403, and CORS headers are only emitted for approved origins.

### Pointing the app at a remote API

Edit `novacore-config.js` and set the API origin (needed by the packaged desktop and Android builds, whose page loads from disk):

```js
window.NOVACORE_API_BASE = "https://novacore-api.onrender.com";
```

Leave it empty when the page and API share an origin. When it is set, also allow the packaged origin on the server with `NOVACORE_PUBLIC_ORIGIN=null`. This file is a classic script loaded before `renderer.js` (an inline script would be blocked by the content security policy), and it is included in the desktop, Docker, and Android builds. The Gemini key header and request bodies are unchanged, so existing users keep working without action.

### Operational notes

- **DuckDuckGo may rate-limit or challenge datacenter IPs.** The proxy already detects the challenge page and returns a clear error instead of stale results; if it happens consistently on your host, use a different egress IP or a dedicated search API. It was verified working from a residential connection only, not from your production host — check `/api/health` and one search after deploying.
- The API applies strict SafeSearch (`kp=1`) and the shared adult-content filter before sending and after parsing. This is a best-effort safeguard, not a guarantee about remote content.
- Per-IP rate limits are in-memory, so they are per instance and reset on restart. For larger deployments, put limits at the edge or add a shared store.
- Searches and prompts still leave the device and reach DuckDuckGo / Google Gemini. Update your privacy wording if you operate a public instance.
- `server.js` trusts the request's own origin when bound publicly (`HOST=0.0.0.0`), but it still refuses browser origins you have not configured for cross-site callers. Keep `NOVACORE_PUBLIC_ORIGIN` narrow.
- **Before packaging for a release**, set `novacore-config.js` to your production API if the app is not shipped alongside it, and rebuild. The desktop and Android builds copy that file as-is.

### Hosted smoke test (verified)

The production build was exercised with the page served from one origin (`localhost:5100`) and the API from another (`localhost:3000`) using `NOVACORE_PUBLIC_ORIGIN=http://localhost:5100`:

| Check | Result |
| --- | --- |
| Page loads and `NOVACORE_API_BASE` is read | pass |
| Account creation, then reload keeps the user signed in | pass |
| Live cross-origin search | pass — 8 web results, 8 image cards, no CORS/CSP errors |
| Application diagnostics | pass — reports the configured API origin; Gemini flagged until a key is saved |
| Gemini without a key asks the user to add one | pass |
| Sign out, then sign in again | pass |
| Console errors / failed API requests | none |

## Desktop app builds

The Electron wrapper starts the existing local Node service and opens NovaCore in a hardened, context-isolated desktop window. It does not expose Node integration to page content.

```powershell
npm install
npm run desktop
npm run desktop:pack
npm run desktop:dist
npm run desktop:windows
```

`desktop:pack` creates an unpacked test build; `desktop:dist` creates the current platform's installer (Windows NSIS, macOS DMG, or Linux AppImage). On Windows, `desktop:windows` creates a self-contained per-user NSIS installer at `dist/NovaCore-Setup-<version>.exe`, with Start menu and desktop shortcuts; no separate Node.js installation is needed. Build each release on its target operating system. Code signing and platform-specific distribution credentials are not configured. Electron adds a larger download than a browser-installed PWA, but reuses the existing Node backend without a separate server installation.

## Offline assistant

NovaCore's assistant responds immediately with built-in templates in the browser. It includes a short, fixed-form story sample and a chapter-outline template for story/novel prompts in English and Bengali, alongside categorized guidance and code starters. Bengali prompts receive curated Bengali responses for supported intents. This is deterministic composition, not a language model: it does not produce arbitrary or reliably fluent prose, a complete novel, or open-ended detailed answers, and other languages are not translated. No local model, paid API, or hosted AI service is used. Treat code suggestions as starting points and review them; NovaCore does not execute generated code or edit project files automatically.

The optional voice controls use the browser's Web Speech APIs when supported. Choose Bengali, English, or the device's default speech language. Speech recognition support, language availability, and whether audio is processed locally or by a browser-provided service depend on the browser and device; microphone access is requested only when you choose **Use voice**. Text-to-speech also depends on installed browser/device voices. Typing and reading the on-screen response remain available when speech features are missing.

## Local accounts and settings

Guest access is not available. Create an account or sign in with an ID already stored in this browser. Account records and per-account settings (including voice language and Evolution Watch state) are stored in IndexedDB on this device. Passwords are never stored in plaintext: NovaCore stores a random salt and a PBKDF2-SHA-256 hash. Existing account hashes in the previous local-storage format are migrated to IndexedDB on startup, then the old copy is removed.

This is a local profile, not a server-authenticated account: it does not sync or provide password recovery, and clearing browser/site data removes the account. IndexedDB is not itself encrypted; anyone with access to this browser profile or device may be able to inspect or alter local data. Keep your device and browser profile protected. Workspace drafts and tabs remain temporary to the browser session.

The main workspace keeps the assistant, optional web search, and quick-start actions visible. The simulated developer feed, pasted-source lab, and Evolution Watch diagnostics are hidden from the normal workspace view.

## Local diagnostics and updates

Evolution Watch periodically checks UI/device signals and, while signed in, runs a local read-only diagnostics scan on startup and every five minutes. It checks JavaScript syntax with the installed Node.js runtime, required app files, key feature markers, and total source size. The scan uses only built-in tools and inspects a fixed list of this app's files; it does not upload source, execute project code, install dependencies, or modify application files.

The scan can display diagnostic suggestions, but it does not automatically repair code or self-update the application. This browser-only app has no trusted update source or rollback mechanism. Its existing UI adjustment is limited to predefined CSS values, shown for review before application. Apply source changes through a deliberate, reviewed development update.

## Enable live web and image search

1. Start NovaCore from this folder:

   ```powershell
   npm start
   ```

2. `npm start` serves the landing page at `http://localhost:3000/` and the app at `/index.html`, then opens it in your default browser. Strict SafeSearch is always requested, and NovaCore blocks searches matching its built-in adult/explicit term filter both before sending and at the local proxy. This filter is a best-effort safeguard, not a guarantee about all remote content; search results and image thumbnails still come from DuckDuckGo and their source websites. Do not search for confidential information unless you are comfortable sharing it with those services.

By default NovaCore binds only to `localhost:3000`, and only that origin may call the API. Start it with `HOST=0.0.0.0` (or set `HOST` in `.env`) to let a tunnel, reverse proxy, or another device reach it; the optional hosted settings are listed in [Environment variables](#environment-variables). The proxy validates result URLs, limits request size and rate, and does not log query text. DuckDuckGo may temporarily rate-limit or require human verification; NovaCore displays that error rather than showing sample or stale results.

## Gemini AI proxy

The assistant sends prompts to the same local server at `POST /api/gemini`. The renderer passes the Google Gemini API key in an `X-Goog-Api-Key` request header, the server never stores or logs it, and the reply returns the answer text plus its Google Search grounding sources. In the Electron desktop app the key stays in the main process (encrypted with the OS keychain) and is called directly; the desktop window also runs DuckDuckGo searches through an IPC handler instead of the HTTP proxy because it loads `app.html` from disk. Requests carry no key in URLs, the server keeps a per-minute rate limit, and provider errors are redacted before they reach the page. If the server is started with `NOVACORE_GEMINI_API_KEY`, that key is used for every request and users do not need to supply one; `/api/health` reports `keySource: "server"` (never the key itself).
