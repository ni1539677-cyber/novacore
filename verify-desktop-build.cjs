// Re-checks the packaged installer's API wiring (run after `npm run desktop:windows`).
const path = require("node:path");
const asar = require("@electron/asar");

const archive = path.join(__dirname, "dist", "win-unpacked", "resources", "app.asar");
const files = asar.listPackage(archive).filter((name) => !name.endsWith("/")).map((name) => name.replace(/^\\/, ""));
console.log("asar files:", files.join(", "));
const read = (name) => asar.extractFile(archive, name).toString("utf8");

const renderer = read("renderer.js");
console.log("renderer:", renderer.split(/\r?\n/)
  .filter((line) => /const liveApiBaseUrl|const geminiProxyPath|const searchProxyPath|const apiBaseUrl =/.test(line))
  .join("\n"));
const desktop = read("desktop-main.js");
console.log("desktop requires:", [...desktop.matchAll(/require\("(\.\/[^"]+)"\)/g)].map((m) => m[1]).join(", "));
console.log("every desktop require is packaged:", [...desktop.matchAll(/require\("(\.\/[^"]+)"\)/g)]
  .every((match) => files.includes(`${match[1].slice(2)}.js`)));
const configCode = read("novacore-config.js").split(/\r?\n/).filter((line) => !line.trim().startsWith("//"));
console.log("config override:", /window\.NOVACORE_API_BASE\s*=\s*"([^"]*)"/.exec(configCode.join("\n"))?.[1] || "(none)");
const page = read("app.html");
const policy = /connect-src([^;"]+)/.exec(page)?.[1]?.trim() || "";
console.log("desktop CSP:", policy);
console.log("desktop CSP allows localhost:", /localhost|127\.0\.0\.1/.test(policy));
console.log("desktop CSP allows live server:", policy.includes(liveOriginInPage(page)));

function liveOriginInPage(source) {
  const match = /const liveApiBaseUrl = "([^"]+)"/.exec(source);
  return match ? match[1] : "https://novacore-0ik3.onrender.com";
}
