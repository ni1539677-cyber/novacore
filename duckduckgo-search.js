// Shared DuckDuckGo client.
//
// Used by three callers that must behave identically:
//   server.js         -> the local /api/search proxy (npm start, hosted deploy)
//   desktop-main.js   -> the Electron main process (search IPC for the packaged .exe)
//   api/_proxy.js     -> the serverless adapters
// It therefore owns the parsing, the strict SafeSearch (`kp=1`) request, and URL validation. The
// packaged apps only require this file, never server.js, whose HTTP listener and static map are
// irrelevant to them.

const maxResults = 8;
// Two clocks, because Render's egress is slow to reach DuckDuckGo:
//   requestTimeoutMs - one upstream response. Short enough that a dead endpoint fails fast.
//   searchBudgetMs   - the whole web search (every endpoint + instant-answer fallback).
// The old code had only a 10 s per-request timeout and tried three endpoints one after another, so a
// blocked egress could spend ~31 s before answering; clients gave up first and showed "Searching...".
const requestTimeoutMs = 8_000;
const searchBudgetMs = 12_000;
const imageBudgetMs = 9_000;
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Headers a real browser sends when it submits the search form. DuckDuckGo's html endpoint is HTML
// form-first, so it prefers POST with a form body; the GET variant is kept as a fallback below.
const browserHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": userAgent,
};

const withBudget = (signal, budgetMs) => {
  const timer = AbortSignal.timeout(budgetMs);
  return signal ? AbortSignal.any([signal, timer]) : timer;
};

function cleanText(value, maxLength = 1_000) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function safeWebUrl(value) {
  if (typeof value !== "string" || value.length > 4_096) return "";
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const number = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(number) && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : match;
    })
    .replace(/&([a-z]+);/gi, (match, entity) => named[entity.toLowerCase()] || match);
}

function stripHtml(value) {
  return cleanText(decodeHtml(value.replace(/<[^>]*>/g, " ")), 1_200);
}

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] || "";
}

function canonicalDuckDuckGoUrl(value) {
  if (typeof value !== "string" || value.length > 4_096) return "";
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const redirectedUrl = url.searchParams.get("uddg");
    return safeWebUrl(redirectedUrl || url.href);
  } catch {
    return "";
  }
}

function parseDuckDuckGoWebResults(html) {
  const results = [];
  const titleMatches = [...html.matchAll(/<a\b[^>]*\bclass=["'][^"']*\b(?:result__a|result-link)\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)];
  for (let index = 0; index < titleMatches.length && results.length < maxResults; index += 1) {
    const titleMatch = titleMatches[index];
    const titleTag = titleMatch[0].slice(0, titleMatch[0].indexOf(">") + 1);
    const url = canonicalDuckDuckGoUrl(getAttribute(titleTag, "href"));
    if (!url) continue;

    const nextResultStart = titleMatches[index + 1]?.index ?? html.length;
    const afterTitle = html.slice(titleMatch.index + titleMatch[0].length, nextResultStart);
    const snippetMatch = afterTitle.match(/<(a|div|td)\b(?=[^>]*\bclass=["'][^"']*\b(?:result__snippet|result-snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/i);
    const sourceMatch = afterTitle.match(/<(?:a|span)\b(?=[^>]*\bclass=["'][^"']*\bresult__url\b[^"']*["'])[^>]*>([\s\S]*?)<\/(?:a|span)>/i);
    results.push({
      title: stripHtml(titleMatch[0].slice(titleMatch[0].indexOf(">") + 1, titleMatch[0].lastIndexOf("</a>"))) || url,
      url,
      description: snippetMatch ? stripHtml(snippetMatch[2]) : "",
      source: sourceMatch ? stripHtml(sourceMatch[1]) : new URL(url).hostname,
    });
  }
  return results;
}

function mapDuckDuckGoInstantAnswer(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const results = [];
  const abstractUrl = safeWebUrl(payload.AbstractURL);
  if (abstractUrl && payload.AbstractText) {
    results.push({
      title: cleanText(payload.Heading, 300) || cleanText(payload.AbstractSource, 120) || abstractUrl,
      url: abstractUrl,
      description: cleanText(payload.AbstractText, 1_200),
      source: cleanText(payload.AbstractSource, 120) || new URL(abstractUrl).hostname,
    });
  }

  const addTopics = (topics) => {
    if (!Array.isArray(topics)) return;
    for (const topic of topics) {
      if (results.length >= maxResults) return;
      if (Array.isArray(topic?.Topics)) {
        addTopics(topic.Topics);
        continue;
      }
      const url = safeWebUrl(topic?.FirstURL);
      if (!url || !topic?.Text) continue;
      results.push({
        title: cleanText(topic.Text, 300) || url,
        url,
        description: cleanText(topic.Text, 1_200),
        source: new URL(url).hostname,
      });
    }
  };
  addTopics(payload.RelatedTopics);
  return results;
}

function mapDuckDuckGoImageResults(payload) {
  const results = payload?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, maxResults).flatMap((result) => {
    const imageUrl = safeWebUrl(result?.image) || safeWebUrl(result?.properties?.url);
    const thumbnailUrl = safeWebUrl(result?.thumbnail) ||
      safeWebUrl(result?.thumbnail?.src) ||
      imageUrl;
    const pageUrl = safeWebUrl(result?.url) || imageUrl;
    if (!imageUrl || !thumbnailUrl || !pageUrl) return [];
    return [{
      title: cleanText(result.title, 300) || "Untitled image",
      pageUrl,
      imageUrl,
      thumbnailUrl,
      source: cleanText(result.source, 120) || cleanText(result.publisher, 120) || new URL(pageUrl).hostname,
      width: Number.isSafeInteger(result.width) ? result.width : null,
      height: Number.isSafeInteger(result.height) ? result.height : null,
    }];
  });
}

async function fetchDuckDuckGo(url, signal, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...browserHeaders,
        ...(options.headers || {}),
      },
      redirect: "follow",
      signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    const error = new Error(
      cause?.name === "TimeoutError"
        ? "DuckDuckGo did not respond in time."
        : "Could not connect to DuckDuckGo.",
    );
    error.status = 502;
    error.code = cause?.name === "TimeoutError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE";
    throw error;
  }
  if (!response.ok && response.status !== 202) {
    const error = new Error(response.status === 429
      ? "DuckDuckGo is temporarily rate-limiting searches. Wait a moment and try again."
      : `DuckDuckGo search failed (HTTP ${response.status}).`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return response;
}

function isDuckDuckGoChallenge(html) {
  return /anomaly\.js|complete this challenge|select all squares|botnet|captcha/i.test(html);
}

// ads (duckduckgo.com/y.js redirects) are not organic results: they are labelled as ads and their
// "url" is a click tracker, so they are dropped instead of shown as sources.
function isOrganicResult(result) {
  let host = "";
  try {
    host = new URL(result.url).hostname;
  } catch {
    return false;
  }
  return host !== "duckduckgo.com" && host !== "www.duckduckgo.com" && !/y\.js$/.test(result.url);
}

async function fetchDuckDuckGoWeb(query, signal) {
  const budget = withBudget(signal, searchBudgetMs);
  const upstreamErrors = [];

  // Form-first endpoints, then the lite GET variant. Each attempt is bounded by requestTimeoutMs and
  // the whole loop by searchBudgetMs, so a blocked egress fails in ~12 s instead of hanging.
  const attempts = [
    { url: "https://html.duckduckgo.com/html/", method: "POST" },
    { url: "https://html.duckduckgo.com/html/", method: "GET" },
    { url: "https://lite.duckduckgo.com/lite/", method: "POST" },
  ];
  for (const attempt of attempts) {
    if (budget.aborted) break;
    try {
      const url = new URL(attempt.url);
      const init = { method: attempt.method };
      if (attempt.method === "POST") {
        init.body = new URLSearchParams({ q: query, kp: "1", kl: "us-en" }).toString();
        init.headers = {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://html.duckduckgo.com/",
        };
      } else {
        url.searchParams.set("q", query);
        url.searchParams.set("kp", "1");
        url.searchParams.set("kl", "us-en");
      }
      const response = await fetchDuckDuckGo(url, budget, init);
      const html = await response.text();
      if (response.status === 202 || isDuckDuckGoChallenge(html)) {
        const error = new Error("DuckDuckGo is asking to verify this search.");
        error.status = 503;
        throw error;
      }
      // An answer that carries no result markup is a real answer: stop here instead of spending the
      // rest of the budget on slower endpoints (the ads-only page is now detected).
      if (response.status === 200 && /result__a|result-link/.test(html)) {
        const results = parseDuckDuckGoWebResults(html).filter(isOrganicResult);
        if (results.length) return results;
        // Only ad results were present: fall through to the next attempt.
      }
      if (!/<(?:!doctype\s+html|html|title)\b/i.test(html)) {
        const error = new Error("DuckDuckGo returned an unreadable search page.");
        error.status = 502;
        throw error;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      upstreamErrors.push(error);
    }
  }

  try {
    if (budget.aborted) throw Object.assign(new Error("Search budget exhausted."), { status: 502 });
    const instantUrl = new URL("https://api.duckduckgo.com/");
    instantUrl.searchParams.set("q", query);
    instantUrl.searchParams.set("kp", "1");
    instantUrl.searchParams.set("format", "json");
    instantUrl.searchParams.set("no_html", "1");
    instantUrl.searchParams.set("no_redirect", "1");
    const response = await fetchDuckDuckGo(instantUrl, budget, {
      headers: { Accept: "application/json", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors" },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw Object.assign(new Error("DuckDuckGo returned unreadable instant-answer data."), { status: 502 });
    }
    const results = mapDuckDuckGoInstantAnswer(payload);
    if (results.length) return results;
  } catch (error) {
    if (signal.aborted) throw error;
    upstreamErrors.push(error);
  }

  // DuckDuckGo answered but has no organic results for this query: an honest empty list, not an error
  // (a network failure is marked UPSTREAM_TIMEOUT / UPSTREAM_UNREACHABLE and becomes a fallback).
  const unreachable = upstreamErrors.find((error) =>
    error.code === "UPSTREAM_TIMEOUT" || error.code === "UPSTREAM_UNREACHABLE");
  if (!unreachable) return [];
  const message = upstreamErrors.find((error) => error.status === 503)?.message ||
    upstreamErrors.find((error) => error.message)?.message ||
    "DuckDuckGo could not return search results. Try again later.";
  throw Object.assign(new Error(message), {
    status: upstreamErrors.some((error) => error.status === 503) ? 503 : 502,
    code: upstreamErrors.some((error) => error.code === "UPSTREAM_TIMEOUT") ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE",
  });
}

async function fetchDuckDuckGoImages(query, signal) {
  // Image search is a bonus rail: it gets its own shorter budget so a slow image provider can never
  // hold up (or fail) the web results the user actually asked for.
  const budget = withBudget(signal, imageBudgetMs);
  // DuckDuckGo answers 403 when an image search follows a web search immediately (the token is bound
  // to the landing-page session). One fresh attempt recovers most of those without user impact.
  try {
    return await fetchDuckDuckGoImagesOnce(query, budget);
  } catch (error) {
    if (budget.aborted || error.status !== 403) throw error;
    await new Promise((done) => setTimeout(done, 800));
    if (budget.aborted) throw error;
    return fetchDuckDuckGoImagesOnce(query, budget);
  }
}

async function fetchDuckDuckGoImagesOnce(query, budget) {
  const landingUrl = new URL("https://duckduckgo.com/");
  landingUrl.searchParams.set("q", query);
  landingUrl.searchParams.set("kp", "1");
  landingUrl.searchParams.set("iax", "images");
  landingUrl.searchParams.set("ia", "images");
  const landingResponse = await fetchDuckDuckGo(landingUrl, budget);
  const html = await landingResponse.text();
  if (landingResponse.status === 202 || isDuckDuckGoChallenge(html)) {
    const error = new Error("DuckDuckGo image search requires verification right now.");
    error.status = 503;
    throw error;
  }
  const token = html.match(/\bvqd\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (!token) {
    const error = new Error("DuckDuckGo did not provide an image-search token.");
    error.status = 502;
    throw error;
  }

  const imageUrl = new URL("https://duckduckgo.com/i.js");
  imageUrl.searchParams.set("l", "us-en");
  imageUrl.searchParams.set("o", "json");
  imageUrl.searchParams.set("q", query);
  imageUrl.searchParams.set("kp", "1");
  imageUrl.searchParams.set("vqd", token);
  imageUrl.searchParams.set("f", ",,,");
  imageUrl.searchParams.set("p", "1");
  const imageResponse = await fetchDuckDuckGo(imageUrl, budget, {
    headers: {
      // A JSON API call, not a page navigation: the Sec-Fetch-* / Accept defaults would make
      // DuckDuckGo answer with an HTML page instead of i.js JSON.
      Accept: "application/json, text/javascript;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://duckduckgo.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  let payload;
  try {
    payload = await imageResponse.json();
  } catch {
    const error = new Error("DuckDuckGo returned unreadable image-search data.");
    error.status = 502;
    throw error;
  }
  if (!Array.isArray(payload?.results)) {
    const error = new Error("DuckDuckGo returned unexpected image-search data.");
    error.status = 502;
    throw error;
  }
  return mapDuckDuckGoImageResults(payload);
}

// Fallback web search for hosts whose egress cannot reach DuckDuckGo (Render's free tier commonly
// blocks or throttles it, and the user then sees only "Search unavailable"). Wikipedia's action API
// is a documented, key-free, CORS-friendly endpoint that answers fast from any network, so it is the
// source of last resort: real pages with real titles and summaries, clearly labelled as such.
const fallbackBudgetMs = 8_000;
const fallbackUserAgent = "NovaCore/1.0 (fallback search; https://novacore-0ik3.onrender.com)";
const maxFallbackResults = 6;
const stopWords = new Set(["a", "an", "the", "for", "of", "in", "on", "to", "with", "and", "or", "best", "how", "what", "why", "is", "are", "guide", "tutorial", "beginners", "beginner"]);

// Wikipedia ranks full-text matches, so a long natural-language query is dominated by filler words.
// Keeping the first few meaningful terms makes the top hit the actual subject.
function searchTerms(query) {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const meaningful = words.filter((word) => !stopWords.has(word));
  const terms = (meaningful.length ? meaningful : words).slice(0, 3).join(" ");
  return terms || query;
}

async function fetchWikipediaResults(query, signal) {
  const budget = withBudget(signal, fallbackBudgetMs);
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("list", "search");
  // Rank by the query's leading words: "astronomy for beginners" should lead with the Astronomy
  // article, not with any page that merely mentions those words (full-text search put a poet first).
  url.searchParams.set("srsearch", searchTerms(query));
  url.searchParams.set("srlimit", String(maxFallbackResults));
  url.searchParams.set("srinfo", "");
  url.searchParams.set("srprop", "snippet|timestamp");

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": fallbackUserAgent },
      signal: budget,
    });
  } catch (cause) {
    throw Object.assign(
      new Error(cause?.name === "TimeoutError" ? "Backup search timed out." : "Backup search unreachable."),
      { status: 502, code: "FALLBACK_FAILED" },
    );
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Backup search failed (HTTP ${response.status}).`), { status: 502, code: "FALLBACK_FAILED" });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("Backup search returned unreadable data."), { status: 502, code: "FALLBACK_FAILED" });
  }

  const hits = Array.isArray(payload?.query?.search) ? payload.query.search : [];
  return hits.slice(0, maxFallbackResults).flatMap((hit) => {
    if (typeof hit?.title !== "string" || !hit.title.trim()) return [];
    const title = hit.title.trim().slice(0, 300);
    const pageUrl = safeWebUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (!pageUrl) return [];
    return [{
      title,
      url: pageUrl,
      description: stripHtml(hit.snippet || ""),
      source: "Wikipedia",
    }];
  });
}

/**
 * Searches DuckDuckGo. When every DuckDuckGo endpoint fails, falls back to Wikipedia so the route
 * still returns usable results instead of an error.
 *
 * Returns { webResults, imageResults, warnings, provider } where provider names the source that
 * actually answered ("DuckDuckGo" or "Wikipedia") and warnings explain any degradation to the user.
 */
async function searchWithFallback(query, { signal, imageSignal } = {}) {
  const web = await fetchDuckDuckGoWeb(query, signal).then(
    (results) => ({ results, error: null }),
    (error) => ({ results: [], error }),
  );

  if (web.error) {
    try {
      const results = await fetchWikipediaResults(query, signal);
      if (results.length) {
        return {
          provider: "Wikipedia",
          webResults: results,
          imageResults: [],
          warnings: [
            "DuckDuckGo was unreachable from this server, so these general-knowledge results come from Wikipedia.",
            "Image search is unavailable while DuckDuckGo cannot be reached.",
          ],
        };
      }
    } catch {
      // Fall through: report the DuckDuckGo failure in the thrown error below.
    }
    throw web.error;
  }

  // DuckDuckGo answered for the web, so images are a bonus rail with their own deadline.
  const images = await fetchDuckDuckGoImages(query, imageSignal || signal).then(
    (results) => ({ results, error: null }),
    (error) => ({ results: [], error }),
  );

  return {
    provider: "DuckDuckGo",
    webResults: web.results,
    imageResults: images.results,
    warnings: images.error ? [`Image results unavailable: ${images.error.message || "DuckDuckGo image search failed."}`] : [],
  };
}

module.exports = {
  fetchDuckDuckGo,
  fetchDuckDuckGoWeb,
  fetchDuckDuckGoImages,
  fetchWikipediaResults,
  searchWithFallback,
  isDuckDuckGoChallenge,
  parseDuckDuckGoWebResults,
  mapDuckDuckGoInstantAnswer,
  mapDuckDuckGoImageResults,
  safeWebUrl,
  cleanText,
  maxResults,
  requestTimeoutMs,
  searchBudgetMs,
};
