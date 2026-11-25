// Verifies that the packaged/browser clients resolve their API origin to the live server.
// Reads the origin-resolution block straight out of renderer.js and evaluates it under the
// location each client actually runs with, so the check cannot drift from the real code.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const start = renderer.indexOf("// The API can live on a different origin");
const end = renderer.indexOf("const searchProxyTimeoutMs");
assert.ok(start > 0 && end > start, "could not locate the API origin block in renderer.js");
const block = `${renderer.slice(start, end)}\nmodule.exports = { apiBaseUrl, geminiProxyPath, searchProxyPath };`;

const LIVE = "https://novacore-0ik3.onrender.com";

const resolveFor = (href, apiBase) => {
  const sandbox = {
    location: new URL(href),
    window: { NOVACORE_API_BASE: apiBase ?? "" },
    module: { exports: {} },
    URL,
  };
  vm.runInNewContext(block, sandbox);
  return sandbox.module.exports;
};

const cases = [
  // The packaged Windows .exe and Android .apk load from file://.
  { name: "packaged EXE/APK (file://)", href: "file:///C:/app/app.html", expect: LIVE },
  { name: "packaged, explicit override kept", href: "file:///C:/app/app.html", apiBase: "https://staging.example.com", expect: "https://staging.example.com" },
  // The deployed site's own page.
  { name: "live hosted page", href: `${LIVE}/index.html`, expect: LIVE },
  // `npm start` serves /api/* itself, so it must stay same-origin.
  { name: "local npm start server", href: "http://localhost:3000/", expect: "" },
  { name: "local 127.0.0.1 server", href: "http://127.0.0.1:3000/", expect: "" },
  // An unrelated site keeps its own origin and is still refused by the server.
  { name: "third-party page", href: "https://someone.example.com/", expect: "" },
];

const failures = [];
for (const testCase of cases) {
  const resolved = resolveFor(testCase.href, testCase.apiBase);
  if (resolved.apiBaseUrl !== testCase.expect) {
    failures.push(`${testCase.name}: expected "${testCase.expect}", got "${resolved.apiBaseUrl}"`);
  } else if (testCase.expect) {
    const expectedSearch = `${testCase.expect}/api/search`;
    if (resolved.searchProxyPath !== expectedSearch || resolved.geminiProxyPath !== `${testCase.expect}/api/gemini`) {
      failures.push(`${testCase.name}: endpoints are ${resolved.searchProxyPath} / ${resolved.geminiProxyPath}`);
    }
  }
  console.log(`${resolved.apiBaseUrl === testCase.expect ? "ok  " : "FAIL"} ${testCase.name} -> ${resolved.apiBaseUrl || "(same origin)"}`);
}

// The packaged builds must not silently keep calling a local server.
const config = fs.readFileSync(path.join(root, "novacore-config.js"), "utf8");
if (!/window\.NOVACORE_API_BASE\s*=\s*""\s*;/.test(config)) {
  failures.push("novacore-config.js should leave NOVACORE_API_BASE empty so the live default applies");
}

if (failures.length) {
  console.error("\nCLIENT ORIGIN CHECK FAILED:");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log("\nCLIENT ORIGIN CHECK PASSED: packaged and hosted clients use the live server; local start stays local.");
