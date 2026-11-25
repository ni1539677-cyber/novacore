// Why does the public-bind origin check pass even with the public branch removed?
const { spawn } = require("node:child_process");
const http = require("node:http");

const port = 23456;
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;

function post(originValue) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query: "porn" });
    const req = http.request(
      {
        host: "127.0.0.1", port, path: "/api/search", method: "POST",
        headers: { Host: host, Origin: originValue, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      },
      (res) => resolve({ status: res.statusCode, acao: res.headers["access-control-allow-origin"] }),
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end(body);
  });
}

const child = spawn(process.execPath, ["server.js", "--no-open"], {
  env: { ...process.env, PORT: String(port), HOST: "0.0.0.0", NOVACORE_PUBLIC_ORIGIN: "" }, stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", async (c) => {
  out += c;
  if (!/NovaCore server:/.test(out)) return;
  await new Promise((r) => setTimeout(r, 500));
  console.log("origin == public URL      :", await post(origin));
  console.log("origin == other site      :", await post("https://evil.example.net"));
  console.log("no origin header (GET-ish):", await post(undefined));
  child.kill();
});
