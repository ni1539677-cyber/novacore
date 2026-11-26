"use strict";

// Native on-device DuckDuckGo search for the packaged Android app.
//
// The app loads from file:///android_asset/index.html, so /api/search is not a reachable URL and
// no localhost server exists on the phone. MainActivity instead exposes
// window.NovaCoreAndroidSearch.search(query), which performs the request in Java.
//
// renderer.js calls window.novaCoreSearch.search(query) and expects a parsed object. The native
// bridge returns a JSON string on success and a plain error string on failure; both are handled.
(function attachAndroidSearch() {
  const bridge = window.NovaCoreAndroidSearch;
  if (!bridge || typeof bridge.search !== "function") return;

  const asError = (value) => {
    const message = typeof value === "string" ? value.trim() : "";
    return new Error(message || "DuckDuckGo could not complete the search. Check the connection and try again.");
  };

  const parsePayload = (value) => {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") throw asError(value);
    try {
      return JSON.parse(value);
    } catch {
      throw asError(value);
    }
  };

  const pickText = (value) => (typeof value === "string" ? value : "");

  const webResults = (payload) => (Array.isArray(payload.webResults) ? payload.webResults : []).map((item) => ({
    title: pickText(item?.title),
    url: pickText(item?.url),
    description: pickText(item?.description),
    source: pickText(item?.source),
  }));

  const imageResults = (payload) => (Array.isArray(payload.imageResults) ? payload.imageResults : []).map((item) => ({
    title: pickText(item?.title),
    pageUrl: pickText(item?.pageUrl),
    imageUrl: pickText(item?.imageUrl),
    thumbnailUrl: pickText(item?.thumbnailUrl) || pickText(item?.imageUrl),
    source: pickText(item?.source),
  }));

  let lastNativeError = "";
  try {
    if (typeof bridge.getLastSearchError === "function") {
      lastNativeError = String(bridge.getLastSearchError() || "");
    }
  } catch {
    lastNativeError = "";
  }

  Object.defineProperty(window, "novaCoreSearch", {
    configurable: true,
    value: Object.freeze({
      provider: "DuckDuckGo",
      native: true,
      async search(query) {
        let raw;
        try {
          raw = await bridge.search(query);
        } catch (error) {
          // A JavaScript-side failure (method not resolved, page error) still reports a reason.
          throw asError(error instanceof Error ? error.message : lastNativeError);
        }
        const payload = parsePayload(raw);
        return {
          provider: "DuckDuckGo",
          query,
          webResults: webResults(payload),
          imageResults: imageResults(payload),
          warnings: Array.isArray(payload.warnings)
            ? payload.warnings.filter((warning) => typeof warning === "string")
            : [],
        };
      },
    }),
  });
})();

// Gemini for the packaged Android app.
//
// The page is file://, so a fetch() to the hosted /api/gemini is cross-origin with Origin: null and
// would depend on the host allowing "null" in NOVACORE_PUBLIC_ORIGIN. MainActivity performs the call
// in Java instead (server-to-server), hitting https://novacore-0ik3.onrender.com/api/gemini first and
// falling back to Google directly. The renderer calls this only when window.NovaCoreGemini is absent,
// i.e. in the packaged app whose page cannot reach the proxy itself.
(function attachAndroidGemini() {
  const bridge = window.NovaCoreAndroidGemini;
  if (!bridge || typeof bridge.generate !== "function") return;
  if (window.NovaCoreGemini && typeof window.NovaCoreGemini.generateGeminiResponse === "function") return;

  const asError = (value, status) => {
    const message = typeof value === "string" ? value.trim() : "";
    const error = new Error(message || "Gemini could not generate an answer. Try again.");
    if (status) error.status = status;
    return error;
  };

  const sources = (value) => (Array.isArray(value) ? value : []).flatMap((item) => {
    const url = typeof item?.url === "string" ? item.url : "";
    if (!/^https:\/\//i.test(url)) return [];
    return [{ title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url, url }];
  });

  const generateGeminiResponse = async ({ apiKey, prompt } = {}) => {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
      throw asError("Enter a prompt between 1 and 4,000 characters.", 400);
    }
    if (typeof apiKey !== "string" || apiKey.trim().length < 10 || apiKey.length > 512) {
      throw asError("Add a valid Google Gemini API key in Gemini AI settings.", 401);
    }
    let raw;
    try {
      raw = await bridge.generate(prompt.trim(), apiKey.trim());
    } catch (error) {
      throw asError(error instanceof Error ? error.message : "");
    }
    let payload;
    if (raw && typeof raw === "object") payload = raw;
    else if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw asError(raw);
      }
    } else {
      throw asError("");
    }
    if (typeof payload.error === "string" && payload.error) throw asError(payload.error, 502);
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) throw asError("Google Gemini returned no answer. Try rephrasing the prompt.");
    return { text, sources: sources(payload.sources), provider: typeof payload.provider === "string" ? payload.provider : "" };
  };

  Object.defineProperty(window, "NovaCoreGemini", {
    configurable: true,
    value: Object.freeze({ native: true, generateGeminiResponse }),
  });
})();
