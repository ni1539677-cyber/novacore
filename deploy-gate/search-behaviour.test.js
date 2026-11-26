const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

// The real Render symptom: DuckDuckGo hangs from the host's egress and the user sees
// "Searching..." then "Search unavailable". The fallback check stubs DuckDuckGo as unreachable and
// drives the actual HTTP route, asserting results come back within a bounded time.
test("search still answers when DuckDuckGo is unreachable", () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, "search-fallback-check.js")], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  const answers = [...output.matchAll(/HTTP (\d+) in\s+(\d+) ms\s+provider=(\w+) web=(\d+)/g)];
  assert.equal(answers.length, 2, output);
  for (const [, status, elapsed, provider, web] of answers) {
    assert.equal(status, "200", `expected 200, got ${status}\n${output}`);
    assert.ok(Number(elapsed) < 20_000, `answered in ${elapsed} ms, expected under 20 s\n${output}`);
    assert.equal(provider, "Wikipedia");
    assert.ok(Number(web) >= 3, `expected results, got ${web}\n${output}`);
  }
});

test("search answers quickly when DuckDuckGo is healthy, or falls back cleanly", async () => {
  const { searchWithFallback } = require("../duckduckgo-search");
  const started = Date.now();
  const outcome = await searchWithFallback("astronomy for beginners", { signal: new AbortController().signal });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 20_000, `took ${elapsed} ms`);
  assert.ok(["DuckDuckGo", "Wikipedia"].includes(outcome.provider));
  assert.ok(outcome.webResults.length > 0, "results must never be empty on a successful answer");
  for (const result of outcome.webResults) {
    assert.match(result.url, /^https:\/\//, `insecure result URL ${result.url}`);
    assert.ok(result.title.length > 0);
  }
});

test("the search client bounds every upstream call", () => {
  const source = require("node:fs").readFileSync(path.join(projectRoot, "duckduckgo-search.js"), "utf8");
  // A per-request timeout plus an overall budget: the previous code could spend ~31 s on retries.
  assert.match(source, /const requestTimeoutMs = \d+_?\d*;/);
  assert.match(source, /const searchBudgetMs = \d+_?\d*;/);
  assert.match(source, /AbortSignal\.timeout\(requestTimeoutMs\)/);
  assert.match(source, /searchWithFallback/);
  // The route must use the fallback helper rather than calling DuckDuckGo directly.
  const server = require("node:fs").readFileSync(path.join(projectRoot, "server.js"), "utf8");
  assert.match(server, /searchWithFallback\(query/);
});
