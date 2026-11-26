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
const requestTimeoutMs = 10_000;
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

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

async function fetchDuckDuckGo(url, signal) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/html,application/json",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": userAgent,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    const error = new Error(
      cause?.name === "TimeoutError"
        ? "DuckDuckGo took too long to respond. Try again."
        : "Could not connect to DuckDuckGo. Check the network connection and try again.",
    );
    error.status = 502;
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

async function fetchDuckDuckGoWeb(query, signal) {
  const upstreamErrors = [];
  let validHtmlResponse = false;
  for (const endpoint of ["https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/"]) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("kp", "1");
      const response = await fetchDuckDuckGo(url, signal);
      const html = await response.text();
      if (response.status === 202 || isDuckDuckGoChallenge(html)) {
        const error = new Error("DuckDuckGo is asking to verify this search.");
        error.status = 503;
        throw error;
      }

      if (!/<(?:!doctype\s+html|html|title)\b/i.test(html)) {
        const error = new Error("DuckDuckGo returned an unreadable search page.");
        error.status = 502;
        throw error;
      }
      validHtmlResponse = true;
      const results = parseDuckDuckGoWebResults(html);
      if (results.length) return results;
    } catch (error) {
      if (signal.aborted) throw error;
      upstreamErrors.push(error);
    }
  }

  try {
    const instantUrl = new URL("https://api.duckduckgo.com/");
    instantUrl.searchParams.set("q", query);
    instantUrl.searchParams.set("kp", "1");
    instantUrl.searchParams.set("format", "json");
    instantUrl.searchParams.set("no_html", "1");
    instantUrl.searchParams.set("no_redirect", "1");
    const response = await fetchDuckDuckGo(instantUrl, signal);
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

  if (validHtmlResponse) return [];
  const message = upstreamErrors.find((error) => error.status === 503)?.message ||
    upstreamErrors.find((error) => error.message)?.message ||
    "DuckDuckGo could not return search results. Try again later.";
  throw Object.assign(new Error(message), { status: upstreamErrors.some((error) => error.status === 503) ? 503 : 502 });
}

async function fetchDuckDuckGoImages(query, signal) {
  const landingUrl = new URL("https://duckduckgo.com/");
  landingUrl.searchParams.set("q", query);
  landingUrl.searchParams.set("kp", "1");
  landingUrl.searchParams.set("iax", "images");
  landingUrl.searchParams.set("ia", "images");
  const landingResponse = await fetchDuckDuckGo(landingUrl, signal);
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
  const imageResponse = await fetchDuckDuckGo(imageUrl, signal);
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

module.exports = {
  fetchDuckDuckGo,
  fetchDuckDuckGoWeb,
  fetchDuckDuckGoImages,
  isDuckDuckGoChallenge,
  parseDuckDuckGoWebResults,
  mapDuckDuckGoInstantAnswer,
  mapDuckDuckGoImageResults,
  safeWebUrl,
  cleanText,
  maxResults,
};
