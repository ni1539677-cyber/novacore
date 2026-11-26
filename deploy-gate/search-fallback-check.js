// End-to-end timing through the real HTTP route with DuckDuckGo simulated as unreachable, which is
// what Render's egress looks like. Proves the client gets an answer (fallback results) in bounded time.
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = 41500 + Math.floor(Math.random() * 500);
const root = path.resolve(__dirname, "..");

// A preload module: every duckduckgo.com request hangs until aborted; everything else is untouched.
const fs = require("node:fs");
const preload = path.join(require("node:os").tmpdir(), `novacore-hang-${Date.now()}.cjs`);
fs.writeFileSync(preload, `
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (/duckduckgo\\.com/.test(String(url))) {
    return new Promise((resolve, reject) => {
      const signal = init && init.signal;
      if (!signal) return;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
    });
  }
  return realFetch(url, init);
};
`);

const child = spawn(process.execPath, ["--require", preload, "server.js", "--no-open"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });

const post = (query) => new Promise((resolve, reject) => {
  const body = JSON.stringify({ query });
  const started = Date.now();
  const request = http.request({
    host: "127.0.0.1",
    port,
    path: "/api/search",
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, (response) => {
    let text = "";
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => resolve({ status: response.statusCode, elapsed: Date.now() - started, text }));
  });
  request.on("error", reject);
  request.end(body);
});

(async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let ready = null;
    try {
      ready = await fetch(`http://127.0.0.1:${port}/api/health`);
    } catch {
      ready = null;
    }
    if (ready?.ok) break;
    await new Promise((done) => setTimeout(done, 250));
  }

  for (const query of ["astronomy for beginners", "quantum computing"]) {
    let result;
    try {
      result = await post(query);
    } catch (error) {
      console.log(`${query.padEnd(24)} request failed: ${error.message}`);
      console.log(`server log:\n${log.slice(0, 800)}`);
      child.kill();
      fs.rmSync(preload, { force: true });
      return;
    }
    const payload = JSON.parse(result.text);
    console.log(
      `${query.padEnd(24)} HTTP ${result.status} in ${String(result.elapsed).padStart(6)} ms  ` +
      `provider=${payload.provider} web=${payload.webResults?.length ?? 0} images=${payload.imageResults?.length ?? 0}`,
    );
    if (payload.webResults?.[0]) console.log(`   first: ${payload.webResults[0].title} -> ${payload.webResults[0].url}`);
    if (payload.warnings?.length) console.log(`   warnings: ${payload.warnings.join(" | ")}`);
  }

  child.kill();
  fs.rmSync(preload, { force: true });
  if (/Cannot find module|Error:/.test(log)) console.log(`\nserver log:\n${log.slice(0, 600)}`);
})();
