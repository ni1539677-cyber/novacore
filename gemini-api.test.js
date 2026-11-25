const test = require("node:test");
const assert = require("node:assert/strict");
const { generateGeminiResponse } = require("./gemini-api");

test("generates a grounded Gemini answer and validates HTTPS sources", async () => {
  let request;
  const result = await generateGeminiResponse({
    apiKey: "test-api-key-123",
    prompt: "What changed recently?",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({
        candidates: [{
          content: { parts: [{ text: "A current answer." }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "Source", uri: "https://example.com/article" } },
              { web: { title: "Insecure", uri: "http://example.com/" } },
              { web: { title: "Duplicate", uri: "https://example.com/article" } },
            ],
          },
        }],
      });
    },
  });

  assert.match(request.url, /gemini-2\.5-flash:generateContent/);
  assert.equal(request.options.headers["x-goog-api-key"], "test-api-key-123");
  assert.match(request.options.body, /google_search/);
  assert.equal(result.text, "A current answer.");
  assert.deepEqual(result.sources, [{ title: "Source", url: "https://example.com/article" }]);
});

test("reports invalid keys and provider errors without exposing the key", async () => {
  await assert.rejects(
    generateGeminiResponse({ apiKey: "", prompt: "Hello" }),
    /Add a valid Google Gemini API key/,
  );
  await assert.rejects(
    generateGeminiResponse({
      apiKey: "test-api-key-123",
      prompt: "Hello",
      fetchImpl: async () => Response.json({
        error: { message: "Invalid key: test-api-key-123" },
      }, { status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /rejected this API key/);
      assert.doesNotMatch(error.message, /test-api-key-123/);
      return true;
    },
  );
});
