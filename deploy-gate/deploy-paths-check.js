// Cross-checks the three places that must agree, without Docker:
//   1. server.js download routes  -> which file each route serves
//   2. Dockerfile                 -> which of those files the image receives
//   3. .dockerignore              -> which of those files survive the build context
// Any file that fails 2 or 3 is exactly what makes Render stop in seconds or answer
// "File wasn't available on site" after a successful deploy.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const problems = [];

// 1. Download routes and the file behind each one.
const staticBlock = read("server.js").slice(
  read("server.js").indexOf("const staticFiles = new Map(["),
  read("server.js").indexOf("const serverlessAdapterNames"),
);
const routes = [];
for (const line of staticBlock.split(/\r?\n/)) {
  const match = /^\s*\["([^"]+)",\s*\["([^"]+)"/.exec(line);
  if (!match) continue;
  const [, route, file] = match;
  if (!/\.(exe|apk|7z|yml)$/i.test(file)) continue;
  routes.push({ route, file });
}
if (routes.length < 4) {
  // Never pass silently if the parser stops matching: this check exists to catch drift.
  console.error(`Parser found only ${routes.length} download routes; expected at least 4.`);
  process.exit(1);
}

const dockerfile = read("Dockerfile");
const dockerIgnored = read(".dockerignore").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));

// .dockerignore rules that matter for the download artifacts (Docker's own semantics).
const isIgnored = (relative) => {
  const normalized = relative.replace(/\\/g, "/");
  const parts = normalized.split("/");
  let ignored = false;
  for (const rule of dockerIgnored) {
    const negated = rule.startsWith("!");
    const pattern = rule.replace(/^!/, "").trim().replace(/^\//, "");
    if (!pattern) continue;
    const hit = pattern.includes("/")
      ? normalized.startsWith(pattern)
      : pattern.includes("*")
        ? new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`).test(parts[0])
        : parts.includes(pattern);
    if (hit) ignored = !negated;
  }
  return ignored;
};

const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/));

for (const { route, file } of routes) {
  const absolute = path.join(root, file);
  const exists = fs.existsSync(absolute);
  // A signed release APK is intentionally not built here; the route then answers 404 by design.
  const optional = file === "downloads/NovaCore-Android.apk";
  if (!exists) {
    if (!optional) problems.push(`${route} -> ${file} does not exist`);
    continue;
  }
  if (!tracked.has(file)) problems.push(`${route} -> ${file} is not committed to git`);
  if (isIgnored(file)) problems.push(`${route} -> ${file} is excluded by .dockerignore (COPY will fail)`);
  const dir = path.posix.dirname(file);
  const copiedWhole = new RegExp(`^COPY\\s+${dir}\\s+(\\./)?${dir}/?$`, "m").test(dockerfile);
  const copiedFile = dockerfile.includes(`COPY ${file}`);
  if (!copiedWhole && !copiedFile) problems.push(`${route} -> ${dir} is not copied by the Dockerfile`);
  if (/\.(exe|apk|7z)$/i.test(file) && fs.statSync(absolute).size < 100_000) {
    problems.push(`${route} -> ${file} looks truncated (${fs.statSync(absolute).size} bytes)`);
  }
}

// 2. Every local module server.js requires must reach the image.
for (const [, specifier] of read("server.js").matchAll(/require\("(\.\/[^"]+)"\)/g)) {
  const file = `${specifier.slice(2)}.js`;
  if (!fs.existsSync(path.join(root, file))) problems.push(`server.js requires ${specifier} but ${file} is missing`);
  if (!dockerfile.includes(file)) problems.push(`server.js requires ${file} but the Dockerfile does not copy it`);
  if (isIgnored(file)) problems.push(`server.js requires ${file} but .dockerignore excludes it`);
}

// 3. Packaged clients keep the live origin.
const renderer = read("renderer.js");
if (!renderer.includes('const liveApiBaseUrl = "https://novacore-0ik3.onrender.com"')) {
  problems.push("renderer.js does not default to the live server");
}
const activity = read("android/app/src/main/java/com/novacore/mobile/MainActivity.java");
if (!activity.includes('LIVE_API_BASE = "https://novacore-0ik3.onrender.com"')) {
  problems.push("MainActivity does not call the live server");
}
if (!fs.readFileSync(path.join(root, "dist", "NovaCore-Setup-1.0.0.exe")).includes(Buffer.from("novacore-0ik3.onrender.com", "utf16le"))) {
  problems.push("the installer stub does not fetch its payload from the live server");
}

console.log(`download routes checked: ${routes.length}`);
for (const { route, file } of routes) console.log(`  ${route.padEnd(46)} -> ${file}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}
console.log("\nPASS: routes, build context, Dockerfile COPYs and client origins all agree");
