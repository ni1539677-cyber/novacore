const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Docker .dockerignore semantics this project relies on:
//  - a pattern without a slash matches at any depth; one with a slash matches from the context root,
//  - `dir` excludes the whole directory and everything inside it,
//  - `*.md` style patterns match files directly under the context root,
//  - a `!` line can re-include a path that an earlier line excluded.
const isIgnored = (relativePath, rules) => {
  const normalized = relativePath.replace(/\\/g, "/");
  let ignored = false;
  for (const raw of rules) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    let pattern = negated ? line.slice(1).trim() : line;
    const directoryOnly = pattern.endsWith("/");
    pattern = pattern.replace(/^\.\//, "").replace(/\/$/, "");
    if (!pattern) continue;
    const parts = normalized.split("/");
    let matches;
    if (pattern.includes("/")) {
      const base = pattern.replace(/^\//, "");
      matches = normalized === base && !directoryOnly ? true : normalized.startsWith(`${base}/`);
    } else if (pattern.includes("*")) {
      const expression = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
      matches = expression.test(parts[0]);
    } else if (directoryOnly) {
      matches = parts.includes(pattern);
    } else {
      matches = parts.includes(pattern);
    }
    if (matches) ignored = !negated;
  }
  return ignored;
};

const copySources = () => {
  const dockerfile = read("Dockerfile");
  const sources = [];
  for (const line of dockerfile.split(/\r?\n/)) {
    if (!line.startsWith("COPY ")) continue;
    const parts = line.slice(5).trim().split(/\s+/).filter((part) => !part.startsWith("--"));
    sources.push(...parts.slice(0, -1));
  }
  return [...new Set(sources)];
};

const expand = (source) => {
  const absolute = path.join(root, source);
  if (!fs.existsSync(absolute)) return [];
  if (!fs.statSync(absolute).isDirectory()) return [source.replace(/\\/g, "/")];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/");
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else files.push(relative);
    }
  };
  walk(absolute);
  return files;
};

test("every Dockerfile COPY source is committed and not excluded by .dockerignore", () => {
  const rules = read(".dockerignore").split(/\r?\n/);
  const tracked = new Set(
    require("node:child_process")
      .execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean),
  );
  for (const source of copySources()) {
    assert.ok(fs.existsSync(path.join(root, source)), `COPY source ${source} is missing on disk`);
    const files = expand(source).filter((file) => !file.startsWith("node_modules/"));
    const ignored = files.filter((file) => isIgnored(file, rules));
    assert.deepEqual(
      ignored,
      [],
      `.dockerignore excludes files that Dockerfile COPY ${source} needs (Render fails at COPY):\n  ${ignored.slice(0, 5).join("\n  ")}`,
    );
    for (const file of files.slice(0, 20)) {
      assert.ok(tracked.has(file), `${file} is needed by the image but is not committed to git`);
    }
  }
});

test("download artifacts the Dockerfile ships are committed and under GitHub's file limit", () => {
  for (const file of [
    "dist/NovaCore-Setup-1.0.0.exe",
    "dist/app-setup.exe",
    "dist/novacore-local-search-1.0.0-x64.nsis.7z",
    "dist/latest.yml",
    "downloads/app-debug.apk",
    "downloads/NovaCore-Android-debug.apk",
  ]) {
    const absolute = path.join(root, file);
    assert.ok(fs.existsSync(absolute), `${file} must exist`);
    assert.ok(fs.statSync(absolute).size < 100 * 1024 * 1024, `${file} exceeds GitHub's 100 MB limit`);
  }
});

test("the image stays runnable as the unprivileged node user", () => {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /chmod[^\n]*dist[^\n]*downloads/, "download permissions must be fixed before USER node");
});
