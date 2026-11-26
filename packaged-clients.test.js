const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const liveOrigin = "https://novacore-0ik3.onrender.com";

test("the live backend URL is unchanged in every client", () => {
  assert.match(read("renderer.js"), /const liveApiBaseUrl = "https:\/\/novacore-0ik3\.onrender\.com";/);
  assert.match(read("android/app/src/main/java/com/novacore/mobile/MainActivity.java"),
    /LIVE_API_BASE = "https:\/\/novacore-0ik3\.onrender\.com"/);
  for (const file of ["renderer.js", "novacore-config.js"]) {
    assert.doesNotMatch(read(file), /localhost:3000/, `${file} must not fall back to a local proxy`);
  }
});

test("packaged builds call the live backend server-to-server, not through browser CORS", () => {
  // Desktop: the main process performs the search/Gemini calls, so the page needs no CORS at all.
  const desktop = read("desktop-main.js");
  assert.match(desktop, /ipcMain\.handle\("web-search"/);
  assert.match(desktop, /ipcMain\.handle\("generate-gemini-response"/);

  // Android: both bridges POST to LIVE_API_BASE from Java before falling back.
  const activity = read("android/app/src/main/java/com/novacore/mobile/MainActivity.java");
  assert.match(activity, /LIVE_API_BASE \+ "\/api\/search"/);
  assert.match(activity, /LIVE_API_BASE \+ "\/api\/gemini"/);
  assert.match(activity, /"X-Goog-Api-Key", apiKey/);
  assert.match(activity, /addJavascriptInterface\(new GeminiBridge\(\), "NovaCoreAndroidGemini"\)/);
});

test("the Android bridge exposes Gemini only when the page cannot call the proxy itself", () => {
  const bridge = read("android/app/src/androidShell/novacore-android-bridge.js");
  assert.match(bridge, /window\.NovaCoreAndroidGemini/);
  assert.match(bridge, /window\.NovaCoreGemini && typeof window\.NovaCoreGemini\.generateGeminiResponse === "function"\) return;/);
  assert.match(bridge, /\^https:/);
});

test("renderer prefers the live backend for search before any on-device fallback", () => {
  const renderer = read("renderer.js");
  const fetchStart = renderer.indexOf("const fetchSearchProxy = async");
  const fetchBody = renderer.slice(fetchStart, renderer.indexOf("const openDuckDuckGoTab"));
  const desktopCall = fetchBody.indexOf("desktopApi.searchWeb");
  const nativeCall = fetchBody.indexOf("isNativeSearchAvailable()");
  assert.ok(desktopCall >= 0 && nativeCall >= 0, "both call paths exist");
  assert.ok(desktopCall < nativeCall, "the live backend is tried before the on-device bridge");
});

test("Gemini on a packaged page never needs the host to allow Origin: null", () => {
  const renderer = read("renderer.js");
  const start = renderer.indexOf("const generateBrowserResponse = async");
  const body = renderer.slice(start, renderer.indexOf("const generateLiveResponse"));
  // The file:// path must be answered by the native/Electron bridge before any fetch() happens.
  const bridgeCall = body.indexOf("window.NovaCoreGemini?.generateGeminiResponse");
  const fetchCall = body.indexOf("await fetch(geminiProxyPath");
  assert.ok(bridgeCall >= 0 && fetchCall >= 0);
  assert.ok(bridgeCall < fetchCall);
});

test("Dockerfile ships every download route's file and the server's modules", () => {
  const dockerfile = read("Dockerfile");
  for (const file of [
    "server.js",
    "gemini-api.js",
    "content-filter.js",
    "duckduckgo-search.js",
    "dist/NovaCore-Setup-1.0.0.exe",
    "downloads",
  ]) {
    assert.ok(dockerfile.includes(file), `Dockerfile must copy ${file}`);
  }

  const server = read("server.js");
  const routes = [...server.matchAll(/\["(\/[^"]*(?:\.exe|\.apk))", \["([^"]+)"/g)];
  assert.ok(routes.length >= 4, "download routes are registered");
  for (const [, route, servedFile] of routes) {
    if (servedFile === "downloads/NovaCore-Android.apk") continue; // signed release, not built here
    assert.ok(fs.existsSync(path.join(root, servedFile)), `${route} -> ${servedFile} must exist`);
    assert.ok(dockerfile.includes(path.dirname(servedFile).replace("\\", "/")) ||
      dockerfile.includes(servedFile), `${route} file must be inside the image`);
  }
});

test("no stale build outputs are tracked in the repository", () => {
  const gitignore = read(".gitignore");
  assert.doesNotMatch(gitignore, /^dist\/$/m, "dist/ must be committable so the image can ship the installer");
  for (const stale of ["dist/NovaCore Setup 1.0.0.exe", "dist/NovaCore Setup 1.0.0.exe.blockmap"]) {
    assert.ok(gitignore.includes(stale), `${stale} must stay ignored`);
  }
  assert.ok(gitignore.includes("downloads/NovaCore-Android.apk"), "the unbuilt signed release stays ignored");
});
