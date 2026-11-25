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
