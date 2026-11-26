// Simulates the Docker image's /app: copies only what the Dockerfile COPY lines list, then starts
// server.js the way the container does. Exits non-zero if the image would fail at runtime.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const image = path.join(require("node:os").tmpdir(), `novacore-image-${Date.now()}`);

const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const copyLines = dockerfile.split(/\r?\n/).filter((line) => line.startsWith("COPY "));
const listed = [];
for (const line of copyLines) {
  const parts = line.slice(5).trim().split(/\s+/).filter((part) => part !== "--chown=node:node");
  const sources = parts.slice(0, -1);
  const target = parts[parts.length - 1];
  const targetDir = target.replace(/^\.\//, "").replace(/\/$/, "");
  const isDirTarget = targetDir === "" || targetDir === ".";
  for (const source of sources) {
    listed.push({ source, targetDir: isDirTarget ? path.basename(source) : targetDir });
  }
}

fs.mkdirSync(image, { recursive: true });
for (const { source, targetDir } of listed) {
  const from = path.join(root, source);
  const to = path.join(image, targetDir);
  if (!fs.existsSync(from)) {
    console.log(`SKIP (not in repo): ${source}`);
    continue;
  }
  fs.cpSync(from, to, { recursive: true });
}

const inImage = fs.readdirSync(image).sort();
console.log(`image files (${inImage.length}):`, inImage.join(", "));

// Every relative require in server.js must resolve inside the image.
const serverSource = fs.readFileSync(path.join(image, "server.js"), "utf8");
const requires = [...serverSource.matchAll(/require\("(\.\/[^"]+)"\)/g)].map((m) => m[1]);
const missing = requires.filter((specifier) => !fs.existsSync(path.join(image, `${specifier.slice(2)}.js`)));
console.log("server.js local requires:", requires.join(", "));
if (missing.length) {
  console.log(`FAIL: missing from image: ${missing.join(", ")}`);
  process.exit(1);
}

// Start it exactly like the container: PORT from env, --no-open, production settings.
const child = spawn(process.execPath, ["server.js", "--no-open"], {
  cwd: image,
  env: { ...process.env, PORT: "0", HOST: "0.0.0.0", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let finished = false;
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
child.on("exit", (code) => {
  if (finished || code === 0) return;
  console.log(`server exited early (code ${code}):\n${output}`);
  cleanup();
  process.exit(1);
});

// Windows keeps the copied tree locked for a moment after the child is killed.
const cleanup = () => {
  try {
    fs.rmSync(image, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A leftover temp folder is harmless.
  }
};
const finish = (code, message) => {
  if (finished) return;
  finished = true;
  console.log(message);
  child.kill();
  cleanup();
  process.exitCode = code;
};

const ready = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const match = output.match(/Listening on [^:]+:(\d+)/) || output.match(/NovaCore server: https?:\/\/[^:\s/]+:(\d+)/);
    if (match) {
      const url = `http://127.0.0.1:${match[1]}/api/health`;
      const response = await fetch(url).catch(() => null);
      if (response?.ok) {
        const body = await response.json();
        finish(0, `health: ${JSON.stringify(body)}\n\nPASS: image starts and answers /api/health`);
        return;
      }
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  finish(1, `FAIL: server never answered. Output:\n${output}`);
};
ready();
