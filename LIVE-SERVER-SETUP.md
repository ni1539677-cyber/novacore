# Live server requirement for the packaged apps

Both shipped clients (Windows `.exe`, Android `.apk`) load their page from `file://` and therefore
call the live API with `Origin: null`. The server only accepts that origin when
`NOVACORE_PUBLIC_ORIGIN` contains `null` (see `parseOriginList` / `allowedCorsOrigin` in
`server.js`). Without it, **every request from an installed app is answered with HTTP 403**:

```
FAIL  403  search, packaged app (Origin: null)
```

Measured on 2026-11-26 against `https://novacore-0ik3.onrender.com`; the same-origin page and the
plain downloads pass, so the service itself is up — only the packaged-app origin is refused.

## Fix (choose one)

1. **Render dashboard → the novacore service → Environment** — add

   ```
   NOVACORE_PUBLIC_ORIGIN = null
   ```

   and save. Render redeploys automatically (about a minute). No rebuild of the apps is needed:
   they already point at the right server; they were being refused, not misconfigured.

   If the page is also hosted somewhere else, comma-separate:
   `NOVACORE_PUBLIC_ORIGIN = null,https://your-site.example.com`

2. **From `render.yaml`** (blueprint deploys) — the file already sets it; a dashboard-created
   service does not read that file, so option 1 is the one that applies.

## Verify

```powershell
cd "c:\Users\user\OneDrive\Desktop\Nova Core"
node deploy-gate/live-verify.js
```

Exit code 0 and `PASS 200 search, packaged app (Origin: null)` means installed apps can reach the
API. If your hosting dashboard shows the variable but Render's log banner does not list it under
`Browser origins allowed to call the API:`, the service ran before the change — trigger a redeploy.

## What works without the fix

- The Android app's **search** (it queries DuckDuckGo from Java on the device).
- The Windows app's **search** (its main process queries DuckDuckGo itself).
- Both apps' local accounts, prompts and offline behaviour.
- **Gemini** in both apps fails, because that is a direct `/api/gemini` call to the live host.
