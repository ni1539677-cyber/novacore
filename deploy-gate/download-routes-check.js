// End-to-end check of the download routes on an isolated port (port 3000 is sometimes taken by
// another listener on this machine, which answers 404 for every /api/ path).
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
// A random high port: an orphaned server from an earlier run must never answer for this one.
const port = 41000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, ["server.js", "--no-open"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const base = `http://127.0.0.1:${port}`;
const routes = [
  "/api/health",
  "/app-setup.exe",
  "/app-debug.apk",
  "/downloads/NovaCore-Setup-1.0.0.exe",
  "/dist/novacore-local-search-1.0.0-x64.nsis.7z",
  "/latest.yml",
];

(async () => {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    const health = await fetch(`${base}/api/health`).catch(() => null);
    ready = Boolean(health?.ok);
    if (!ready) await new Promise((done) => setTimeout(done, 300));
  }
  if (!ready) {
    console.log(`server did not become ready:\n${output}`);
    child.kill();
    process.exitCode = 1;
    return;
  }
  const rows = [];
  for (const route of routes) {
    const head = await fetch(`${base}${route}`, { method: "HEAD" }).catch(() => null);
    const length = Number(head?.headers.get("content-length") || 0);
    let detail = "";
    if (head && !head.ok) detail = ` ${(await head.text()).slice(0, 120)}`;
    rows.push(`${head?.status ?? "ERR"} ${route} (${length} bytes, ${head?.headers.get("content-type") || "-"})${detail}`);
  }
  console.log(rows.join("\n"));
  const failed = rows.some((row) => !row.startsWith("200"));
  child.kill();
  console.log(failed ? "\nFAIL" : "\nPASS: every download route serves real bytes");
  process.exitCode = failed ? 1 : 0;
})();
