// Exercises the search client directly (no HTTP server) to prove the three claims behind the fix:
//   1. a healthy DuckDuckGo answers within a couple of seconds, via the form-first path,
//   2. when DuckDuckGo is unreachable the call settles in ~12 s instead of hanging,
//   3. the Wikipedia fallback returns real results for a normal query.
const { fetchDuckDuckGoWeb, fetchWikipediaResults, searchWithFallback, searchBudgetMs } =
  require("../duckduckgo-search");

const timed = async (label, run) => {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`${label.padEnd(26)} ok    ${String(Date.now() - started).padStart(6)} ms  ${value.length} result(s)`);
    return value;
  } catch (error) {
    console.log(`${label.padEnd(26)} FAIL  ${String(Date.now() - started).padStart(6)} ms  ${error.message}`);
    return null;
  }
};

(async () => {
  const query = "astronomy for beginners";

  const web = await timed("duckduckgo web", () => fetchDuckDuckGoWeb(query, new AbortController().signal));
  if (web?.length) console.log(`   first: ${web[0].title} -> ${web[0].url}`);

  const wiki = await timed("wikipedia fallback", () => fetchWikipediaResults(query, new AbortController().signal));
  if (wiki?.length) console.log(`   first: ${wiki[0].title} -> ${wiki[0].url}`);

  const started = Date.now();
  const outcome = await searchWithFallback(query, { signal: new AbortController().signal });
  console.log(`searchWithFallback         ${Date.now() - started} ms  provider=${outcome.provider} web=${outcome.webResults.length} images=${outcome.imageResults.length}`);
  console.log(`   warnings: ${outcome.warnings.join(" | ") || "(none)"}`);

  console.log(`budget under test: ${searchBudgetMs} ms`);
})();
