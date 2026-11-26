// Polls the live /api/search until the deployed code changes (provider/warnings reveal it) or the
// deadline passes, then prints the final result. Run: node deploy-gate/live-search-verify.js
const LIVE = "https://novacore-0ik3.onrender.com";
const deadline = Date.now() + 9 * 60_000;

const search = async (query) => {
  const started = Date.now();
  try {
    const response = await fetch(`${LIVE}/api/search`, {
      method: "POST",
      headers: { Origin: LIVE, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 200) };
    }
    return { status: response.status, elapsed: Date.now() - started, payload };
  } catch (error) {
    return { status: "ERR", elapsed: Date.now() - started, payload: { error: error.message } };
  }
};

(async () => {
  const query = "astronomy for beginners";
  let last;
  while (Date.now() < deadline) {
    last = await search(query);
    const oldCode = last.status === 502 && /took too long|Could not connect/.test(last.payload.error || "");
    console.log(`[${new Date().toISOString().slice(11, 19)}] HTTP ${last.status} in ${last.elapsed} ms` +
      `  ${last.payload.error ? `error="${last.payload.error}"` : `provider=${last.payload.provider} web=${last.payload.webResults?.length} images=${last.payload.imageResults?.length}`}`);
    if (!oldCode) break;
    console.log("   still the previous deployment; waiting 15 s for Render to finish redeploying");
    await new Promise((done) => setTimeout(done, 15_000));
  }

  if (!last) return;
  if (last.status === 200) {
    const first = last.payload.webResults?.[0];
    console.log(`\nPASS: ${last.payload.provider} returned ${last.payload.webResults?.length} web results in ${last.elapsed} ms`);
    if (first) console.log(`  first: ${first.title} -> ${first.url}`);
    for (const warning of last.payload.warnings || []) console.log(`  warning: ${warning}`);
  } else {
    console.log(`\nNOT FIXED YET: HTTP ${last.status} ${last.payload.error || ""}`);
    process.exitCode = 1;
  }
})();
