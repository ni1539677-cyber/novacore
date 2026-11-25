const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const serverPath = path.join(__dirname, "server.js");
const siteOrigin = "https://nova.example.com";
const otherOrigin = "https://evil.example.net";

function startServerProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, "--no-open"], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start in time. Output: ${output}`));
    }, 10_000);
    child.stdout.on("data", async (chunk) => {
      output += chunk.toString();
      const match = output.match(/NovaCore server: (https?:\/\/[^\s/]+\/?)/);
      if (!match) return;
      clearTimeout(timer);
      // A printed URL is not yet an accepting socket; a request sent immediately can be
      // refused on a reused port, so wait until the local listener actually answers.
      const printed = new URL(match[1]);
      const host = printed.hostname === "localhost" ? "127.0.0.1" : printed.hostname;
      const origin = `http://${host}:${printed.port}`;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await fetch(`${origin}/api/health`);
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 100));
        }
      }
      resolve({ child, baseUrl: origin });
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with ${code}. Output: ${output}`));
      }
    });
  });
}

async function withServer(env, run) {
  const { child, baseUrl } = await startServerProcess(env);
  try {
    return await run(baseUrl);
  } finally {
    child.kill();
  }
}

const optionsPreflight = (baseUrl) => fetch(`${baseUrl}/api/search`, {
  method: "OPTIONS",
  headers: { Origin: siteOrigin, "Access-Control-Request-Method": "POST" },
});

test("allows the configured public origin and echoes CORS headers", async () => {
  await withServer({ NOVACORE_PUBLIC_ORIGIN: siteOrigin }, async (baseUrl) => {
    const preflight = await optionsPreflight(baseUrl);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), siteOrigin);
    assert.match(preflight.headers.get("access-control-allow-headers"), /x-goog-api-key/i);

    const blocked = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { Origin: siteOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "porn" }),
    });
    // Passed the origin check, then rejected by the built-in content filter.
    assert.equal(blocked.status, 400);
    assert.equal(blocked.headers.get("access-control-allow-origin"), siteOrigin);
  });
});

test("rejects an origin that is not configured", async () => {
  await withServer({ NOVACORE_PUBLIC_ORIGIN: siteOrigin }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { Origin: otherOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "weather" }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(`${baseUrl}/api/search`, {
      method: "OPTIONS",
      headers: { Origin: otherOrigin, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  });
});

test("with no configuration, only this device's own page may call the API", async () => {
  await withServer({}, async (baseUrl) => {
    const siteOriginRequest = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { Origin: siteOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "weather" }),
    });
    assert.equal(siteOriginRequest.status, 403);

    const sameOrigin = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { Origin: baseUrl, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "porn" }),
    });
    assert.equal(sameOrigin.status, 400);

    const headless = await fetch(`${baseUrl}/api/health`);
    assert.equal(headless.status, 200);
  });
});

test("health reports whether a server-side Gemini key is configured without exposing it", async () => {
  await withServer({ NOVACORE_GEMINI_API_KEY: "test-key-value-1234567890" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes("test-key-value-1234567890"), false);
    const payload = JSON.parse(body);
    assert.equal(payload.gemini.requiresApiKey, false);
    assert.equal(payload.gemini.keySource, "server");
  });
});

test("origin parsing ignores malformed entries instead of trusting them", () => {
  const { parseOriginList } = require("./server");
  assert.deepEqual(
    parseOriginList("https://a.example.com/, https://b.example.com, not-a-url, ftp://c.example.com, https://user:pass@d.example.com"),
    ["https://a.example.com", "https://b.example.com"],
  );
});

test("serves the page but never exposes the serverless adapter sources", async () => {
  await withServer({}, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/app.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NovaCore/);
    for (const name of ["api/_proxy.js", "api/search.js", "api/gemini.js", "api/health.js"]) {
      const response = await fetch(`${baseUrl}/${name}`);
      assert.equal(response.status, 404, `${name} should not be downloadable`);
    }
  });
});

// --- Cloud deployment regressions -------------------------------------------------------------
// Each test below corresponds to a bug that made a deployed instance unusable while local
// development looked fine.

// A public bind owns the whole interface, so it cannot ask the OS for a free port (PORT=0).
// Bind a fixed high port instead; the tunnel then forwards the PUBLIC host in the Host header.
const tunnelHost = "nova-smoke.trycloudflare.com";
function withPublicServer(env, run) {
  const listenPort = 20000 + Math.floor(Math.random() * 20000);
  const ready = startServerProcess({ PORT: String(listenPort), HOST: "0.0.0.0", ...env });
  return ready.then(async ({ child }) => {
    try {
      return await run(`http://127.0.0.1:${listenPort}`);
    } finally {
      child.kill();
    }
  });
}

// Node's fetch() drops a manually supplied Host header, so the tunnel's forwarding has to be
// reproduced with a raw request that really sends Host: <public domain>.
function postViaPublicHost(localUrl, origin, body) {
  const { hostname, port } = new URL(localUrl);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname,
        port,
        path: "/api/search",
        method: "POST",
        headers: {
          Host: tunnelHost,
          Origin: origin,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response));
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

test("a tunnel or host domain may call its own API (public bind)", async () => {
  // The browser sits at the public domain and sends Origin "https://<domain>" with no port,
  // while the tunnel forwards that Host to 0.0.0.0:PORT. Origin therefore never equals the
  // socket's host:port, and this used to answer 403 on every live search of a deployed app.
  await withPublicServer({ NOVACORE_PUBLIC_ORIGIN: "" }, async (localUrl) => {
    const publicOrigin = `https://${tunnelHost}`;
    const response = await postViaPublicHost(localUrl, publicOrigin, { query: "porn" });
    // 400 = passed the origin check and was stopped by the content filter, which is the point.
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers["access-control-allow-origin"], publicOrigin);
  });
});

test("a public bind still rejects unconfigured cross-site origins", async () => {
  await withPublicServer({ NOVACORE_PUBLIC_ORIGIN: "" }, async (localUrl) => {
    const response = await postViaPublicHost(localUrl, otherOrigin, { query: "weather" });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  });
});

test("a packaged app origin (null) is allowed for connections but never as a frame or script", async () => {
  // Reacts to the upload size limit so it never depends on DuckDuckGo's availability.
  await withPublicServer({ NOVACORE_PUBLIC_ORIGIN: "null" }, async (localUrl) => {
    const response = await fetch(`${localUrl}/api/search`, {
      method: "POST",
      headers: { Origin: "null", "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(25_000) }),
      // The server drops oversize uploads mid-stream, which surfaces as a socket error.
    }).catch((error) => ({ status: 0, error, headers: new Headers() }));
    // 0 = the connection was closed by the size limit; 413 = rejected outright. Either way the
    // packaged origin passed the origin check, which would otherwise have answered 403 first.
    assert.notEqual(response.status, 403);
    const policy = (await fetch(`${localUrl}/api/health`, { method: "HEAD" })).headers.get("content-security-policy") || "";
    assert.match(policy, /connect-src[^;]*null/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.doesNotMatch(policy, /frame-ancestors[^;]*null/);
    assert.doesNotMatch(policy, /script-src[^;]*null/);
  });
});

test("the landing page is served at / and the app at /index.html", async () => {
  await withServer({}, async (baseUrl) => {
    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /landing-body/);

    const landing = await fetch(`${baseUrl}/landing.html`);
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /landing-body/);

    const app = await fetch(`${baseUrl}/index.html`);
    assert.equal(app.status, 200);
    const appHtml = await app.text();
    assert.match(appHtml, /NovaCore ID/);
    assert.doesNotMatch(appHtml, /landing-body/);
  });
});

test("every download link the landing page advertises is a real route", async () => {
  await withServer({}, async (baseUrl) => {
    const landingHtml = await (await fetch(`${baseUrl}/landing.html`)).text();
    const hrefs = [...landingHtml.matchAll(/href="\.\/([^"#]+)"/g)].map((match) => match[1]);
    assert.ok(hrefs.includes("app-setup.exe"));
    assert.ok(hrefs.includes("app-debug.apk"));
    for (const href of hrefs) {
      const response = await fetch(`${baseUrl}/${href}`, { method: "HEAD" });
      // 200 = the build exists here; 404 = it was not built yet, which is the documented answer.
      assert.ok([200, 404].includes(response.status), `/${href} returned ${response.status}`);
      assert.notEqual(response.headers.get("content-type"), "application/json; charset=utf-8");
    }
  });
});

test("a built installer is streamed as a download, not as a page", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/app-setup.exe`, { method: "HEAD" });
    if (response.status === 404) return; // dist/ not built on this machine
    assert.match(response.headers.get("content-disposition") || "", /attachment/);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
  });
});

test("health and favicon answer so a cloud health check and browser load stay clean", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).requiresApiKey, false);

    const favicon = await fetch(`${baseUrl}/favicon.ico`, { method: "HEAD" });
    assert.equal(favicon.status, 200);
  });
});
