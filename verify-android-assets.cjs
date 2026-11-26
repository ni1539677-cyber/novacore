// The packaged APK must reach the live server only: no localhost proxy, and the API origin must be
// baked into renderer.js. Run after any Android build; exits non-zero when the policy drifted.
const fs = require("node:fs");
const path = require("node:path");

const liveOrigin = "https://novacore-0ik3.onrender.com";
const assets = path.join(__dirname, "android", "app", "src", "main", "assets");
const read = (name) => fs.readFileSync(path.join(assets, name), "utf8");
const problems = [];

const page = read("index.html");
const renderer = read("renderer.js");
const config = read("novacore-config.js");

const policy = /connect-src([^;"]+)/.exec(page)?.[1] || "";
if (!policy.includes(liveOrigin)) problems.push(`index.html CSP does not allow ${liveOrigin}`);
if (/localhost|127\.0\.0\.1/.test(policy)) problems.push("index.html CSP still allows localhost");
if (!page.includes("novacore-android-bridge.js")) problems.push("index.html does not load the native search bridge");
if (!page.includes("novacore-config.js")) problems.push("index.html does not load novacore-config.js");
if (!renderer.includes(`const liveApiBaseUrl = "${liveOrigin}"`)) problems.push("renderer.js does not point at the live server");
if (/localhost:3000/.test(renderer)) problems.push("renderer.js still references the localhost proxy");

const activeConfig = config.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
const override = /window\.NOVACORE_API_BASE\s*=\s*"([^"]*)"/.exec(activeConfig)?.[1] || "";
if (override && override !== liveOrigin) problems.push(`novacore-config.js overrides the API base with ${override}`);

console.log(`assets in ${path.relative(__dirname, assets)}:`);
console.log(`  CSP connect-src:${policy}`);
console.log(`  live origin: ${liveOrigin}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}
console.log("\nPackaged Android assets point at the live server only.");
