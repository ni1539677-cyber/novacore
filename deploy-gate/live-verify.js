// End-to-end verification of the live production server from each legitimate caller's origin.
// Run: node deploy-gate/live-verify.js
const LIVE = "https://novacore-0ik3.onrender.com";
const results = [];

const check = async (label, path, init, expectStatus) => {
  try {
    const response = await fetch(`${LIVE}${path}`, { ...init, signal: AbortSignal.timeout(60000) });
    const text = await response.text();
    let detail = "";
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json.webResults)) detail = `${json.webResults.length} web results`;
      else if (json.provider) detail = `provider=${json.provider}`;
      else if (json.error) detail = json.error;
    } catch {
      detail = `${text.length} bytes`;
    }
    const ok = expectStatus === undefined ? response.ok : response.status === expectStatus;
    results.push({ label, status: response.status, ok, detail });
  } catch (error) {
    results.push({ label, status: "ERR", ok: false, detail: error.message });
  }
};

const json = { "Content-Type": "application/json" };

(async () => {
  await check("health (GET)", "/api/health", { method: "GET" }, 200);
  await check("landing page (GET)", "/", { method: "GET" }, 200);
  await check("app page (GET)", "/index.html", { method: "GET" }, 200);
  await check("APK download (GET)", "/app-debug.apk", { method: "GET" }, 200);
  await check("search, same origin", "/api/search", {
    method: "POST", headers: { ...json, Origin: LIVE }, body: JSON.stringify({ query: "astronomy" }),
  }, 200);
  await check("search, packaged app (Origin: null)", "/api/search", {
    method: "POST", headers: { ...json, Origin: "null" }, body: JSON.stringify({ query: "astronomy" }),
  }, 200);
  await check("search, unrelated site (must be 403)", "/api/search", {
    method: "POST", headers: { ...json, Origin: "https://evil.example.com" }, body: JSON.stringify({ query: "astronomy" }),
  }, 403);

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${String(r.status).padEnd(4)} ${r.label} -> ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} check(s) failed against ${LIVE}`);
    process.exit(1);
  }
  console.log(`\nAll checks passed against ${LIVE}`);
})();
