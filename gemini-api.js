const endpoint =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const readJsonResponse = async (response) => {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Google Gemini returned an unreadable response.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Google Gemini returned an unexpected response.");
  }
  return payload;
};

const getGroundingSources = (candidate) => {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const sources = new Map();
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (typeof uri !== "string") continue;
    let url;
    try {
      url = new URL(uri);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || sources.has(url.href)) continue;
    sources.set(url.href, {
      title: typeof chunk.web.title === "string" && chunk.web.title.trim()
        ? chunk.web.title.trim()
        : url.hostname,
      url: url.href,
    });
  }
  return [...sources.values()].slice(0, 8);
};

const generateGeminiResponse = async ({ apiKey, prompt, fetchImpl = globalThis.fetch }) => {
  if (typeof apiKey !== "string" || apiKey.trim().length < 10 || apiKey.length > 512) {
    throw new Error("Add a valid Google Gemini API key in Gemini AI settings.");
  }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    throw new Error("Enter a prompt between 1 and 4,000 characters.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Network requests are unavailable in this app environment.");
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "Answer the user's request clearly and accurately. Use Google Search grounding for current or factual claims, and say when reliable information is unavailable. Include useful detail without inventing citations. Respond in the language of the user's prompt.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: prompt.trim() }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
  } catch {
    throw new Error("Could not connect to Google Gemini. Check your internet connection and try again.");
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const detail = payload.error && typeof payload.error.message === "string"
      ? payload.error.message.replaceAll(apiKey, "[redacted]")
      : "";
    if (response.status === 401 || response.status === 403) {
      throw new Error("Google Gemini rejected this API key. Check that the key is valid and Gemini API access is enabled.");
    }
    if (response.status === 429) {
      throw new Error("Google Gemini's usage limit was reached. Check your quota or try again later.");
    }
    throw new Error(`Google Gemini request failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
  }

  const candidate = Array.isArray(payload.candidates) ? payload.candidates[0] : null;
  const text = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim()
    : "";
  if (!text) {
    const blockReason = payload.promptFeedback?.blockReason;
    throw new Error(blockReason
      ? `Google Gemini could not answer this prompt (${blockReason}).`
      : "Google Gemini returned no answer. Try rephrasing the prompt.");
  }

  return { text, sources: getGroundingSources(candidate) };
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { generateGeminiResponse };
}
if (typeof window !== "undefined") {
  window.NovaCoreGemini = Object.freeze({ generateGeminiResponse });
}
