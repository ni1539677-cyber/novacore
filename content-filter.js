(function attachContentFilter(root, createFilter) {
  const filter = createFilter();
  if (typeof module === "object" && module.exports) module.exports = filter;
  if (root) root.NovaCoreContentFilter = filter;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const blockedTerms = [
    "18 plus",
    "18 and over",
    "adult",
    "bdsm",
    "cam girl",
    "camgirl",
    "cam boy",
    "camboy",
    "explicit",
    "erotic",
    "escort",
    "fetish",
    "hentai",
    "incest",
    "masturbat",
    "mature content",
    "naked",
    "nsfw",
    "nude",
    "nudity",
    "onlyfans",
    "orgasm",
    "porn",
    "prostitut",
    "sex",
    "stripper",
    "uncensored",
    "xxx",
    "অশ্লীল",
    "নগ্ন",
    "পর্ন",
    "যৌন",
    "সেক্স",
  ];

  const normalize = (value) => value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/18\s*\+/g, "18 plus")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  const containsBlockedTerm = (value) => {
    if (typeof value !== "string" || !value) return false;
    const normalized = normalize(value);
    if (!normalized) return false;
    const compact = normalized.replace(/\s+/g, "");

    return blockedTerms.some((term) => {
      const normalizedTerm = normalize(term);
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])${normalizedTerm.replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`,
        "u",
      );
      if (pattern.test(normalized)) return true;
      const compactTerm = normalizedTerm.replace(/\s+/g, "");
      return /^[a-z0-9]+$/.test(compactTerm) &&
        compactTerm.length >= 4 &&
        compact.includes(compactTerm);
    });
  };

  return {
    blockedMessage: "This search was blocked by NovaCore's built-in adult-content filter. Strict SafeSearch is always on.",
    containsBlockedTerm,
  };
});
