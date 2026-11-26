const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const vm = require("node:vm");
const contentFilter = require("./content-filter");
const { generateGeminiResponse } = require("./gemini-api");

// A local .env is read only when a variable is not already set, so real hosting environment
// variables always win. No dependency is needed: `KEY=value` lines, optional quotes/comments.
loadEnvFile(path.join(__dirname, ".env"));

const host = "localhost";
const port = 3000;
const appUrl = `http://${host}:${port}/`;
const shouldOpenBrowser = !process.argv.includes("--no-open");

// Deployment configuration. Everything is optional: with no environment variables NovaCore keeps
// binding to localhost only, exactly as before.
//   PORT                  port to listen on (most hosts inject this)
//   HOST                  interface to bind (default localhost; use 0.0.0.0 in a container)
//   NOVACORE_PUBLIC_ORIGIN comma-separated list of extra browser origins allowed to call the API,
//                          e.g. https://novacore.example.com or a capacitor:// mobile app origin
//   NOVACORE_TRUST_PROXY  set to "true" behind a platform proxy so rate limits key off the client IP
//   NOVACORE_GEMINI_API_KEY
//                         optional shared Gemini key, so end users do not need their own
const deployedPort = Number.parseInt(process.env.PORT ?? "", 10);
const deployedHost = (process.env.HOST || host).trim();
const publicOrigins = parseOriginList(process.env.NOVACORE_PUBLIC_ORIGIN);
const trustProxy = process.env.NOVACORE_TRUST_PROXY === "true";
const serverGeminiApiKey = (process.env.NOVACORE_GEMINI_API_KEY || "").trim();
// A loopback bind means "this device only", so the page's own origin is trusted. A public bind
// (0.0.0.0, ::, or a real address) is reached through a tunnel, container port map, or reverse
// proxy, where the browser's Origin never equals the socket's local host:port. Trusting the
// request's own Host header there keeps same-origin use working on any domain without
// hard-coding it, while cross-site callers still need NOVACORE_PUBLIC_ORIGIN.
const loopbackTargets = ["localhost", "127.0.0.1", "::1"];
const allowLocalOrigin = loopbackTargets.includes(deployedHost) || deployedHost === "0.0.0.0" || deployedHost === "::" ||
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(deployedHost);
const isPubliclyBound = isPublicBindAddress(deployedHost);
const requestTimeoutMs = 10_000;
const maxRequestBytes = 24_000;
const maxResults = 8;
const geminiModel = "gemini-2.5-flash";
const maxPromptLength = 4000;
const maxApiKeyLength = 512;
const rateWindowMs = 60_000;
const rateLimit = 30;
const rateBuckets = new Map();
const diagnosticFiles = ["server.js", "renderer.js", "bootstrap.js", "content-filter.js", "gemini-api.js", "duckduckgo-search.js", "Dockerfile", ".dockerignore", "index.html", "app.html", "landing.html", "style.css"];
const staticFiles = new Map([
  // The root and /landing.html are the product landing page (download buttons + "Enter NovaCore");
  // the app itself lives at /index.html and /app.html. Packaged Android builds load index.html.
  ["/", ["landing.html", "text/html; charset=utf-8"]],
  ["/index.html", ["app.html", "text/html; charset=utf-8"]],
  ["/app.html", ["app.html", "text/html; charset=utf-8"]],
  ["/landing.html", ["landing.html", "text/html; charset=utf-8"]],
  ["/bootstrap.js", ["bootstrap.js", "text/javascript; charset=utf-8"]],
  ["/novacore-config.js", ["novacore-config.js", "text/javascript; charset=utf-8"]],
  ["/content-filter.js", ["content-filter.js", "text/javascript; charset=utf-8"]],
  ["/gemini-api.js", ["gemini-api.js", "text/javascript; charset=utf-8"]],
  ["/renderer.js", ["renderer.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/icons/icon-192.png", ["icons/icon-192.png", "image/png"]],
  ["/icons/icon-512.png", ["icons/icon-512.png", "image/png"]],
  ["/icons/apple-touch-icon.png", ["icons/apple-touch-icon.png", "image/png"]],
  // Browsers request this automatically; answering it avoids a 404 on every page load.
  ["/favicon.ico", ["icons/icon.ico", "image/x-icon"]],
  // Downloads are committed build outputs; the Dockerfile copies them so the hosted site can serve
  // them. A missing file answers 404 "not built yet" in the UI, never a broken partial download.
  ["/app-setup.exe", ["dist/NovaCore-Setup-1.0.0.exe", "application/octet-stream", "attachment; filename=\"app-setup.exe\""]],
  ["/app-debug.apk", ["downloads/app-debug.apk", "application/vnd.android.package-archive", "attachment; filename=\"app-debug.apk\""]],
  ["/downloads/app-setup.exe", ["dist/NovaCore-Setup-1.0.0.exe", "application/octet-stream", "attachment; filename=\"app-setup.exe\""]],
  ["/downloads/NovaCore-Setup-1.0.0.exe", ["dist/NovaCore-Setup-1.0.0.exe", "application/octet-stream", "attachment; filename=\"NovaCore-Setup-1.0.0.exe\""]],
  ["/downloads/app-debug.apk", ["downloads/app-debug.apk", "application/vnd.android.package-archive", "attachment; filename=\"app-debug.apk\""]],
  ["/downloads/NovaCore-Android-debug.apk", ["downloads/NovaCore-Android-debug.apk", "application/vnd.android.package-archive", "attachment; filename=\"NovaCore-Android-debug.apk\""]],
  ["/downloads/NovaCore-Android.apk", ["downloads/NovaCore-Android.apk", "application/vnd.android.package-archive", "attachment; filename=\"NovaCore-Android.apk\""]],
  // The web installer is a small stub that downloads its payload (see build-windows-installer.ps1),
  // so both files must be reachable and served as binary downloads by the same host.
  ["/downloads/novacore-local-search-1.0.0-x64.nsis.7z", ["dist/novacore-local-search-1.0.0-x64.nsis.7z", "application/octet-stream"]],
  ["/dist/novacore-local-search-1.0.0-x64.nsis.7z", ["dist/novacore-local-search-1.0.0-x64.nsis.7z", "application/octet-stream"]],
  ["/latest.yml", ["dist/latest.yml", "text/yaml; charset=utf-8"]],
]);
// The api/ folder holds the Vercel serverless adapters. A hosted gateway may send /api/* requests
// here, so this server answers them itself instead of letting static hosting expose the files.
const serverlessAdapterNames = new Set(["search.js", "gemini.js", "health.js", "_proxy.js"]);

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  const allowedOrigin = allowedCorsOrigin(request);
  if (allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Vary", "Origin");
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Goog-Api-Key");
    response.setHeader("Access-Control-Max-Age", "600");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
  }

  if (!isAllowedRequest(request, requestUrl)) {
    sendJson(response, 403, { error: "This NovaCore API accepts requests only from approved NovaCore origins." });
    return;
  }

  // GET and HEAD both answer: platform health checks and monitoring tools often probe with HEAD.
  if (requestUrl.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    sendJson(response, 200, {
      provider: "DuckDuckGo",
      requiresApiKey: false,
      gemini: {
        route: "/api/gemini",
        model: geminiModel,
        requiresApiKey: !serverGeminiApiKey,
        keySource: serverGeminiApiKey ? "server" : "client",
      },
    });
    return;
  }

  if (requestUrl.pathname === "/api/diagnostics" && request.method === "GET") {
    try {
      sendJson(response, 200, await runLocalDiagnostics());
    } catch (error) {
      console.error("Local diagnostics failed:", error instanceof Error ? error.message : "Unknown error");
      sendJson(response, 500, { error: "NovaCore could not complete its local diagnostics." });
    }
    return;
  }

  if (requestUrl.pathname === "/api/gemini" && request.method === "POST") {
    try {
      await handleGemini(request, response);
    } catch (error) {
      console.error("Gemini proxy request failed:", error instanceof Error ? error.message : "Unknown error");
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, 502, { error: "NovaCore could not complete the Gemini request. Check the local server and try again." });
      }
    }
    return;
  }

  if (requestUrl.pathname === "/api/search" && request.method === "POST") {
    try {
      await handleSearch(request, response);
    } catch (error) {
      console.error("Search proxy request failed:", error instanceof Error ? error.message : "Unknown error");
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, 502, { error: "NovaCore could not complete the search request. Check the local server and try again." });
      }
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "NovaCore API route not found." });
    return;
  }

  if (serverlessAdapterNames.has(requestUrl.pathname.replace(/^\/+/, ""))) {
    sendJson(response, 404, { error: "NovaCore API route not found." });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const file = staticFiles.get(requestUrl.pathname);
  if (!file) {
    sendJson(response, 404, { error: "Page not found." });
    return;
  }
  const filePath = path.join(__dirname, file[0]);
  if (file[2]) {
    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) {
        // EACCES means the file shipped with unreadable permissions (a 0600 copy under `USER node`);
        // a bug report of "File wasn't available on site" is useless, so name the real cause.
        console.error(`Download ${requestUrl.pathname} unreadable (${error.code}) from ${file[0]}.`);
        sendJson(response, 404, { error: "This NovaCore download is not available in this deployment." });
        return;
      }
      console.error("NovaCore download file could not be read:", error instanceof Error ? error.message : "Unknown error");
      sendJson(response, 500, { error: "The NovaCore download is unavailable." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": file[1],
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "Content-Disposition": file[2],
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const installer = fs.createReadStream(filePath);
    installer.on("error", (error) => {
      console.error("Installer download failed:", error instanceof Error ? error.message : "Unknown error");
      if (response.headersSent) {
        response.destroy();
        return;
      }
      // The stream failed before any bytes went out: answer cleanly instead of closing the socket.
      sendJson(response, 404, { error: "This NovaCore download is not available in this deployment." });
    });
    installer.pipe(response);
    return;
  }

  const body = fs.readFileSync(filePath);
  const headers = {
    "Content-Type": file[1],
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  };
  if (file[2]) headers["Content-Disposition"] = file[2];
  response.writeHead(200, headers);
  response.end(request.method === "HEAD" ? undefined : body);
});

function checkJavaScriptSyntax(file, source) {
  try {
    new vm.Script(source, { filename: file });
    return {
      name: `${file} syntax`,
      status: "pass",
      detail: "The bundled JavaScript parsed without syntax errors.",
    };
  } catch (error) {
    return {
      name: `${file} syntax`,
      status: "fail",
      detail: error instanceof Error ? error.message : "The JavaScript syntax check failed.",
    };
  }
}

async function runLocalDiagnostics() {
  const contents = new Map();
  const checks = [];
  for (const file of diagnosticFiles) {
    try {
      contents.set(file, await fs.promises.readFile(path.join(__dirname, file), "utf8"));
      checks.push({ name: `${file} present`, status: "pass", detail: "Required local application file is available." });
    } catch {
      checks.push({ name: `${file} present`, status: "fail", detail: "Required local application file is missing or unreadable." });
    }
  }

  const javascriptFiles = ["server.js", "renderer.js", "bootstrap.js", "content-filter.js"];
  const syntaxChecks = javascriptFiles.map((file) => {
    if (!contents.has(file)) {
      return { name: `${file} syntax`, status: "fail", detail: "Syntax could not be checked because the file is unavailable." };
    }
    return checkJavaScriptSyntax(file, contents.get(file));
  });
  checks.push(...syntaxChecks);

  const renderer = contents.get("renderer.js") || "";
  const filterSource = contents.get("content-filter.js") || "";
  const html = contents.get("app.html") || "";
  const serverSource = contents.get("server.js") || "";
  const requiredFeatures = [
    {
      name: "Local account storage",
      present: renderer.includes("indexedDB.open") && renderer.includes("PBKDF2"),
      detail: "IndexedDB and salted password hashing are wired into the local account flow.",
      suggestion: "Restore the IndexedDB account flow and PBKDF2 password hashing.",
    },
    {
      name: "Offline assistant",
      present: renderer.includes("buildLocalResponse") && html.includes('id="prompt-form"'),
      detail: "The local prompt form and offline response generator are available.",
      suggestion: "Restore the local prompt form and offline response generator.",
    },
    {
      name: "Strict search SafeSearch",
      present: filterSource.includes("containsBlockedTerm") &&
        renderer.includes("containsBlockedTerm") &&
        serverSource.includes('searchParams.set("kp", "1")') &&
        html.includes('src="content-filter.js"'),
      detail: "The shared adult-content filter and strict DuckDuckGo SafeSearch are wired into the browser and local proxy.",
      suggestion: "Restore the shared search content filter and strict SafeSearch request parameters.",
    },
    {
      name: "Reviewed local tune",
      present: renderer.includes("applyReviewedEvolutionProposal") &&
        renderer.includes("evolutionPresets") &&
        html.includes('id="evolution-review-dialog"'),
      detail: "UI tuning is limited to predefined values and an explicit review dialog.",
      suggestion: "Keep local UI updates behind the predefined review dialog.",
    },
    {
      name: "Gemini server proxy",
      present: serverSource.includes('requestUrl.pathname === "/api/gemini"') &&
        serverSource.includes("generateGeminiResponse") &&
        renderer.includes('fetch("/api/gemini"'),
      detail: "The local server forwards prompts to Gemini with the API key supplied by the client and returns the answer with its grounding sources.",
      suggestion: "Restore the /api/gemini proxy route and the renderer's Gemini fetch call.",
    },
    {
      name: "DuckDuckGo live search wiring",
      present: serverSource.includes('requestUrl.pathname === "/api/search"') &&
        renderer.includes('fetch("/api/search"') &&
        html.includes('id="workspace-search-form"'),
      detail: "The search bar submits to the local /api/search proxy and renders web and image results without a paid API key.",
      suggestion: "Restore the /api/search proxy route and the search-bar fetch call.",
    },
    {
      name: "No dynamic script execution",
      present: /script-src 'self'/.test(serverSource) &&
        !serverSource.includes(["unsafe", "eval"].join("-")),
      detail: "The local content policy does not enable eval-based script execution.",
      suggestion: "Remove dynamic script execution and keep the restrictive content policy.",
    },
  ];
  const suggestions = [];
  for (const feature of requiredFeatures) {
    checks.push({
      name: feature.name,
      status: feature.present ? "pass" : "fail",
      detail: feature.present ? feature.detail : "Expected implementation markers were not found in the local source.",
    });
    if (!feature.present) suggestions.push(feature.suggestion);
  }

  const totalSourceBytes = diagnosticFiles.reduce((sum, file) => {
    const content = contents.get(file);
    return sum + (content ? Buffer.byteLength(content, "utf8") : 0);
  }, 0);
  if (totalSourceBytes > 250_000) {
    suggestions.push("Review large bundled assets and remove unused code before adding dependencies.");
  }
  if (suggestions.length === 0) {
    suggestions.push("No required features are missing. Keep dependencies minimal and review proposed changes before applying them.");
  }
  return {
    generatedAt: new Date().toISOString(),
    checks,
    suggestions,
    footprint: { checkedFiles: contents.size, sourceBytes: totalSourceBytes },
  };
}

function setSecurityHeaders(response) {
  // The page may be hosted separately from this API (static hosting + this proxy), so the
  // configured API origin is allowed for connections and, for inline stylesheets only, as a frame.
  const apiOrigins = [...publicOrigins];
  // A packaged app (Electron/Android file:// page) is not a URL origin, so it is only allowed
  // for connections and inline stylesheets, never as a script source or frame ancestor.
  const packagedApp = apiOrigins.includes("null");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    (apiOrigins.filter((origin) => origin !== "null").length
      ? `frame-ancestors 'self' ${apiOrigins.filter((origin) => origin !== "null").join(" ")}`
      : "frame-ancestors 'none'"),
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    [
      "connect-src 'self' https://generativelanguage.googleapis.com",
      ...apiOrigins.filter((origin) => origin !== "null"),
      ...(packagedApp ? ["null"] : []),
    ].join(" "),
    "worker-src 'self'",
  ].join("; "));
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

// "https://a.example, https://b.example/" -> ["https://a.example", "https://b.example"]
// Only absolute http(s) origins are accepted; anything else is ignored rather than trusted.
// Reads KEY=value lines from a local .env so `npm start` picks up the same settings a host
// injects. Existing process.env values win, malformed lines are skipped, and a missing file is
// normal (it is how every deployed container runs).
function loadEnvFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = rawValue.trim();
    const quoted = value.match(/^(["'])([\s\S]*)\1$/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    process.env[key] = value;
  }
}

// "https://a.example, https://b.example/" -> ["https://a.example", "https://b.example"]
// Only absolute http(s) origins are accepted; anything else is ignored rather than trusted.
function parseOriginList(value) {
  if (typeof value !== "string") return [];
  const origins = new Set();
  for (const entry of value.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;
    // The literal origin "null" is what a packaged app (file:// page) sends.
    if (candidate === "null") {
      origins.add("null");
      continue;
    }
    try {
      const url = new URL(candidate);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        origins.add(url.origin);
      }
    } catch {
      // Ignore malformed entries instead of widening access to them.
    }
  }
  return [...origins];
}

function isLocalOrigin(originUrl, requestUrl) {
  if (originUrl.origin !== `${originUrl.protocol}//${requestUrl.host}`) return false;
  // Public bind: the page and the API share the request's Host, which is how a tunnel, a
  // container's published port, and a TLS-terminating proxy present a single origin.
  return isPubliclyBound || isLoopbackHostname(originUrl.hostname);
}

function isLoopbackHostname(name) {
  return name === host || name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1";
}

// True when the server was asked to accept connections from outside this device.
function isPublicBindAddress(name) {
  if (!name || loopbackTargets.includes(name)) return false;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || name === "::" || name === "[::]" || name.includes(":");
}

// Returns the Origin header value to echo back in CORS headers, or "" when the request carries no
// browser Origin (a plain GET/HEAD) or the origin is not approved.
function allowedCorsOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !origin) return "";
  if (publicOrigins.includes(origin)) return origin;
  if (origin === "null" && publicOrigins.includes("null")) return "null";
  if (allowLocalOrigin) {
    try {
      const originUrl = new URL(origin);
      if (isLocalOrigin(originUrl, new URL(`http://${request.headers.host || `${host}:${port}`}`))) {
        return origin;
      }
    } catch {
      return "";
    }
  }
  return "";
}

// Accepts this device's own page (as before) plus any origin listed in NOVACORE_PUBLIC_ORIGIN, so a
// hosted NovaCore page or packaged mobile app can use the same proxy.
function isAllowedRequest(request, requestUrl) {
  const origin = request.headers.origin;
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  if (publicOrigins.includes(origin)) return true;
  if (!allowLocalOrigin) return false;
  try {
    return isLocalOrigin(new URL(origin), requestUrl);
  } catch {
    return false;
  }
}

function isLocalRequest(request, requestUrl) {
  const localHost = requestUrl.hostname === host || requestUrl.hostname === "localhost";
  if (!localHost || requestUrl.port !== String(port)) return false;
  const origin = request.headers.origin;
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  try {
    return isLocalOrigin(new URL(origin), requestUrl);
  } catch {
    return false;
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxRequestBytes) {
        reject(Object.assign(new Error("Search request is too large."), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Search request must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

const {
  fetchDuckDuckGoWeb,
  fetchDuckDuckGoImages,
  searchWithFallback,
  parseDuckDuckGoWebResults,
  mapDuckDuckGoInstantAnswer,
} =
  require("./duckduckgo-search");

function allowRateLimitedRequest(request) {
  // Behind a hosting proxy every request shares the proxy's socket, so the platform-provided
  // client address header is used instead to keep the per-user limit meaningful.
  const address = (trustProxy && (request.headers["x-forwarded-for"] || "").split(",")[0].trim()) ||
    request.socket.remoteAddress ||
    "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(address);
  if (!bucket || now - bucket.startedAt >= rateWindowMs) {
    rateBuckets.set(address, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= rateLimit;
}

async function handleSearch(request, response) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    sendJson(response, 415, { error: "Search requests must use application/json." });
    return;
  }
  if (!allowRateLimitedRequest(request)) {
    sendJson(response, 429, { error: "Too many searches from this browser. Wait a minute and try again." });
    return;
  }
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 4000) {
    sendJson(response, 400, { error: "Enter a search query between 1 and 4,000 characters." });
    return;
  }
  if (contentFilter.containsBlockedTerm(query)) {
    sendJson(response, 400, { error: contentFilter.blockedMessage });
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  let outcome;
  try {
    // searchWithFallback bounds every upstream call and falls back to Wikipedia, so this returns
    // results (with warnings) instead of throwing whenever any source answers in time.
    outcome = await searchWithFallback(query, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) return;
    const failed = error && typeof error === "object" ? error : {};
    const status = failed.status === 503 ? 503 : failed.status === 429 ? 429 : 502;
    const message = typeof failed.message === "string" && failed.message
      ? failed.message
      : "Search is temporarily unavailable. Try again in a moment.";
    console.error(`Search failed for a ${query.length}-character query: ${message}`);
    sendJson(response, status, { error: message, provider: "DuckDuckGo" });
    return;
  }
  if (controller.signal.aborted || response.destroyed) return;

  const keep = (result) => !contentFilter.containsBlockedTerm(
    `${result.title} ${result.description || ""} ${result.source || ""} ${result.url} ${result.pageUrl || ""} ${result.imageUrl || ""}`,
  );
  const webResults = Array.isArray(outcome.webResults) ? outcome.webResults.filter(keep) : [];
  const imageResults = Array.isArray(outcome.imageResults) ? outcome.imageResults.filter(keep) : [];
  const warnings = Array.isArray(outcome.warnings) ? outcome.warnings.filter((item) => typeof item === "string") : [];

  // A fallback source returning nothing is still an answer; the UI shows its warnings and advice.
  sendJson(response, 200, {
    provider: outcome.provider || "DuckDuckGo",
    query,
    webResults,
    imageResults,
    warnings,
  });
}

function readGeminiApiKey(request) {
  // A server-configured key is used when present so end users never have to supply their own.
  if (serverGeminiApiKey) return serverGeminiApiKey;
  const headerKey = request.headers["x-goog-api-key"];
  const raw = typeof headerKey === "string" ? headerKey : "";
  const apiKey = raw.trim();
  if (!apiKey) throw errorWithStatus("Add your Google Gemini API key to use live answers.", 401);
  if (apiKey.length < 10 || apiKey.length > maxApiKeyLength || /[\s,]/.test(apiKey)) {
    throw errorWithStatus("The Gemini API key in this request is not valid.", 401);
  }
  return apiKey;
}

async function handleGemini(request, response) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    sendJson(response, 415, { error: "Gemini requests must use application/json." });
    return;
  }
  if (!allowRateLimitedRequest(request)) {
    sendJson(response, 429, { error: "Too many AI requests from this browser. Wait a minute and try again." });
    return;
  }
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > maxPromptLength) {
    sendJson(response, 400, { error: "Enter a prompt between 1 and 4,000 characters." });
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const apiKey = readGeminiApiKey(request);
    const result = await generateGeminiResponse({
      apiKey,
      prompt,
      fetchImpl: (url, options) => fetch(url, { ...options, signal: controller.signal }),
    });
    if (controller.signal.aborted || response.destroyed) return;
    sendJson(response, 200, {
      provider: "Google Gemini",
      model: geminiModel,
      text: result.text,
      sources: result.sources,
    });
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) return;
    const status = error?.status === 401 ? 401 : 502;
    // gemini-api.js already redacts the key; never echo raw provider text here.
    const message = status === 401
      ? error.message
      : "Google Gemini could not complete this request. Check the API key, quota, and connection, then try again.";
    sendJson(response, status, { error: message });
  }
}

function errorWithStatus(message, status) {
  return Object.assign(new Error(message), { status });
}

function startServer({ openBrowser: shouldLaunchBrowser = shouldOpenBrowser, port: requestedPort = deployedPort, host: requestedHost = deployedHost, publicUrl: requestedPublicUrl } = {}) {
  const listenPort = Number.isSafeInteger(requestedPort) && requestedPort >= 0 && requestedPort < 65536
    ? requestedPort
    : port;
  const listenHost = typeof requestedHost === "string" && requestedHost ? requestedHost : host;
  // The banner describes the interface this listener actually bound, not the startup default.
  const boundPublicly = isPublicBindAddress(listenHost);
  const bannerPublicUrl = requestedPublicUrl ?? (process.env.NOVACORE_PUBLIC_URL || "");
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      // A serverless instance may find the default port taken; retry once on a free port.
      if (error.code === "EADDRINUSE" && listenPort !== 0 && requestedPort === deployedPort) {
        server.removeListener("error", handleError);
        startServer({ openBrowser: false, port: 0, host: listenHost }).then(resolve, reject);
        return;
      }
      reject(error);
    };
    server.once("error", handleError);
    server.listen(listenPort, listenHost, () => {
      server.removeListener("error", handleError);
      const address = server.address();
      const shownHost = listenHost === "0.0.0.0" || listenHost === "::" ? host : listenHost;
      // A public bind means the app is opened at its public address (tunnel, proxy, or host
      // domain), never at the internal localhost port that only exists inside the container.
      const shownUrl = boundPublicly
        ? `${publicBaseUrl(bannerPublicUrl)}/`
        : `http://${shownHost}:${address.port}/`;
      printDeploymentBanner(shownUrl, { publiclyBound: boundPublicly, listeningHost: listenHost, localUrl: `http://${shownHost}:${address.port}/` });
      if (shouldLaunchBrowser) openBrowser(shownUrl);
      resolve();
    });
  });
}

function publicBaseUrl(configured = process.env.NOVACORE_PUBLIC_URL) {
  const value = (configured || "https://your-server.example.com").trim();
  return value.replace(/\/+$/, "");
}

function printDeploymentBanner(shownUrl, { publiclyBound = isPubliclyBound, listeningHost = deployedHost, localUrl = "" } = {}) {
  console.log(`NovaCore server: ${shownUrl}`);
  console.log("Live search uses DuckDuckGo; no API key is required.");
  if (publiclyBound) {
    console.log(`Listening on ${listeningHost}:${new URL(localUrl || shownUrl).port} for the tunnel or reverse proxy in front of it.`);
    console.log("The page's own public origin is trusted, so a tunnel or host domain needs no origin config.");
    console.log("Cross-site callers (a separately hosted page, a packaged app) must be in NOVACORE_PUBLIC_ORIGIN.");
  } else {
    console.log("Only this device's own page may call the API. Set HOST=0.0.0.0 to allow other devices.");
  }
  if (publicOrigins.length) {
    console.log(`Browser origins allowed to call the API: ${publicOrigins.join(", ")}`);
  }
}

function serverAddress() {
  return server.listening ? server.address() : null;
}

function stopServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Could not start NovaCore: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer,
  stopServer,
  serverAddress,
  fetchDuckDuckGoWeb,
  fetchDuckDuckGoImages,
  parseDuckDuckGoWebResults,
  mapDuckDuckGoInstantAnswer,
  isAllowedRequest,
  allowedCorsOrigin,
  parseOriginList,
};

function openBrowser(url) {
  const command = process.platform === "win32"
    ? "rundll32.exe"
    : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", url]
    : [url];
  const browser = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  browser.once("error", (error) => {
    console.warn(`Could not open a browser automatically: ${error.message}`);
    console.log(`Open NovaCore manually at ${url}`);
  });
  browser.unref();
}
