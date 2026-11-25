const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { parseDuckDuckGoWebResults, mapDuckDuckGoInstantAnswer } = require("./server");

const serverPath = path.join(__dirname, "server.js");

function startServerProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, "--no-open"], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NOVACORE_GEMINI_API_KEY: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start in time. Output: ${output}`));
    }, 10_000);
    child.stdout.on("data", async (chunk) => {
      output += chunk.toString();
      const match = output.match(/NovaCore server: (https?:\/\/[^\s/]+\/?)/);
      if (!match) return;
      clearTimeout(timer);
      const printed = new URL(match[1]);
      const baseUrl = `http://${printed.hostname}:${printed.port}`;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await fetch(`${baseUrl}/api/health`);
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 100));
        }
      }
      resolve({ child, baseUrl });
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with ${code}. Output: ${output}`));
      }
    });
  });
}

async function withServer(env, run) {
  const { child, baseUrl } = await startServerProcess(env);
  try {
    return await run(baseUrl);
  } finally {
    child.kill();
  }
}

const postJson = (baseUrl, route, body, headers = {}) => fetch(`${baseUrl}${route}`, {
  method: "POST",
  headers: { Origin: baseUrl, "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

test("Gemini proxy enforces origin, content type, prompt, and key checks", async () => {
  await withServer({}, async (baseUrl) => {
    const foreign = await postJson(baseUrl, "/api/gemini", { prompt: "Hello" }, { Origin: "https://evil.example.net" });
    assert.equal(foreign.status, 403);
    assert.match((await foreign.json()).error, /approved NovaCore origins/);

    const wrongType = await fetch(`${baseUrl}/api/gemini`, {
      method: "POST",
      headers: { Origin: baseUrl, "Content-Type": "text/plain" },
      body: "hello",
    });
    assert.equal(wrongType.status, 415);

    const noKey = await postJson(baseUrl, "/api/gemini", { prompt: "What is the night sky?" });
    assert.equal(noKey.status, 401);
    assert.match((await noKey.json()).error, /Gemini API key/);

    const noPrompt = await postJson(baseUrl, "/api/gemini", { prompt: "   " }, { "X-Goog-Api-Key": "test-api-key-123" });
    assert.equal(noPrompt.status, 400);

    const tooLong = await postJson(baseUrl, "/api/gemini", { prompt: "x".repeat(4001) }, { "X-Goog-Api-Key": "test-api-key-123" });
    assert.equal(tooLong.status, 400);
  });
});

test("Gemini proxy advertises its key source and never echoes the key", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.gemini.route, "/api/gemini");
    assert.equal(health.gemini.keySource, "client");
    assert.equal(health.gemini.requiresApiKey, true);
  });

  await withServer({ NOVACORE_GEMINI_API_KEY: "server-side-gemini-key" }, async (baseUrl) => {
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.gemini.keySource, "server");
    assert.equal(health.gemini.requiresApiKey, false);

    // With a server key configured the proxy must not reject a request for lacking a client key.
    const response = await postJson(baseUrl, "/api/gemini", { prompt: "Explain gravity in one sentence." });
    assert.notEqual(response.status, 401);
    if (!response.ok) {
      const payload = await response.json();
      assert.doesNotMatch(payload.error, /server-side-gemini-key/);
    }
  });
});

test("search proxy validates queries and blocks adult terms before contacting DuckDuckGo", async () => {
  await withServer({}, async (baseUrl) => {
    const blocked = await postJson(baseUrl, "/api/search", { query: "porn sites" });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /adult-content filter/);

    const empty = await postJson(baseUrl, "/api/search", { query: "   " });
    assert.equal(empty.status, 400);

    const foreign = await postJson(baseUrl, "/api/search", { query: "astronomy" }, { Origin: "https://evil.example.net" });
    assert.equal(foreign.status, 403);
  });
});

test("parses DuckDuckGo HTML results into the /api/search payload shape", () => {
  const html = `
    <div class="result results_links">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstory&amp;rut=abc">Example &amp; Story</a>
      </h2>
      <a class="result__snippet" href="#">A short <b>summary</b> of the page.</a>
      <a class="result__url" href="#">example.com/story</a>
    </div>`;

  const results = parseDuckDuckGoWebResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/story");
  assert.equal(results[0].title, "Example & Story");
  assert.equal(results[0].description, "A short summary of the page.");
  assert.equal(results[0].source, "example.com/story");
});

test("maps instant answers and drops unsafe URLs", () => {
  const results = mapDuckDuckGoInstantAnswer({
    Heading: "Night sky",
    AbstractText: "The night sky shows stars and planets.",
    AbstractURL: "https://example.org/night-sky",
    AbstractSource: "Example Reference",
    RelatedTopics: [
      { FirstURL: "javascript:alert(1)", Text: "Unsafe" },
      { FirstURL: "https://example.org/stars", Text: "Stars" },
    ],
  });
  assert.deepEqual(results.map((result) => result.url), [
    "https://example.org/night-sky",
    "https://example.org/stars",
  ]);
  assert.equal(results[0].source, "Example Reference");
});
