const legacyAccountStorageKey = "novacore.id.accounts.v1";
const sessionStorageKey = "novacore.id.session.v1";
// Persistent login state is kept in localStorage (unlike the tab-scoped session above) so a
// NovaCore ID survives closing the browser.
const loginStateStorageKey = "novacore.id.login.v1";
const rememberedLoginStorageKey = "novacore.id.rememberedLogin.v1";
const thoughtStorageKey = "novacore.id.thought.v1";
const workspaceTabsStorageKey = "novacore.workspace.tabs.v1";
const localDatabaseName = "novacore-local";
const localDatabaseVersion = 1;
const maxTabHistory = 30;
const maxSearchResults = 8;
// The API can live on a different origin than the page (static hosting + hosted proxy).
//
// Pages served by NovaCore itself, and every packaged build (the Electron .exe and the Android
// .apk both load from file://), use the live production server unless novacore-config.js sets
// window.NOVACORE_API_BASE. A page served from anywhere else keeps its own origin, because a
// different site is still refused there by the server's origin check.
const liveApiBaseUrl = "https://novacore-0ik3.onrender.com";
const isDesktopShell = typeof location !== "undefined" && location.protocol === "file:";
const pageHostname = typeof location === "undefined" ? "" : String(location.hostname || "").toLowerCase();
// `npm start` serves /api/* from the same origin, so it must keep relative URLs.
const isLocalDevServer = pageHostname === "localhost" || pageHostname === "127.0.0.1" ||
  pageHostname === "::1" || pageHostname === "[::1]" || pageHostname === "0.0.0.0";
// A NovaCore-hosted page (e.g. on Render) talks to the live server it is served from.
const isNovaCoreHostedPage = !isLocalDevServer && pageHostname.endsWith(".onrender.com");
const apiBaseUrl = (() => {
  const configured = typeof window.NOVACORE_API_BASE === "string" ? window.NOVACORE_API_BASE.trim() : "";
  if (configured) {
    try {
      const url = new URL(configured, location.href);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Fall through to the default below instead of leaving the app with no API.
    }
  }
  if (isLocalDevServer) return "";
  return isDesktopShell || isNovaCoreHostedPage ? liveApiBaseUrl : "";
})();
const apiEndpointLabel = apiBaseUrl || location.origin;
const geminiProxyPath = `${apiBaseUrl}/api/gemini`;
const searchProxyPath = `${apiBaseUrl}/api/search`;
const searchProxyTimeoutMs = 25_000;
const passwordIterations = 600000;
const legacyPasswordIterations = 210000;
const encoder = new TextEncoder();

const authView = document.querySelector("#auth-view");
const workspaceView = document.querySelector("#workspace-view");
const installAppButton = document.querySelector("#install-app");
const installStatus = document.querySelector("#install-status");
const accountForm = document.querySelector("#account-form");
const accountName = document.querySelector("#account-name");
const accountEmail = document.querySelector("#account-email");
const accountPassword = document.querySelector("#account-password");
const accountConfirm = document.querySelector("#account-confirm");
const nameField = document.querySelector("#name-field");
const confirmField = document.querySelector("#confirm-field");
const passwordHint = document.querySelector("#password-hint");
const formMessage = document.querySelector("#form-message");
const accountSubmit = document.querySelector("#account-submit");
const submitLabel = document.querySelector("#submit-label");
const memberName = document.querySelector("#member-name");
const memberId = document.querySelector("#member-id");
const memberLabel = document.querySelector("#member-label");
const assistantEngineStatus = document.querySelector("#assistant-engine-status");
const assistantEngineDetail = document.querySelector("#assistant-engine-detail");
const searchEngineStatus = document.querySelector("#search-engine-status");
const searchEngineDetail = document.querySelector("#search-engine-detail");
const signoutButton = document.querySelector("#signout-button");
const promptInput = document.querySelector("#prompt-input");
const promptNotice = document.querySelector("#prompt-notice");
const promptForm = document.querySelector("#prompt-form");
const composeThoughtButton = document.querySelector("#compose-thought");
const voiceLanguage = document.querySelector("#voice-language");
const voiceInputButton = document.querySelector("#voice-input");
const voiceStatus = document.querySelector("#voice-status");
const speakResponseButton = document.querySelector("#speak-response");
const localResponse = document.querySelector("#local-response");
const responseTitle = document.querySelector("#response-title");
const responsePrompt = document.querySelector("#response-prompt");
const responseIntro = document.querySelector("#response-intro");
const responseSources = document.querySelector("#response-sources");
const responseSourceList = document.querySelector("#response-source-list");
const responseSteps = document.querySelector("#response-steps");
const responseCode = document.querySelector("#response-code");
const responseCodeContent = document.querySelector("#response-code-content");
const copyCodeButton = document.querySelector("#copy-code");
const workspaceSearchForm = document.querySelector("#workspace-search-form");
const workspaceQuery = document.querySelector("#workspace-query");
const geminiKeyForm = document.querySelector("#gemini-key-form");
const geminiApiKeyInput = document.querySelector("#gemini-api-key");
const geminiKeyStatus = document.querySelector("#gemini-key-status");
const saveGeminiKeyButton = document.querySelector("#save-gemini-key");
const removeGeminiKeyButton = document.querySelector("#remove-gemini-key");
const searchSubmitLabel = document.querySelector("#search-submit-label");
const liveSearchStatus = document.querySelector("#live-search-status");
const searchResultsSection = document.querySelector("#search-results");
const searchResultsLabel = document.querySelector("#search-results-label");
const searchResultsTitle = document.querySelector("#search-results-title");
const searchResultCount = document.querySelector("#search-result-count");
const searchAnswer = document.querySelector("#search-answer");
const searchMediaGrid = document.querySelector("#search-media-grid");
const searchMediaToolbar = document.querySelector(".search-media-toolbar");
const searchResultList = document.querySelector("#search-result-list");
const searchResultsNote = document.querySelector("#search-results-note");
const feedList = document.querySelector("#feed-list");
const sourceForm = document.querySelector("#source-form");
const sourceInput = document.querySelector("#source-input");
const sourceStatus = document.querySelector("#source-status");
const workspaceTabList = document.querySelector("#workspace-tab-list");
const newWorkspaceTabButton = document.querySelector("#new-workspace-tab");
const historyBackButton = document.querySelector("#history-back");
const historyForwardButton = document.querySelector("#history-forward");
const evolutionStatus = document.querySelector("#evolution-status");
const evolutionSignals = document.querySelector("#evolution-signals");
const applicationDiagnosticsStatus = document.querySelector("#application-diagnostics-status");
const applicationDiagnostics = document.querySelector("#application-diagnostics");
const evolutionProposal = document.querySelector("#evolution-proposal");
const evolutionProposalTitle = document.querySelector("#evolution-proposal-title");
const evolutionProposalSummary = document.querySelector("#evolution-proposal-summary");
const reviewEvolutionButton = document.querySelector("#review-evolution");
const scanEvolutionButton = document.querySelector("#scan-evolution");
const scanApplicationButton = document.querySelector("#scan-application");
const undoEvolutionButton = document.querySelector("#undo-evolution");
const evolutionDialog = document.querySelector("#evolution-review-dialog");
const evolutionReviewReason = document.querySelector("#evolution-review-reason");
const evolutionBefore = document.querySelector("#evolution-before");
const evolutionAfter = document.querySelector("#evolution-after");
const applyEvolutionButton = document.querySelector("#apply-evolution");
const evolutionMonitorInterval = 60_000;
const applicationDiagnosticsInterval = 5 * 60_000;
const desktopApi = window.novaCoreDesktop || null;

let authMode = "login";
let activeAccount = null;
let pendingInstallPrompt = null;
let localDatabasePromise = null;
let localDatabaseReadyPromise = null;
let localSettings = {};
let currentCode = "";
let feedOffset = 0;
let workspaceTabs = [];
let activeWorkspaceTabId = "";
let speechRecognition = null;
let speakingResponse = false;
let liveResultsFilter = "all";
let liveSearchTimer = null;
let liveSearchController = null;
let liveSearchRequestId = 0;
const liveSearchResultsByTab = new Map();
const liveSearchStatusByTab = new Map();
const liveSearchErrorByTab = new Map();
let renderingWorkspaceTab = false;
let workspacePersistTimer = null;
let evolutionMonitorTimer = null;
let applicationDiagnosticsTimer = null;
let evolutionState = {
  scanCount: 0,
  lastScanAt: "",
  signals: [],
  proposalId: "",
  approvedPresetId: "",
};

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
    .catch((error) => {
      installStatus.hidden = false;
      installStatus.textContent = `Offline app setup could not finish: ${error.message}`;
    });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstallPrompt = event;
  installAppButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  pendingInstallPrompt = null;
  installAppButton.hidden = true;
  installStatus.hidden = false;
  installStatus.textContent = "NovaCore was installed on this device.";
});

installAppButton.addEventListener("click", async () => {
  if (!pendingInstallPrompt) return;
  installAppButton.disabled = true;
  try {
    const installPrompt = pendingInstallPrompt;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    pendingInstallPrompt = null;
    installAppButton.hidden = true;
    installStatus.hidden = false;
    installStatus.textContent = choice.outcome === "accepted"
      ? "NovaCore is being installed on this device."
      : "Installation was canceled. You can install NovaCore from your browser menu later.";
  } catch (error) {
    installStatus.hidden = false;
    installStatus.textContent = error instanceof Error
      ? `Could not install NovaCore: ${error.message}`
      : "Could not install NovaCore. Try your browser's install menu.";
  } finally {
    installAppButton.disabled = false;
  }
});

const evolutionPresets = Object.freeze({
  compact: Object.freeze({
    id: "compact",
    title: "Use compact surface spacing",
    token: "--evolution-card-padding",
    value: "15px",
    reason: "A narrow viewport was detected. Slightly tighter card padding keeps more of each workspace in view.",
  }),
  balanced: Object.freeze({
    id: "balanced",
    title: "Balance surface spacing",
    token: "--evolution-card-padding",
    value: "22px",
    reason: "A medium-width viewport was detected. Balanced padding keeps cards readable without wasting space.",
  }),
  spacious: Object.freeze({
    id: "spacious",
    title: "Add room around workspace cards",
    token: "--evolution-card-padding",
    value: "24px",
    reason: "A wide viewport was detected. A little more card breathing room can improve scanability.",
  }),
  focus: Object.freeze({
    id: "focus",
    title: "Increase keyboard focus contrast",
    token: "--evolution-focus-color",
    value: "#8ce0e4",
    reason: "Local source text mentions keyboard access or accessibility. A brighter focus ring can make keyboard position easier to see.",
  }),
});

const simulatedFeedItems = [
  {
    source: "Local demo · UI engineering",
    age: "Sample signal",
    title: "Small-screen navigation that stays easy to reach",
    summary: "A mock design note about keeping primary actions visible without crowding a narrow viewport.",
    tags: ["responsive UI", "accessibility"],
    prompt: "Suggest a responsive, accessible navigation pattern for a narrow-screen web app.",
  },
  {
    source: "Local demo · JavaScript",
    age: "Sample signal",
    title: "Keep interaction work off the critical path",
    summary: "A mock developer post about event delegation, bounded rendering, and avoiding needless layout work.",
    tags: ["performance", "DOM"],
    prompt: "Review local JavaScript interaction performance. Suggest event delegation and efficient DOM updates.",
  },
  {
    source: "Local demo · Web platform",
    age: "Sample signal",
    title: "Treat pasted content as data, not executable code",
    summary: "A mock security reminder to render untrusted text safely and require a deliberate action before applying changes.",
    tags: ["privacy", "secure UI"],
    prompt: "Suggest a privacy-first workflow for reviewing pasted code without executing or auto-applying it.",
  },
  {
    source: "Local demo · CSS systems",
    age: "Sample signal",
    title: "A fluid type scale can adapt without breakpoint overload",
    summary: "A mock style-system tip about using bounded fluid values and honoring reduced-motion preferences.",
    tags: ["CSS", "adaptive"],
    prompt: "Create a small responsive CSS pattern with fluid type and reduced-motion support.",
  },
];

const localKnowledge = [
  {
    title: "JavaScript interactions and DOM safety",
    source: "NovaCore local guide · JavaScript",
    summary: "Use textContent for untrusted strings, validate form input, delegate repeated events when useful, and keep DOM updates bounded.",
    summaryBn: "অবিশ্বস্ত লেখা দেখাতে textContent ব্যবহার করুন, ইনপুট যাচাই করুন এবং DOM পরিবর্তন সীমিত রাখুন।",
    titleBn: "JavaScript ইন্টারঅ্যাকশন ও DOM নিরাপত্তা",
    keywords: ["javascript", "dom", "event", "events", "listener", "innerhtml", "xss", "security", "input", "form", "জাভাস্ক্রিপ্ট", "নিরাপত্তা", "নিরাপদ", "ইনপুট", "ফর্ম", "ইভেন্ট"],
    prompt: "Review safe JavaScript DOM interactions and input handling.",
  },
  {
    title: "Responsive layouts and accessible controls",
    source: "NovaCore local guide · UI",
    summary: "Build flexible layouts with minmax, clamp, and content-first breakpoints. Label controls, preserve visible focus, and verify keyboard behavior.",
    summaryBn: "নমনীয় বিন্যাস তৈরি করুন, নিয়ন্ত্রণে স্পষ্ট লেবেল দিন এবং কিবোর্ডে ব্যবহার যাচাই করুন।",
    titleBn: "রেসপনসিভ বিন্যাস ও সহজপ্রবেশ্য নিয়ন্ত্রণ",
    keywords: ["responsive", "css", "layout", "mobile", "screen", "ui", "accessibility", "a11y", "keyboard", "focus", "রেসপনসিভ", "বিন্যাস", "মোবাইল", "প্রবেশগম্যতা", "কিবোর্ড", "ফোকাস"],
    prompt: "Suggest an accessible responsive UI layout with keyboard support.",
  },
  {
    title: "Measure before optimizing performance",
    source: "NovaCore local guide · Performance",
    summary: "Capture a repeatable baseline, profile the actual bottleneck, make one bounded change, and compare the same measurement afterward.",
    summaryBn: "আগে একটি পুনরাবৃত্তিযোগ্য ভিত্তিমাপ নিন, প্রকৃত বাধা শনাক্ত করুন এবং পরিবর্তনের পর আবার মাপুন।",
    titleBn: "গতি বাড়ানোর আগে কর্মক্ষমতা মাপুন",
    keywords: ["performance", "fast", "speed", "slow", "optimize", "optimise", "latency", "memory", "render", "benchmark", "কর্মক্ষমতা", "দ্রুত", "গতি", "ধীর", "অপ্টিমাইজ", "মেমোরি"],
    prompt: "Create a measured plan for improving web performance.",
  },
  {
    title: "Local-first privacy boundaries",
    source: "NovaCore local guide · Privacy",
    summary: "Browser storage is device-local convenience, not server authentication. Avoid external requests unless a user explicitly chooses a connected provider.",
    summaryBn: "ব্রাউজার স্টোরেজ এই ডিভাইসেই থাকে; ব্যবহারকারী স্পষ্টভাবে না চাইলে বাইরের সার্ভারে অনুরোধ পাঠাবেন না।",
    titleBn: "স্থানীয় গোপনীয়তার সীমা",
    keywords: ["privacy", "local", "offline", "tracking", "network", "server", "storage", "browser", "data", "গোপনীয়তা", "স্থানীয়", "অফলাইন", "নেটওয়ার্ক", "সার্ভার", "ডেটা"],
    prompt: "Review a local-first privacy design and its browser storage boundaries.",
  },
  {
    title: "Safer local account handling",
    source: "NovaCore local guide · Authentication",
    summary: "Never store plaintext passwords. Use unique salts and a slow password hash; client-only credentials cannot resist local storage tampering.",
    summaryBn: "সাধারণ লেখায় পাসওয়ার্ড সংরক্ষণ করবেন না। প্রতিটি অ্যাকাউন্টের জন্য আলাদা salt এবং ধীর password hash ব্যবহার করুন।",
    titleBn: "স্থানীয় অ্যাকাউন্ট আরও নিরাপদে সামলান",
    keywords: ["password", "login", "signup", "authentication", "auth", "credential", "pbkdf2", "salt", "hash", "পাসওয়ার্ড", "লগইন", "অ্যাকাউন্ট", "নিরাপত্তা", "হ্যাশ"],
    prompt: "Review local password storage and authentication security tradeoffs.",
  },
  {
    title: "Prepared statements for SQL queries",
    source: "NovaCore local guide · Databases",
    summary: "Pass user values through your database driver's parameter binding instead of concatenating them into SQL query strings.",
    summaryBn: "SQL স্ট্রিং জোড়া না লাগিয়ে ডেটাবেস ড্রাইভারের parameter binding দিয়ে ব্যবহারকারীর মান পাঠান।",
    titleBn: "SQL অনুসন্ধানে prepared statement",
    keywords: ["sql", "database", "query", "injection", "prepared", "statement", "parameter", "db", "ডেটাবেস", "অনুসন্ধান", "কোয়েরি", "নিরাপত্তা", "প্যারামিটার"],
    prompt: "Explain prepared SQL statements and how they prevent injection.",
  },
  {
    title: "Debugging with a minimal reproduction",
    source: "NovaCore local guide · Debugging",
    summary: "Record the exact error and reproduction steps, reduce the input to a small failing case, and verify one change with a regression test.",
    summaryBn: "ত্রুটি ও পুনরুৎপাদনের ধাপ লিখে রাখুন, ছোট ব্যর্থ উদাহরণ তৈরি করুন এবং একটি regression test দিয়ে সমাধান যাচাই করুন।",
    titleBn: "ছোট উদাহরণ দিয়ে ডিবাগ করুন",
    keywords: ["debug", "bug", "error", "exception", "test", "failure", "stack", "trace", "reproduce", "ডিবাগ", "ত্রুটি", "সমস্যা", "পরীক্ষা", "ব্যর্থতা"],
    prompt: "Give me a structured debugging checklist for a failing test.",
  },
  {
    title: "Git-sized refactoring",
    source: "NovaCore local guide · Engineering",
    summary: "Preserve observed behavior with focused tests, extract one cohesive unit at a time, and review the resulting diff before applying it.",
    summaryBn: "ছোট, লক্ষ্যভিত্তিক পরিবর্তন করুন; পরীক্ষা দিয়ে আগের আচরণ অক্ষুণ্ণ রাখুন এবং diff দেখে নিন।",
    titleBn: "ছোট ধাপে কোড পুনর্গঠন",
    keywords: ["refactor", "code", "review", "git", "patch", "change", "maintainability", "test", "apply", "পুনর্গঠন", "কোড", "পর্যালোচনা", "পরীক্ষা"],
    prompt: "Suggest a small, testable code refactoring workflow.",
  },
  {
    title: "What this offline search can and cannot do",
    source: "NovaCore local guide · Search",
    summary: "Results come from a small bundled index and deterministic local templates. They are not live web pages, news, or frontier-model answers.",
    summaryBn: "ফলাফল এই অ্যাপে থাকা ছোট স্থানীয় সূচি থেকে আসে; এটি সরাসরি ওয়েবসাইট, খবর বা লাইভ অনুসন্ধান নয়।",
    titleBn: "অফলাইন অনুসন্ধানের সীমা",
    keywords: ["search", "web", "live", "news", "google", "internet", "frontier", "ai", "results", "current", "অনুসন্ধান", "ওয়েব", "ইন্টারনেট", "ফলাফল", "খবর", "লাইভ"],
    prompt: "Explain the limits of local-only search and assistant responses.",
  },
  {
    title: "Finding photos while staying private",
    titleBn: "গোপনীয়তা বজায় রেখে ছবি খুঁজুন",
    source: "NovaCore local guide · Images",
    summary: "NovaCore shows locally generated visual previews, not fetched photographs. Open an image provider only when you choose to send your query there.",
    summaryBn: "NovaCore-এ স্থানীয়ভাবে তৈরি দৃশ্যমান নমুনা দেখানো হয়, ডাউনলোড করা ছবি নয়। অনুসন্ধানের শব্দ বাইরের সেবায় পাঠাতে চাইলে নিজে সেটি খুলুন।",
    keywords: ["photo", "photos", "image", "images", "picture", "pictures", "wallpaper", "gallery", "ছবি", "ফটো", "চিত্র", "ওয়ালপেপার"],
    prompt: "Help me search for images while keeping external requests under my control.",
  },
  {
    title: "Finding videos while staying private",
    titleBn: "গোপনীয়তা বজায় রেখে ভিডিও খুঁজুন",
    source: "NovaCore local guide · Video",
    summary: "Local video cards are storyboards, not playable clips. An external video search opens only after you select its link.",
    summaryBn: "স্থানীয় ভিডিও কার্ডগুলো গল্পের দৃশ্যমান রূপরেখা, চালানো যায় এমন ভিডিও নয়। লিংক নির্বাচন করলেই কেবল বাইরের ভিডিও অনুসন্ধান খুলবে।",
    keywords: ["video", "videos", "movie", "movies", "film", "films", "clip", "clips", "animation", "youtube", "ভিডিও", "সিনেমা", "চলচ্চিত্র"],
    prompt: "Help me find videos while keeping external searches under my control.",
  },
  {
    title: "Explore space and astronomy",
    titleBn: "মহাকাশ ও জ্যোতির্বিজ্ঞান ঘুরে দেখুন",
    source: "NovaCore local guide · Space",
    summary: "Start with stars, planets, galaxies, and observation basics. The artwork in this page is generated locally and is not an astronomical photograph.",
    summaryBn: "তারা, গ্রহ, ছায়াপথ ও পর্যবেক্ষণের মৌলিক বিষয় দিয়ে শুরু করুন। এই পাতার চিত্র স্থানীয়ভাবে তৈরি, জ্যোতির্বিজ্ঞানের আসল ছবি নয়।",
    keywords: ["space", "astronomy", "stars", "planet", "galaxy", "universe", "moon", "nebula", "মহাকাশ", "মহাকাশের", "জ্যোতির্বিজ্ঞান", "তারা", "তারার", "গ্রহ", "গ্রহের", "ছায়াপথ", "চাঁদ"],
    prompt: "Help me explore space and astronomy with a beginner-friendly guide.",
  },
  {
    title: "Explore nature and the outdoors",
    titleBn: "প্রকৃতি ও বাইরের জগৎ ঘুরে দেখুন",
    source: "NovaCore local guide · Nature",
    summary: "Explore plants, wildlife, oceans, and landscapes. Use an external source when you need real photographs or current field observations.",
    summaryBn: "গাছপালা, বন্যপ্রাণী, সমুদ্র ও ভূদৃশ্য সম্পর্কে জানুন। বাস্তব ছবি বা সাম্প্রতিক পর্যবেক্ষণের জন্য নিজে বাইরের উৎস খুলুন।",
    keywords: ["nature", "wildlife", "animal", "animals", "plant", "plants", "ocean", "forest", "landscape", "প্রকৃতি", "বন্যপ্রাণী", "প্রাণী", "গাছ", "সমুদ্র", "বন"],
    prompt: "Help me explore nature, wildlife, and the outdoors.",
  },
];

const setFormMessage = (message, kind = "error") => {
  formMessage.textContent = message;
  formMessage.dataset.kind = kind;
};

const openLocalDatabase = () => {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable. Enable browser storage for this site and try again."));
  }
  if (localDatabasePromise) return localDatabasePromise;

  localDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(localDatabaseName, localDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("accounts")) {
        database.createObjectStore("accounts", { keyPath: "email" });
      }
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "email" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      localDatabasePromise = null;
      reject(new Error("Could not open NovaCore's local database. Check browser storage and try again."));
    };
    request.onblocked = () => {
      localDatabasePromise = null;
      reject(new Error("NovaCore's local database is busy in another tab. Close other NovaCore tabs and try again."));
    };
  });
  return localDatabasePromise;
};

const runLocalTransaction = async (storeName, mode, operation) => {
  const database = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    try {
      transaction = database.transaction(storeName, mode);
    } catch {
      reject(new Error("Could not access NovaCore's local database."));
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(new Error("NovaCore could not save or read local data."));
    transaction.onabort = () => reject(new Error("NovaCore's local database transaction was interrupted."));
    try {
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => {
        if (request.error?.name === "ConstraintError") {
          reject(new Error("A NovaCore ID already exists on this device. Sign in instead."));
        }
      };
    } catch (error) {
      transaction.abort();
      reject(error instanceof Error ? error : new Error("Could not access NovaCore's local database."));
    }
  });
};

const isValidAccount = (account) =>
  account &&
  typeof account.email === "string" &&
  typeof account.name === "string" &&
  typeof account.salt === "string" &&
  typeof account.passwordHash === "string" &&
  (account.iterations === undefined ||
    (Number.isSafeInteger(account.iterations) &&
      account.iterations >= legacyPasswordIterations &&
      account.iterations <= passwordIterations));

const readAccounts = async () => {
  const accounts = await runLocalTransaction("accounts", "readonly", (store) => store.getAll());
  if (!Array.isArray(accounts) || accounts.some((account) => !isValidAccount(account))) {
    throw new Error("Saved NovaCore ID data is invalid. Clear this site's browser data to start again.");
  }
  return accounts;
};

const readAccount = (email) =>
  runLocalTransaction("accounts", "readonly", (store) => store.get(email));

const writeAccount = (account, create = false) =>
  runLocalTransaction("accounts", "readwrite", (store) =>
    create ? store.add(account) : store.put(account));

const readLocalSettings = (email) =>
  runLocalTransaction("settings", "readonly", (store) => store.get(email));

const writeLocalSettings = async (email, settings) => {
  const database = await openLocalDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.get(email);
    request.onsuccess = () => {
      try {
        store.put({ ...request.result, ...settings, email });
      } catch {
        transaction.abort();
        reject(new Error("Could not save your local settings."));
      }
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error("Could not save your local settings."));
    transaction.onabort = () => reject(new Error("Saving your local settings was interrupted."));
  });
};

// Electron passes single-value IPC calls (get key status, save key, ...) without a profile, so
// desktop settings are stored under one shared key while browser settings stay per NovaCore ID.
const settingsProfile = () => (desktopApi ? "desktop" : activeAccount?.email) || "";
const loadedSettings = (settings) => (settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {});
const mergeLocalSettings = async (settings) => {
  const profile = settingsProfile();
  if (!profile) throw new Error("Sign in before changing settings.");
  localSettings = { ...localSettings, ...settings };
  await writeLocalSettings(profile, localSettings);
};
const loadProfileSettings = async () => {
  if (desktopApi) return {};
  localSettings = loadedSettings(await readLocalSettings(settingsProfile()));
};

const updateSearchEngineStatus = () => {
  if (!searchEngineStatus) return;
  const available = onlineSearchAvailable();
  searchEngineStatus.textContent = available ? "DUCKDUCKGO · READY" : "DUCKDUCKGO · SERVER NEEDED";
  if (searchEngineDetail) {
    searchEngineDetail.textContent = available
      ? `Live web and image results through NovaCore's search proxy at ${apiEndpointLabel}. No API key.`
      : `Start the NovaCore server (npm start) or open the hosted site at ${apiEndpointLabel} to search the web.`;
  }
};

const updateGeminiKeyStatus = async () => {
  const configured = desktopApi
    ? Boolean((await desktopApi.getGeminiKeyStatus()).configured)
    : typeof localSettings.geminiApiKey === "string" && Boolean(localSettings.geminiApiKey);
  geminiKeyStatus.textContent = configured
    ? "Gemini API key is saved on this device."
    : "Add an API key to use live Gemini answers.";
  assistantEngineStatus.textContent = configured ? "GEMINI AI · READY" : "GEMINI AI · SETUP NEEDED";
  assistantEngineDetail.textContent = configured
    ? "Live answers with Google Search grounding."
    : "Add an API key to enable live answers.";
  removeGeminiKeyButton.disabled = !configured;
  document.querySelector("#ai-settings").open = !configured;
  updateSearchEngineStatus();
  return configured;
};

geminiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeAccount) return;
  const apiKey = geminiApiKeyInput.value.trim();
  if (apiKey.length < 10 || apiKey.length > 512) {
    geminiKeyStatus.textContent = "Enter a valid Google Gemini API key.";
    geminiApiKeyInput.focus();
    return;
  }
  saveGeminiKeyButton.disabled = true;
  try {
    if (desktopApi) {
      await desktopApi.saveGeminiApiKey(apiKey);
    } else {
      await mergeLocalSettings({ geminiApiKey: apiKey });
    }
    geminiApiKeyInput.value = "";
    await updateGeminiKeyStatus();
    promptNotice.textContent = "Gemini is ready. Your prompt will be sent to Google when you ask.";
  } catch (error) {
    geminiKeyStatus.textContent = error instanceof Error
      ? `API key could not be saved: ${error.message}`
      : "API key could not be saved.";
  } finally {
    saveGeminiKeyButton.disabled = false;
  }
});

removeGeminiKeyButton.addEventListener("click", async () => {
  if (!activeAccount) return;
  removeGeminiKeyButton.disabled = true;
  try {
    if (desktopApi) {
      await desktopApi.removeGeminiApiKey();
    } else {
      await mergeLocalSettings({ geminiApiKey: null });
      delete localSettings.geminiApiKey;
    }
    await updateGeminiKeyStatus();
    promptNotice.textContent = "Gemini API key removed from this device.";
  } catch (error) {
    geminiKeyStatus.textContent = error instanceof Error
      ? `API key could not be removed: ${error.message}`
      : "API key could not be removed.";
    removeGeminiKeyButton.disabled = false;
  }
});

const initializeLocalDatabase = () => {
  if (localDatabaseReadyPromise) return localDatabaseReadyPromise;
  localDatabaseReadyPromise = openLocalDatabase().then(async () => {
    try {
      const accounts = await readAccounts();
      const serialized = localStorage.getItem(legacyAccountStorageKey);
      if (!serialized) return;

      const legacyAccounts = JSON.parse(serialized);
      if (!Array.isArray(legacyAccounts) || legacyAccounts.some((account) => !isValidAccount(account))) {
        throw new Error("Existing NovaCore ID data is invalid; it was not removed.");
      }
      if (new Set(legacyAccounts.map((account) => account.email)).size !== legacyAccounts.length) {
        throw new Error("Existing NovaCore IDs contain duplicate email addresses; they were not removed.");
      }
      for (const account of legacyAccounts) {
        if (!accounts.some((savedAccount) => savedAccount.email === account.email)) {
          await writeAccount(account, true);
        }
      }
      localStorage.removeItem(legacyAccountStorageKey);
    } catch (error) {
      setFormMessage(error instanceof Error
        ? `Legacy account migration issue: ${error.message}`
        : "Could not migrate previous NovaCore IDs. New local accounts are still available.");
    }
  });
  localDatabaseReadyPromise.catch(() => { localDatabaseReadyPromise = null; });
  return localDatabaseReadyPromise;
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value) => {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Saved NovaCore ID data is invalid. Clear this site's local data to start again.");
  }
};

const derivePasswordHash = async (password, salt, iterations = passwordIterations) => {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Secure password hashing is unavailable in this browser context. Open NovaCore from a secure app or HTTPS origin.");
  }
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(derivedBits);
};

const hashesMatch = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

// Reads the persistent login saved in localStorage. `present` is true when a record exists
// (valid or malformed); `state` is null when the record is missing or unreadable.
const readStoredLoginState = () => {
  let raw;
  try {
    raw = localStorage.getItem(loginStateStorageKey);
  } catch {
    return { present: false, state: null };
  }
  if (raw === null) return { present: false, state: null };
  try {
    const state = JSON.parse(raw);
    if (
      state &&
      state.isLoggedIn === "true" &&
      typeof state.email === "string" &&
      state.email.length > 0 &&
      state.email.length <= 254 &&
      typeof state.name === "string" &&
      state.name.length <= 48
    ) {
      return { present: true, state };
    }
  } catch {
    // Fall through: an unreadable record is treated as a broken login state.
  }
  return { present: true, state: null };
};

const writeStoredLoginState = (account) => {
  try {
    localStorage.setItem(
      loginStateStorageKey,
      JSON.stringify({
        isLoggedIn: "true",
        email: account.email,
        name: account.name,
        loggedInAt: new Date().toISOString(),
      }),
    );
  } catch {
    throw new Error("Could not save your persistent login. Enable local storage and try again.");
  }
};

const clearStoredLoginState = () => {
  try {
    localStorage.removeItem(loginStateStorageKey);
  } catch {
    throw new Error("Could not clear the saved login. Browser storage is unavailable.");
  }
};

// Remembers only the NovaCore ID (never the password) so the sign-in form can be pre-filled
// after a deliberate sign-out.
const rememberAccountEmail = (email) => {
  try {
    localStorage.setItem(rememberedLoginStorageKey, JSON.stringify({ email }));
  } catch {
    // Remembering the ID is a convenience; failing to store it must not block sign-in.
  }
};

const readRememberedEmail = () => {
  // A saved login always wins; only a deliberate sign-out leaves the remembered ID behind.
  if (readStoredLoginState().present) return "";
  try {
    const remembered = JSON.parse(localStorage.getItem(rememberedLoginStorageKey) || "null");
    return remembered && typeof remembered.email === "string" ? remembered.email : "";
  } catch {
    return "";
  }
};

const saveSession = (account) => {
  try {
    sessionStorage.setItem(
      sessionStorageKey,
      JSON.stringify({ email: account.email, name: account.name }),
    );
  } catch {
    throw new Error("Could not start your local session. Enable session storage and try again.");
  }
  writeStoredLoginState(account);
};

const clearSession = () => {
  const previousAccount = activeAccount;
  stopEvolutionMonitor();
  Object.values(evolutionPresets).forEach(({ token }) => {
    document.documentElement.style.removeProperty(token);
  });
  evolutionState = {
    scanCount: 0,
    lastScanAt: "",
    signals: [],
    proposalId: "",
    approvedPresetId: "",
  };
  if (workspacePersistTimer !== null) {
    clearTimeout(workspacePersistTimer);
    workspacePersistTimer = null;
  }
  try {
    sessionStorage.removeItem(sessionStorageKey);
    sessionStorage.removeItem(thoughtStorageKey);
    sessionStorage.removeItem(workspaceTabsStorageKey);
  } catch {
    throw new Error("Could not clear the local session. Close this tab to end it.");
  }
  clearStoredLoginState();
  if (previousAccount && typeof previousAccount.email === "string") {
    rememberAccountEmail(previousAccount.email);
  }
};

const isValidEvolutionState = (state) =>
  state &&
  Number.isSafeInteger(state.scanCount) &&
  state.scanCount >= 0 &&
  typeof state.lastScanAt === "string" &&
  Array.isArray(state.signals) &&
  state.signals.length <= 8 &&
  state.signals.every((signal) =>
    signal &&
    typeof signal.label === "string" &&
    typeof signal.detail === "string"
  ) &&
  typeof state.proposalId === "string" &&
  (!state.proposalId || Object.hasOwn(evolutionPresets, state.proposalId)) &&
  typeof state.approvedPresetId === "string" &&
  (!state.approvedPresetId || Object.hasOwn(evolutionPresets, state.approvedPresetId));

const persistEvolutionState = async () => {
  if (!activeAccount) return;
  try {
    await mergeLocalSettings({ evolutionState });
  } catch (error) {
    evolutionStatus.textContent = error instanceof Error
      ? `Local settings could not be saved: ${error.message}`
      : "Local settings could not be saved.";
  }
};

const renderEvolutionState = () => {
  evolutionStatus.textContent = evolutionState.lastScanAt
    ? `Local scan ${evolutionState.scanCount} · ${new Date(evolutionState.lastScanAt).toLocaleTimeString()} · next check while active`
    : "Waiting for the first local signal scan.";
  evolutionSignals.replaceChildren();
  evolutionState.signals.forEach((signal) => {
    const item = document.createElement("div");
    item.className = "evolution-signal";
    const label = document.createElement("strong");
    label.textContent = signal.label;
    const detail = document.createElement("span");
    detail.textContent = signal.detail;
    item.append(label, detail);
    evolutionSignals.append(item);
  });

  const proposal = evolutionPresets[evolutionState.proposalId];
  evolutionProposal.hidden = !proposal;
  if (proposal) {
    evolutionProposalTitle.textContent = proposal.title;
    evolutionProposalSummary.textContent = proposal.reason;
  }
  undoEvolutionButton.hidden = !evolutionState.approvedPresetId;
};

const loadEvolutionState = async () => {
  if (["auto", "bn-BD", "en-US"].includes(localSettings.voiceLanguage)) {
    voiceLanguage.value = localSettings.voiceLanguage;
  }
  if (!localSettings.evolutionState) return;
  const saved = localSettings.evolutionState;
  if (!isValidEvolutionState(saved)) {
    evolutionState = {
      scanCount: 0,
      lastScanAt: "",
      signals: [],
      proposalId: "",
      approvedPresetId: "",
    };
    evolutionStatus.textContent = "Saved local settings were invalid; a clean scan will replace them.";
  } else {
    evolutionState = saved;
  }
  const approved = evolutionPresets[evolutionState.approvedPresetId];
  if (approved) document.documentElement.style.setProperty(approved.token, approved.value);
  renderEvolutionState();
};

const scanLocalEvolutionSignals = () => {
  const width = window.innerWidth;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const pastedSource = sourceInput.value.toLowerCase();
  const signals = [
    { label: "Viewport", detail: `${width}px wide · ${width <= 560 ? "compact" : width >= 1200 ? "spacious" : "balanced"} layout` },
    { label: "Motion preference", detail: reducedMotion ? "Reduced motion requested; existing CSS support is active." : "Standard motion preference; no animation changes needed." },
    { label: "Input mode", detail: coarsePointer ? "Coarse pointer detected; touch-friendly controls retained." : "Fine pointer detected; keyboard focus styling retained." },
    { label: "Bundled guidance", detail: `${localKnowledge.length + simulatedFeedItems.length} local signals checked; no remote sources.` },
  ];

  let proposalId = width <= 560 ? "compact" : width >= 1200 ? "spacious" : "balanced";
  if (/\b(accessib(?:ility|le)|keyboard|focus indicator|screen reader)\b/i.test(pastedSource)) {
    proposalId = "focus";
    signals.push({ label: "Pasted source", detail: "Accessibility/keyboard guidance found in current-tab text." });
  } else if (pastedSource.trim()) {
    signals.push({ label: "Pasted source", detail: `${sourceInput.value.length} characters inspected as text only.` });
  }

  evolutionState.scanCount += 1;
  evolutionState.lastScanAt = new Date().toISOString();
  evolutionState.signals = signals;
  if (!evolutionState.approvedPresetId || evolutionState.approvedPresetId !== proposalId) {
    evolutionState.proposalId = proposalId;
  } else {
    evolutionState.proposalId = "";
  }
  renderEvolutionState();
  persistEvolutionState();
};

const runApplicationDiagnostics = async () => {
  scanApplicationButton.disabled = true;
  applicationDiagnosticsStatus.textContent = "Checking app capabilities…";
  try {
    const keyStatus = desktopApi
      ? await desktopApi.getGeminiKeyStatus()
      : { configured: typeof localSettings.geminiApiKey === "string" && Boolean(localSettings.geminiApiKey) };
    const checks = [
      {
        name: "Local account storage",
        status: globalThis.indexedDB && globalThis.crypto?.subtle ? "pass" : "fail",
        detail: "NovaCore IDs are stored locally and passwords are hashed on this device.",
      },
      {
        name: "DuckDuckGo live search",
        status: onlineSearchAvailable() ? "pass" : "fail",
        detail: onlineSearchAvailable()
          ? `The search bar sends queries to the NovaCore search proxy at ${apiEndpointLabel}, which fetches web and image results without a paid API key.`
          : isDesktopShell
            ? "Live search needs a NovaCore server. Open the desktop app or start the server with npm start."
            : "Live search is unreachable. Check the connection, or open NovaCore from its hosted site.",
      },
      {
        name: "Gemini AI",
        status: (desktopApi || onlineSearchAvailable()) && keyStatus.configured ? "pass" : "fail",
        detail: keyStatus.configured
          ? "Gemini API access is configured for this account."
          : "Save a Google Gemini API key in Gemini AI settings to enable live answers.",
      },
    ];
    applicationDiagnostics.replaceChildren();
    checks.forEach((check) => {
      const item = document.createElement("div");
      item.className = "evolution-signal";
      item.dataset.status = check.status === "pass" ? "pass" : "fail";
      const label = document.createElement("strong");
      label.textContent = `${check.status === "pass" ? "PASS" : "CHECK"} · ${check.name}`;
      const detail = document.createElement("span");
      detail.textContent = check.detail;
      item.append(label, detail);
      applicationDiagnostics.append(item);
    });
    const failedChecks = checks.filter((check) => check.status !== "pass").length;
    applicationDiagnosticsStatus.textContent = `Checked ${checks.length} app capabilities · ${failedChecks ? `${failedChecks} check(s) need attention` : "all checks passed"} · ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    applicationDiagnosticsStatus.textContent = error instanceof Error
      ? `App capability check unavailable: ${error.message}`
      : "App capability check unavailable.";
  } finally {
    scanApplicationButton.disabled = false;
  }
};

const startEvolutionMonitor = async () => {
  stopEvolutionMonitor();
  try {
    if (!desktopApi && (localSettings.voiceLanguage === undefined || localSettings.evolutionState === undefined)) {
      localSettings = { ...loadedSettings(await readLocalSettings(settingsProfile())), ...localSettings };
    }
    await loadEvolutionState();
  } catch (error) {
    evolutionStatus.textContent = error instanceof Error
      ? `Local settings could not be loaded: ${error.message}`
      : "Local settings could not be loaded.";
  }
  scanLocalEvolutionSignals();
  void runApplicationDiagnostics();
  evolutionMonitorTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && !workspaceView.hidden) {
      scanLocalEvolutionSignals();
    }
  }, evolutionMonitorInterval);
  applicationDiagnosticsTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && !workspaceView.hidden) {
      void runApplicationDiagnostics();
    }
  }, applicationDiagnosticsInterval);
};

function stopEvolutionMonitor() {
  if (evolutionMonitorTimer !== null) {
    window.clearInterval(evolutionMonitorTimer);
    evolutionMonitorTimer = null;
  }
  if (applicationDiagnosticsTimer !== null) {
    window.clearInterval(applicationDiagnosticsTimer);
    applicationDiagnosticsTimer = null;
  }
}

const reviewEvolutionProposal = () => {
  const proposal = evolutionPresets[evolutionState.proposalId];
  if (!proposal) return;
  const currentValue = document.documentElement.style.getPropertyValue(proposal.token).trim();
  evolutionReviewReason.textContent = proposal.reason;
  evolutionBefore.textContent = `${proposal.token}: ${currentValue || "browser default"}`;
  evolutionAfter.textContent = `${proposal.token}: ${proposal.value}`;
  if (typeof evolutionDialog.showModal === "function") {
    evolutionDialog.showModal();
  } else {
    evolutionStatus.textContent = "This browser does not support a safe change-preview dialog; no UI tune was applied.";
  }
};

const applyReviewedEvolutionProposal = () => {
  const proposal = evolutionPresets[evolutionState.proposalId];
  if (!proposal || !evolutionDialog.open) return;
  document.documentElement.style.setProperty(proposal.token, proposal.value);
  evolutionState.approvedPresetId = proposal.id;
  evolutionState.proposalId = "";
  evolutionDialog.close();
  renderEvolutionState();
  persistEvolutionState();
};

const undoApprovedEvolution = () => {
  const approved = evolutionPresets[evolutionState.approvedPresetId];
  if (!approved) return;
  document.documentElement.style.removeProperty(approved.token);
  evolutionState.approvedPresetId = "";
  evolutionState.proposalId = "";
  renderEvolutionState();
  evolutionStatus.textContent = "Approved UI tune removed for this browser session.";
  persistEvolutionState();
};

const createWorkspaceTab = (title = "New tab", thought = "") => ({
  id: `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  title,
  draft: thought,
  quickQuery: "",
  notice: "Your words stay right here in this preview.",
  response: null,
  search: null,
  sourceText: "",
  sourceStatus: "Pasted text stays in this tab and is never executed.",
  feedOffset: 0,
  history: [],
  historyIndex: -1,
  scrollTop: 0,
});

const activeWorkspaceTab = () =>
  workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) || null;

const persistWorkspaceTabs = () => {
  if (workspacePersistTimer !== null) {
    clearTimeout(workspacePersistTimer);
    workspacePersistTimer = null;
  }
  try {
    sessionStorage.setItem(
      workspaceTabsStorageKey,
      JSON.stringify({ version: 1, activeId: activeWorkspaceTabId, tabs: workspaceTabs }),
    );
    sessionStorage.setItem(thoughtStorageKey, activeWorkspaceTab()?.draft || "");
  } catch {
    promptNotice.textContent = "Could not save workspace tabs in this browser session. Keep this page open to retain them.";
  }
};

const scheduleWorkspacePersist = () => {
  if (workspacePersistTimer !== null) clearTimeout(workspacePersistTimer);
  workspacePersistTimer = setTimeout(persistWorkspaceTabs, 180);
};

const responseFromDom = () => {
  if (localResponse.hidden) return null;
  return {
    title: responseTitle.textContent || "",
    prompt: responsePrompt.textContent || "",
    intro: responseIntro.textContent || "",
    steps: Array.from(responseSteps.children, (step) => step.textContent || ""),
    sources: Array.from(responseSourceList.querySelectorAll("a"), (link) => ({
      title: link.textContent || "",
      url: link.href,
    })),
    code: currentCode,
    notes: responseSteps.children.length > 0 && responseSteps.firstElementChild?.dataset.note === "true"
      ? [responseSteps.firstElementChild.textContent || ""]
      : [],
  };
};

const captureActiveWorkspaceTab = () => {
  const tab = activeWorkspaceTab();
  if (!tab || renderingWorkspaceTab) return;
  tab.draft = promptInput.value;
  tab.quickQuery = workspaceQuery.value;
  tab.notice = promptNotice.textContent || "";
  tab.response = responseFromDom();
  tab.search = readSearchStateFromDom();
  tab.sourceText = sourceInput.value;
  tab.sourceStatus = sourceStatus.textContent || "";
  tab.feedOffset = feedOffset;
  tab.scrollTop = workspaceView.scrollTop;
};

const isStoredSearch = (search) =>
  search === undefined ||
  search === null ||
  (search &&
    typeof search.query === "string" &&
    (search.kind === "live" ||
      search.kind === "provider" ||
      (typeof search.hasExactMatches === "boolean" &&
        search.answer &&
        typeof search.answer.title === "string" &&
        typeof search.answer.intro === "string" &&
        Array.isArray(search.answer.steps) &&
        search.answer.steps.every((step) => typeof step === "string") &&
        Array.isArray(search.resultIndexes) &&
        search.resultIndexes.length <= 4 &&
        (search.kind === undefined ||
          (search.kind === "url" &&
            typeof search.destination === "string" &&
            normalizeDirectUrl(search.destination) === search.destination)) &&
        search.resultIndexes.every((index) =>
          Number.isInteger(index) && index >= 0 && index < localKnowledge.length
        ))));

const isStoredResponse = (response) =>
  response === null ||
  (response &&
    typeof response.title === "string" &&
    typeof response.prompt === "string" &&
    typeof response.intro === "string" &&
    Array.isArray(response.steps) &&
    response.steps.every((step) => typeof step === "string") &&
    (response.sources === undefined ||
      (Array.isArray(response.sources) &&
        response.sources.every((source) =>
          source &&
          typeof source.title === "string" &&
          typeof source.url === "string" &&
          normalizeDirectUrl(source.url) === source.url
        ))) &&
    typeof response.code === "string" &&
    (response.notes === undefined ||
      (Array.isArray(response.notes) &&
        response.notes.length <= 1 &&
        response.notes.every((note) => typeof note === "string"))));

const isStoredWorkspaceTab = (tab) =>
  tab &&
  typeof tab.id === "string" &&
  typeof tab.title === "string" &&
  typeof tab.draft === "string" &&
  typeof tab.quickQuery === "string" &&
  typeof tab.notice === "string" &&
  typeof tab.sourceText === "string" &&
  typeof tab.sourceStatus === "string" &&
  Number.isInteger(tab.feedOffset) &&
  tab.feedOffset >= 0 &&
  tab.feedOffset < simulatedFeedItems.length &&
  Array.isArray(tab.history) &&
  tab.history.length <= maxTabHistory &&
  Number.isInteger(tab.historyIndex) &&
  Number.isFinite(tab.scrollTop) &&
  isStoredResponse(tab.response) &&
  isStoredSearch(tab.search) &&
  ((tab.history.length === 0 && tab.historyIndex === -1) ||
    (tab.history.length > 0 && tab.historyIndex >= 0 && tab.historyIndex < tab.history.length)) &&
  tab.history.every((entry) => entry && typeof entry.title === "string") &&
  tab.history.every((entry) =>
    entry &&
    typeof entry.query === "string" &&
    isStoredResponse(entry.response) &&
    isStoredSearch(entry.search));

const readWorkspaceTabs = () => {
  const serialized = sessionStorage.getItem(workspaceTabsStorageKey);
  if (!serialized) {
    let thought = "";
    try {
      thought = sessionStorage.getItem(thoughtStorageKey) || "";
    } catch {
      promptNotice.textContent = "This browser could not restore your previous thought.";
    }
    workspaceTabs = [createWorkspaceTab("Workspace 1", thought)];
    activeWorkspaceTabId = workspaceTabs[0].id;
    return;
  }
  let saved;
  try {
    saved = JSON.parse(serialized);
  } catch {
    throw new Error("Saved workspace tabs are unreadable. Sign out and start a fresh workspace session.");
  }
  if (
    !saved ||
    saved.version !== 1 ||
    !Array.isArray(saved.tabs) ||
    saved.tabs.length === 0 ||
    !saved.tabs.every(isStoredWorkspaceTab) ||
    !saved.tabs.some((tab) => tab.id === saved.activeId) ||
    new Set(saved.tabs.map((tab) => tab.id)).size !== saved.tabs.length
  ) {
    throw new Error("Saved workspace tabs are invalid. Sign out and start a fresh workspace session.");
  }
  workspaceTabs = saved.tabs;
  activeWorkspaceTabId = saved.activeId;
};

const renderWorkspaceTabList = () => {
  workspaceTabList.replaceChildren();
  workspaceTabs.forEach((tab) => {
    const item = document.createElement("div");
    item.className = "workspace-tab";
    item.classList.toggle("is-active", tab.id === activeWorkspaceTabId);
    item.setAttribute("role", "presentation");

    const selectButton = document.createElement("button");
    selectButton.className = "workspace-tab-select";
    selectButton.type = "button";
    selectButton.id = `workspace-tab-${tab.id}`;
    selectButton.setAttribute("role", "tab");
    selectButton.setAttribute("aria-controls", "workspace-main");
    selectButton.setAttribute("aria-selected", String(tab.id === activeWorkspaceTabId));
    selectButton.setAttribute("tabindex", tab.id === activeWorkspaceTabId ? "0" : "-1");
    selectButton.dataset.workspaceTabId = tab.id;
    selectButton.title = tab.title;
    selectButton.textContent = tab.title;

    const closeButton = document.createElement("button");
    closeButton.className = "workspace-tab-close";
    closeButton.type = "button";
    closeButton.dataset.closeWorkspaceTab = tab.id;
    closeButton.setAttribute("aria-label", `Close ${tab.title}`);
    closeButton.title = workspaceTabs.length === 1 ? "At least one workspace must remain open" : "Close workspace";
    closeButton.textContent = "×";
    closeButton.disabled = workspaceTabs.length === 1;
    closeButton.tabIndex = closeButton.disabled ? -1 : 0;
    item.append(selectButton, closeButton);
    workspaceTabList.append(item);
  });
  historyBackButton.disabled = !activeWorkspaceTab() || activeWorkspaceTab().historyIndex <= 0;
  historyForwardButton.disabled =
    !activeWorkspaceTab() ||
    activeWorkspaceTab().historyIndex >= activeWorkspaceTab().history.length - 1;
  document.querySelector("#workspace-main").setAttribute(
    "aria-labelledby",
    `workspace-tab-${activeWorkspaceTabId}`,
  );
};

const renderResponse = (response) => {
  if (speakingResponse) {
    window.speechSynthesis?.cancel();
    speakingResponse = false;
  }
  speakResponseButton.textContent = "Read response aloud";
  if (!response) {
    localResponse.hidden = true;
    responseTitle.textContent = "";
    responsePrompt.textContent = "";
    responseIntro.textContent = "";
    responseSources.hidden = true;
    responseSourceList.replaceChildren();
    responseSteps.replaceChildren();
    responseCode.hidden = true;
    responseCodeContent.textContent = "";
    speakResponseButton.hidden = true;
    currentCode = "";
    return;
  }
  responseTitle.textContent = response.title;
  responsePrompt.textContent = response.prompt;
  responseIntro.textContent = response.intro;
  responseSourceList.replaceChildren();
  (Array.isArray(response.sources) ? response.sources : []).forEach((source) => {
    const url = normalizeDirectUrl(source.url);
    if (!url || new URL(url).protocol !== "https:") return;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title || new URL(url).hostname;
    item.append(link);
    responseSourceList.append(item);
  });
  responseSources.hidden = responseSourceList.childElementCount === 0;
  responseSteps.replaceChildren();
  (Array.isArray(response.notes) ? response.notes : []).forEach((note) => {
    const item = document.createElement("li");
    item.dataset.note = "true";
    item.textContent = note;
    responseSteps.append(item);
  });
  response.steps.forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    responseSteps.append(item);
  });
  currentCode = response.code || "";
  responseCode.hidden = !currentCode;
  responseCodeContent.textContent = currentCode;
  speakResponseButton.hidden = false;
  speakResponseButton.textContent = "Read response aloud";
  localResponse.hidden = false;
};

const getSpeechLanguage = (text) => {
  if (voiceLanguage.value !== "auto") return voiceLanguage.value;
  if (isBengaliText(text)) return "bn-BD";
  return navigator.language || "en-US";
};

voiceInputButton.addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    voiceStatus.textContent = "Speech recognition is not available in this browser. You can still type your prompt.";
    return;
  }
  if (speechRecognition) {
    speechRecognition.stop();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = voiceLanguage.value === "auto"
    ? (navigator.language || "en-US")
    : voiceLanguage.value;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  speechRecognition = recognition;
  voiceInputButton.textContent = "Listening…";
  voiceStatus.textContent = `Listening in ${recognition.lang}. Your speech is handled by the browser's speech service; availability and privacy practices vary by browser/device.`;

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    if (!transcript) return;
    promptInput.value = [promptInput.value.trim(), transcript].filter(Boolean).join(" ");
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus.textContent = "Transcription added to your prompt. Review it, then choose Ask NovaCore to continue.";
    promptInput.focus();
  }, { once: true });

  recognition.addEventListener("error", (event) => {
    voiceStatus.textContent = event.error === "not-allowed"
      ? "Microphone permission was denied. Allow microphone access or type your prompt."
      : `Speech recognition failed (${event.error}). You can still type your prompt.`;
  });
  recognition.addEventListener("end", () => {
    if (speechRecognition !== recognition) return;
    speechRecognition = null;
    voiceInputButton.textContent = "Use voice";
  });
  try {
    recognition.start();
  } catch (error) {
    speechRecognition = null;
    voiceInputButton.textContent = "Use voice";
    voiceStatus.textContent = error instanceof Error
      ? `Could not start speech recognition: ${error.message}`
      : "Could not start speech recognition. You can still type your prompt.";
  }
});

voiceLanguage.addEventListener("change", async () => {
  if (!activeAccount) return;
  try {
    await mergeLocalSettings({ voiceLanguage: voiceLanguage.value });
  } catch (error) {
    voiceStatus.textContent = error instanceof Error
      ? `Voice preference could not be saved: ${error.message}`
      : "Voice preference could not be saved.";
  }
});

speakResponseButton.addEventListener("click", () => {
  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
    voiceStatus.textContent = "Text-to-speech is not available in this browser. You can read the response on screen.";
    return;
  }
  if (speakingResponse) {
    window.speechSynthesis.cancel();
    speakingResponse = false;
    speakResponseButton.textContent = "Read response aloud";
    voiceStatus.textContent = "Speech stopped.";
    return;
  }

  const text = [responseIntro.textContent, ...Array.from(responseSteps.children, (step) => step.textContent || "")]
    .filter(Boolean)
    .join(". ");
  if (!text) {
    voiceStatus.textContent = "There is no response text to read aloud yet.";
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = getSpeechLanguage(text);
  utterance.addEventListener("end", () => {
    speakingResponse = false;
    speakResponseButton.textContent = "Read response aloud";
    voiceStatus.textContent = "Finished reading the response.";
  });
  utterance.addEventListener("error", (event) => {
    speakingResponse = false;
    speakResponseButton.textContent = "Read response aloud";
    voiceStatus.textContent = event.error === "canceled" || event.error === "interrupted"
      ? "Speech stopped."
      : `Text-to-speech failed (${event.error}).`;
  });
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  speakingResponse = true;
  speakResponseButton.textContent = "Stop speaking";
  voiceStatus.textContent = `Reading the response in ${utterance.lang}. Available voices depend on your browser/device.`;
});

const readSearchStateFromDom = () => {
  const tab = activeWorkspaceTab();
  return tab?.search || null;
};

const renderSearchState = (search, options = {}) => {
  searchResultList.replaceChildren();
  searchMediaGrid.replaceChildren();
  searchResultsLabel.textContent = "LIVE SEARCH · DUCKDUCKGO";
  searchMediaToolbar.hidden = true;
  searchResultList.hidden = false;
  searchAnswer.replaceChildren();
  searchResultsNote.textContent = "";
  if (!search) {
    searchResultsSection.hidden = true;
    searchResultsTitle.textContent = "";
    searchResultCount.textContent = "";
    return;
  }

  searchResultsSection.hidden = false;
  if (search.kind === "url") {
    const destination = normalizeDirectUrl(search.destination);
    if (!destination) throw new Error("The saved website address is invalid.");
    const address = new URL(destination);
    searchResultsLabelsForQuery(search.query);
    searchResultsTitle.textContent = `Website ready · “${search.query}”`;
    searchResultCount.textContent = "Ready to open";
    const intro = document.createElement("p");
    intro.className = "search-answer-intro";
    intro.textContent = "Open this address directly in your browser. NovaCore has not sent a request to the website.";
    searchAnswer.append(intro);
    const article = document.createElement("article");
    article.className = "search-result";
    const sourceLabel = document.createElement("p");
    sourceLabel.className = "search-result-source";
    sourceLabel.textContent = address.protocol === "https:" ? "HTTPS WEBSITE" : "HTTP WEBSITE";
    const title = document.createElement("h3");
    title.textContent = address.host;
    const summary = document.createElement("p");
    summary.textContent = address.href;
    const link = document.createElement("a");
    link.className = "search-result-action";
    link.href = destination;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open website ↗";
    article.append(sourceLabel, title, summary, link);
    searchResultList.append(article);
    searchResultsNote.textContent = "An external connection is made only if you open the address you entered.";
    return;
  }

  if (search.kind === "provider") {
    searchResultsLabelsForQuery(search.query);
    searchResultsTitle.textContent = `Search DuckDuckGo for “${search.query}”`;
    searchResultCount.textContent = "Public web search";
    const intro = document.createElement("p");
    intro.className = "search-answer-intro";
    intro.textContent = "NovaCore opens your query directly on DuckDuckGo. Search results are shown in your browser.";
    searchAnswer.append(intro);
    const link = document.createElement("a");
    link.className = "search-result-action";
    link.href = buildDuckDuckGoUrl(search.query);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open DuckDuckGo results ↗";
    searchResultList.append(link);
    searchResultsNote.textContent = "Your query is sent to DuckDuckGo when you submit it. Strict SafeSearch is enabled.";
    return;
  }

  const isLegacySearch = search.kind !== "live";
  const status = options.status || "ready";
  const data = options.data || null;
  searchResultsLabelsForQuery(search.query);
  searchResultsTitle.textContent = `Results for “${search.query}”`;

  if (isLegacySearch) {
    searchResultCount.textContent = "";
    appendSearchMessage("This saved offline search cannot show live results. Submit the query again to fetch current web and image results.");
    return;
  }
  if (status === "loading") {
    searchResultCount.textContent = "Searching…";
    appendSearchMessage("Searching the live web and image index…");
    return;
  }
  if (status === "error") {
    searchResultCount.textContent = "Search unavailable";
    appendSearchMessage(options.error || "Live search failed. Check the local search service and try again.");
    return;
  }
  if (!data) {
    searchResultCount.textContent = "";
    appendSearchMessage(onlineSearchAvailable()
      ? "Press Search web to fetch current web and image results."
      : `Live search needs a reachable NovaCore server at ${apiEndpointLabel}.`);
    return;
  }

  const webResults = Array.isArray(data.webResults) ? data.webResults : [];
  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
  searchResultCount.textContent = `${webResults.length} web results · ${imageResults.length} images`;
  searchMediaToolbar.hidden = imageResults.length === 0;
  searchResultList.hidden = liveResultsFilter === "images";
  searchResultsSection.querySelectorAll("[data-media-filter]").forEach((button) => {
    const filter = button.dataset.mediaFilter;
    button.textContent = filter === "images" ? "Images" : "All results";
    button.classList.toggle("is-active", filter === liveResultsFilter);
    button.setAttribute("aria-pressed", String(filter === liveResultsFilter));
  });
  imageResults.forEach((result) => {
    const imageUrl = normalizeDirectUrl(result.thumbnailUrl || result.imageUrl);
    const pageUrl = normalizeDirectUrl(result.pageUrl || result.imageUrl);
    if (!imageUrl || !pageUrl) return;
    const card = document.createElement("article");
    card.className = "search-media-card";
    const link = document.createElement("a");
    link.className = "search-media-link";
    link.href = pageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.className = "search-media-art";
    image.src = imageUrl;
    image.alt = result.title || "Search result image";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    link.append(image);
    const meta = document.createElement("p");
    meta.className = "search-media-meta";
    meta.textContent = result.source || new URL(pageUrl).hostname;
    const title = document.createElement("h3");
    title.textContent = result.title || "Untitled image";
    card.append(link, meta, title);
    searchMediaGrid.append(card);
  });

  webResults.forEach((result) => {
    const destination = normalizeDirectUrl(result.url);
    if (!destination) return;
    const article = document.createElement("article");
    article.className = "search-result";
    const sourceLabel = document.createElement("p");
    sourceLabel.className = "search-result-source";
    sourceLabel.textContent = result.source || new URL(destination).hostname;
    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = destination;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = result.title || destination;
    title.append(link);
    article.append(sourceLabel, title);
    if (result.description) {
      const description = document.createElement("p");
      description.textContent = result.description;
      article.append(description);
    }
    searchResultList.append(article);
  });

  if (!webResults.length && !imageResults.length) {
    appendSearchMessage("No results were returned for this query.");
  }
  const providerWarnings = Array.isArray(data.warnings) ? data.warnings.join(" ") : "";
  searchResultsNote.textContent = `${providerWarnings} Live results by DuckDuckGo. Your query was sent to DuckDuckGo; image thumbnails load directly from their source websites.`.trim();
};

const searchResultsLabelsForQuery = (query) => {
  searchResultsLabel.textContent = containsBengali(query) ? "লাইভ অনুসন্ধান · DUCKDUCKGO" : "LIVE SEARCH · DUCKDUCKGO";
};

const appendSearchMessage = (message) => {
  const status = document.createElement("p");
  status.className = "search-empty";
  status.textContent = message;
  searchResultList.append(status);
};

const cancelLiveSearch = () => {
  if (liveSearchTimer) window.clearTimeout(liveSearchTimer);
  liveSearchTimer = null;
  liveSearchController?.abort();
  liveSearchController = null;
  liveSearchRequestId += 1;
};

const isNativeSearchAvailable = () => typeof window.novaCoreSearch?.search === "function";

const onlineSearchAvailable = () => Boolean(window.NovaCoreContentFilter) &&
  (isNativeSearchAvailable() ||
    !isDesktopShell ||
    Boolean(apiBaseUrl) ||
    (desktopApi !== null && typeof desktopApi.searchWeb === "function"));

const readProxyResponse = async (response) => {
  let body;
  try {
    body = await response.text();
  } catch {
    throw new Error("Could not read NovaCore's search service response. Try again.");
  }
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`NovaCore's search proxy returned an invalid response. Check ${apiEndpointLabel} and try again.`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("NovaCore's search proxy returned unexpected data. Try the search again.");
  }
  return result;
};

const sanitizeWebResults = (results) => {
  if (!Array.isArray(results)) return [];
  return results.slice(0, maxSearchResults).flatMap((result) => {
    const url = typeof result?.url === "string" ? normalizeDirectUrl(result.url) : null;
    if (!url) return [];
    return [{
      title: typeof result.title === "string" ? result.title.slice(0, 300) : url,
      url,
      description: typeof result.description === "string" ? result.description.slice(0, 1_200) : "",
      source: typeof result.source === "string" ? result.source.slice(0, 120) : "",
    }];
  });
};

const sanitizeImageResults = (results) => {
  if (!Array.isArray(results)) return [];
  return results.slice(0, maxSearchResults).flatMap((result) => {
    const imageUrl = typeof result?.imageUrl === "string" ? normalizeDirectUrl(result.imageUrl) : null;
    const thumbnailUrl = typeof result?.thumbnailUrl === "string"
      ? normalizeDirectUrl(result.thumbnailUrl)
      : null;
    const pageUrl = typeof result?.pageUrl === "string" ? normalizeDirectUrl(result.pageUrl) : null;
    if (!imageUrl || !thumbnailUrl || !pageUrl) return [];
    return [{
      title: typeof result.title === "string" ? result.title.slice(0, 300) : "",
      pageUrl,
      imageUrl,
      thumbnailUrl,
      source: typeof result.source === "string" ? result.source.slice(0, 120) : "",
    }];
  });
};

const describeProxyError = (url, error) => {
  if (error?.name === "TimeoutError") {
    return "The request timed out. Check the connection and try again.";
  }
  if (error instanceof TypeError) {
    const target = apiBaseUrl || (isDesktopShell ? "a local NovaCore server" : location.origin);
    return url === searchProxyPath
      ? `Could not reach NovaCore's search service at ${target}. Check your connection and try again.`
      : `Could not reach NovaCore's Gemini service at ${target}. Check your connection and try again.`;
  }
  return error instanceof Error ? error.message : "The request could not be completed. Try again.";
};

const readErrorBody = async (response) => {
  let body;
  try {
    body = await response.text();
  } catch {
    return "";
  }
  try {
    const payload = JSON.parse(body);
    return typeof payload?.error === "string" ? payload.error : "";
  } catch {
    return "";
  }
};

const fetchDesktopSearch = async (query) => {
  if (typeof desktopApi.searchWeb !== "function") return null;
  try {
    const result = await desktopApi.searchWeb(query);
    return {
      provider: "DuckDuckGo",
      query,
      webResults: sanitizeWebResults(result?.webResults),
      imageResults: sanitizeImageResults(result?.imageResults),
      warnings: Array.isArray(result?.warnings) ? result.warnings.filter((item) => typeof item === "string") : [],
    };
  } catch (error) {
    // The desktop app normally searches from its own main process. If that lookup fails (DuckDuckGo
    // blocked the request, or the network dropped) the live server is still tried before giving up,
    // instead of failing a search the deployed API could have answered.
    if (apiBaseUrl) return null;
    const detail = error instanceof Error && error.message
      ? error.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "")
      : "";
    throw new Error(detail || "DuckDuckGo could not complete the search. Check the connection and try again.");
  }
};

const fetchSearchProxy = async (query, signal) => {
  // The packaged Android app can query DuckDuckGo on-device through novacore-android-bridge.js.
  if (isNativeSearchAvailable()) {
    const native = await window.novaCoreSearch.search(query);
    if (signal.aborted) return null;
    return {
      provider: "DuckDuckGo",
      query,
      webResults: sanitizeWebResults(native?.webResults),
      imageResults: sanitizeImageResults(native?.imageResults),
      warnings: Array.isArray(native?.warnings) ? native.warnings.filter((item) => typeof item === "string") : [],
    };
  }
  if (desktopApi && typeof desktopApi.searchWeb === "function") {
    const result = await fetchDesktopSearch(query);
    if (result || signal.aborted) return result;
  }
  if (isDesktopShell && !apiBaseUrl) {
    // A file:// page with no configured API origin cannot reach a relative /api/search URL.
    throw new Error(
      "NovaCore has no search service configured. Rebuild the app with Novacore Android Search enabled, " +
      "or set window.NOVACORE_API_BASE in novacore-config.js to a deployed server.",
    );
  }
  let response;
  try {
    response = await fetch(searchProxyPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(searchProxyTimeoutMs)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(describeProxyError(searchProxyPath, error));
  }
  const result = await readProxyResponse(response);
  if (!response.ok) {
    throw new Error(typeof result.error === "string" && result.error
      ? result.error
      : `Search failed (HTTP ${response.status}).`);
  }
  return {
    provider: "DuckDuckGo",
    query,
    webResults: sanitizeWebResults(result.webResults),
    imageResults: sanitizeImageResults(result.imageResults),
    warnings: Array.isArray(result.warnings) ? result.warnings.filter((item) => typeof item === "string") : [],
  };
};

const openDuckDuckGoTab = (query) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  cancelLiveSearch();
  liveSearchResultsByTab.delete(tab.id);
  liveSearchErrorByTab.delete(tab.id);
  liveSearchStatusByTab.set(tab.id, "ready");
  liveResultsFilter = "all";
  tab.quickQuery = query;
  tab.search = { kind: "provider", query };
  tab.response = null;
  tab.notice = "Opening DuckDuckGo search results in your browser.";
  tab.title = query.length > 28 ? `${query.slice(0, 27).trimEnd()}…` : query;
  if (tab.historyIndex < tab.history.length - 1) tab.history.splice(tab.historyIndex + 1);
  tab.history.push({
    kind: "search",
    query,
    title: tab.title,
    draft: tab.draft,
    quickQuery: query,
    response: null,
    search: { kind: "provider", query },
  });
  if (tab.history.length > maxTabHistory) tab.history.shift();
  tab.historyIndex = tab.history.length - 1;
  renderResponse(null);
  renderSearchState(tab.search);
  promptNotice.textContent = tab.notice;
  liveSearchStatus.textContent = "Opening DuckDuckGo…";
  renderWorkspaceTabList();
  persistWorkspaceTabs();
  liveSearchStatus.textContent = "Your query was sent to DuckDuckGo.";
  window.open(buildDuckDuckGoUrl(query), "_blank", "noopener,noreferrer");
};

const runLiveSearch = async (query) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  const contentFilter = window.NovaCoreContentFilter;
  const filterReady = Boolean(contentFilter) && typeof contentFilter.containsBlockedTerm === "function";
  if (!filterReady) {
    if (isDesktopShell && desktopApi) {
      // The desktop main process applies this same shared filter before contacting DuckDuckGo.
    } else if (isDesktopShell) {
      openDuckDuckGoTab(query);
      return;
    } else {
      const message = "NovaCore's built-in search safety filter is unavailable. Reload the app before searching.";
      liveSearchStatus.textContent = message;
      promptNotice.textContent = message;
      return;
    }
  }
  if (filterReady && contentFilter.containsBlockedTerm(query)) {
    cancelLiveSearch();
    liveSearchStatus.textContent = contentFilter.blockedMessage;
    promptNotice.textContent = contentFilter.blockedMessage;
    return;
  }

  cancelLiveSearch();
  const requestId = liveSearchRequestId;
  const controller = new AbortController();
  liveSearchController = controller;
  liveSearchResultsByTab.delete(tab.id);
  liveSearchErrorByTab.delete(tab.id);
  liveSearchStatusByTab.set(tab.id, "loading");
  liveResultsFilter = "all";
  tab.quickQuery = query;
  tab.search = { kind: "live", query };
  tab.response = null;
  tab.notice = "Searching DuckDuckGo for current web and image results.";
  tab.title = query.length > 28 ? `${query.slice(0, 27).trimEnd()}…` : query;
  if (tab.historyIndex < tab.history.length - 1) tab.history.splice(tab.historyIndex + 1);
  tab.history.push({
    kind: "search",
    query,
    title: tab.title,
    draft: tab.draft,
    quickQuery: query,
    response: null,
    search: { kind: "live", query },
  });
  if (tab.history.length > maxTabHistory) tab.history.shift();
  tab.historyIndex = tab.history.length - 1;
  renderResponse(null);
  renderSearchState(tab.search, { status: "loading" });
  promptNotice.textContent = tab.notice;
  liveSearchStatus.textContent = "Searching…";
  renderWorkspaceTabList();
  persistWorkspaceTabs();

  try {
    const result = await fetchSearchProxy(query, controller.signal);
    if (!result) throw new Error("NovaCore's local search service returned no results. Try again.");
    if (requestId !== liveSearchRequestId || controller.signal.aborted) return;
    liveSearchResultsByTab.set(tab.id, result);
    liveSearchStatusByTab.set(tab.id, "ready");
    tab.notice = "Live web and image results are ready.";
    if (activeWorkspaceTabId === tab.id) {
      renderSearchState(tab.search, { data: result, status: "ready" });
      promptNotice.textContent = tab.notice;
      liveSearchStatus.textContent = "Live results loaded. Your query was sent to DuckDuckGo.";
    }
    persistWorkspaceTabs();
  } catch (error) {
    if (controller.signal.aborted || requestId !== liveSearchRequestId) return;
    const message = error instanceof Error && error.message
      ? error.message
      : "Live search failed. Check the local search service and try again.";
    liveSearchErrorByTab.set(tab.id, message);
    liveSearchStatusByTab.set(tab.id, "error");
    tab.notice = message;
    if (activeWorkspaceTabId === tab.id) {
      renderSearchState(tab.search, { status: "error", error: message });
      promptNotice.textContent = message;
      liveSearchStatus.textContent = message;
    }
    persistWorkspaceTabs();
  } finally {
    if (requestId === liveSearchRequestId) liveSearchController = null;
  }
};

const renderActiveWorkspaceTab = (restoreScroll = false) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  renderingWorkspaceTab = true;
  liveResultsFilter = "all";
  promptInput.value = tab.draft;
  workspaceQuery.value = tab.quickQuery;
  updateSearchSubmitLabel();
  promptNotice.textContent = tab.notice;
  sourceInput.value = tab.sourceText;
  sourceStatus.textContent = tab.sourceStatus;
  feedOffset = tab.feedOffset;
  renderResponse(tab.search ? null : tab.response);
  renderSearchState(tab.search || null, {
    data: liveSearchResultsByTab.get(tab.id),
    status: liveSearchStatusByTab.get(tab.id),
    error: liveSearchErrorByTab.get(tab.id),
  });
  renderFeed();
  renderWorkspaceTabList();
  renderingWorkspaceTab = false;
  if (restoreScroll) workspaceView.scrollTop = tab.scrollTop;
};

const openWorkspaceTab = () => {
  captureActiveWorkspaceTab();
  const tab = createWorkspaceTab(`Workspace ${workspaceTabs.length + 1}`);
  workspaceTabs.push(tab);
  activeWorkspaceTabId = tab.id;
  renderActiveWorkspaceTab();
  persistWorkspaceTabs();
  promptInput.focus({ preventScroll: true });
  workspaceView.scrollTop = 0;
};

const selectWorkspaceTab = (tabId) => {
  if (tabId === activeWorkspaceTabId || !workspaceTabs.some((tab) => tab.id === tabId)) return;
  captureActiveWorkspaceTab();
  activeWorkspaceTabId = tabId;
  renderActiveWorkspaceTab(true);
  persistWorkspaceTabs();
  workspaceTabList.querySelector("[role='tab'][aria-selected='true']")?.focus();
};

const closeWorkspaceTab = (tabId) => {
  if (workspaceTabs.length <= 1) return;
  const closingIndex = workspaceTabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0) return;
  const wasActive = tabId === activeWorkspaceTabId;
  captureActiveWorkspaceTab();
  workspaceTabs.splice(closingIndex, 1);
  if (wasActive) {
    activeWorkspaceTabId = workspaceTabs[Math.max(0, closingIndex - 1)].id;
    renderActiveWorkspaceTab(true);
  } else {
    renderWorkspaceTabList();
  }
  persistWorkspaceTabs();
  if (wasActive) workspaceTabList.querySelector("[role='tab'][aria-selected='true']")?.focus();
};

const navigateWorkspaceHistory = (direction) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  const nextIndex = tab.historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= tab.history.length) return;
  captureActiveWorkspaceTab();
  tab.historyIndex = nextIndex;
  const entry = tab.history[nextIndex];
  tab.draft = entry.draft ?? entry.query;
  tab.quickQuery = entry.quickQuery ?? entry.query;
  tab.response = entry.response;
  tab.search = entry.search || null;
  tab.title = entry.title;
  tab.notice = "Showing this workspace's local history.";
  renderActiveWorkspaceTab();
  persistWorkspaceTabs();
};

const showWorkspace = async (account) => {
  activeAccount = account;
  // Reaching the workspace means the tab-scoped session is gone (new tab, reload, ...), so the
  // persistent login is re-applied before profile settings are read for this account.
  try {
    sessionStorage.setItem(
      sessionStorageKey,
      JSON.stringify({ email: account.email, name: account.name }),
    );
  } catch {
    // The workspace still works for this page; actions that need the tab session report the error.
  }
  await loadProfileSettings();
  if (["auto", "bn-BD", "en-US"].includes(localSettings.voiceLanguage)) {
    voiceLanguage.value = localSettings.voiceLanguage;
  }
  await updateGeminiKeyStatus();
  authView.hidden = true;
  workspaceView.hidden = false;
  workspaceView.scrollTop = 0;
  memberName.textContent = account.name;
  memberId.textContent = account.email;
  memberLabel.textContent = "YOUR NOVACORE ID";
  document.title = `NovaCore — ${account.name}'s space`;
  try {
    readWorkspaceTabs();
    renderActiveWorkspaceTab();
    persistWorkspaceTabs();
  } catch (error) {
    workspaceTabs = [createWorkspaceTab("Workspace 1")];
    activeWorkspaceTabId = workspaceTabs[0].id;
    renderActiveWorkspaceTab();
    promptNotice.textContent = error instanceof Error
      ? `${error.message} A fresh workspace was opened.`
      : "Workspace tabs could not be restored. A fresh workspace was opened.";
    workspaceTabs[0].notice = promptNotice.textContent;
    persistWorkspaceTabs();
  }
  void startEvolutionMonitor();
  promptInput.focus({ preventScroll: true });
};

const showAuth = () => {
  activeAccount = null;
  localSettings = {};
  geminiApiKeyInput.value = "";
  stopEvolutionMonitor();
  if (evolutionDialog.open) evolutionDialog.close();
  workspaceView.hidden = true;
  authView.hidden = false;
  authView.scrollTop = 0;
  accountForm.reset();
  setAuthMode("login");
  const rememberedEmail = readRememberedEmail();
  if (rememberedEmail) {
    accountEmail.value = rememberedEmail;
    accountEmail.dispatchEvent(new Event("input", { bubbles: true }));
  }
  document.title = "NovaCore ID";
  accountEmail.focus({ preventScroll: true });
};

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("tabindex", active ? "0" : "-1");
  });
  nameField.hidden = !isSignup;
  confirmField.hidden = !isSignup;
  passwordHint.hidden = !isSignup;
  accountName.required = isSignup;
  accountConfirm.required = isSignup;
  accountPassword.autocomplete = isSignup ? "new-password" : "current-password";
  accountPassword.minLength = isSignup ? 12 : 1;
  submitLabel.textContent = isSignup ? "Create your NovaCore ID" : "Enter your space";
  formMessage.textContent = "";
  delete formMessage.dataset.kind;
}

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode = authMode === "login" ? "signup" : "login";
    setAuthMode(nextMode);
    document.querySelector(`[data-mode="${nextMode}"]`).focus();
  });
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormMessage("");

  if (!accountForm.reportValidity()) return;

  const email = accountEmail.value.trim().toLowerCase();
  const password = accountPassword.value;
  const name = accountName.value.trim();

  if (authMode === "signup" && password.length < 12) {
    setFormMessage("Choose a password with at least 12 characters.");
    accountPassword.focus();
    return;
  }
  if (authMode === "signup" && name.length === 0) {
    setFormMessage("Add a display name for your NovaCore ID.");
    accountName.focus();
    return;
  }
  if (authMode === "signup" && password !== accountConfirm.value) {
    setFormMessage("Those passwords do not match.");
    accountConfirm.focus();
    return;
  }

  accountSubmit.disabled = true;
  accountForm.classList.add("is-busy");
  submitLabel.textContent = authMode === "signup" ? "Creating your ID…" : "Opening your space…";

  try {
    await initializeLocalDatabase();
    let account;

    if (authMode === "signup") {
      if (await readAccount(email)) {
        setFormMessage("A NovaCore ID already exists on this device. Sign in instead.");
        return;
      }

      if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
        throw new Error("Secure password hashing is unavailable in this browser context. Open NovaCore from a secure app or HTTPS origin.");
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const passwordHash = await derivePasswordHash(password, salt);
      account = {
        email,
        name,
        salt: bytesToBase64(salt),
        passwordHash: bytesToBase64(passwordHash),
        iterations: passwordIterations,
      };
      await writeAccount(account, true);
    } else {
      account = await readAccount(email);
      if (!account) {
        setFormMessage("No NovaCore ID was found on this device. Create an account to begin.");
        return;
      }
      const salt = base64ToBytes(account.salt);
      const storedHash = base64ToBytes(account.passwordHash);
      const enteredHash = await derivePasswordHash(
        password,
        salt,
        account.iterations ?? legacyPasswordIterations,
      );
      if (!hashesMatch(enteredHash, storedHash)) {
        setFormMessage("That NovaCore ID and password combination does not match.");
        return;
      }
    }

    saveSession(account);
    setFormMessage(authMode === "signup" ? "NovaCore ID created on this device." : "Welcome back.", "success");
    await showWorkspace(account);
  } catch (error) {
    setFormMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
  } finally {
    accountSubmit.disabled = false;
    accountForm.classList.remove("is-busy");
    submitLabel.textContent = authMode === "signup" ? "Create your NovaCore ID" : "Enter your space";
  }
});

document.querySelectorAll(".tool-card[data-prompt]").forEach((tool) => {
  tool.addEventListener("click", () => {
    promptInput.value = tool.dataset.prompt || "";
    promptInput.focus();
    promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
    promptNotice.textContent = "A prompt starter is ready. Add your details.";
      const tab = activeWorkspaceTab();
      if (tab) {
        tab.draft = promptInput.value;
        tab.notice = promptNotice.textContent;
        persistWorkspaceTabs();
      }
  });
});

workspaceSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = workspaceQuery.value.trim();
  if (!query) {
    workspaceQuery.focus();
    return;
  }
  runLiveSearch(query);
});

workspaceQuery.addEventListener("input", (event) => {
  if (event.isComposing) return;
  previewLocalSearch(workspaceQuery.value);
});

workspaceQuery.addEventListener("compositionend", () => {
  previewLocalSearch(workspaceQuery.value);
});

searchResultsSection.querySelectorAll("[data-media-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    liveResultsFilter = button.dataset.mediaFilter === "images" ? "images" : "all";
    const tab = activeWorkspaceTab();
    if (tab?.search?.kind === "live") {
      renderSearchState(tab.search, {
        data: liveSearchResultsByTab.get(tab.id),
        status: liveSearchStatusByTab.get(tab.id),
        error: liveSearchErrorByTab.get(tab.id),
      });
    }
  });
});

const isBengaliText = (text) => /[\u0980-\u09FF]/u.test(text);

const sanitizeGeminiSources = (sources) => {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 8).flatMap((source) => {
    if (typeof source?.url !== "string") return [];
    let url;
    try {
      url = new URL(source.url);
    } catch {
      return [];
    }
    if (url.protocol !== "https:") return [];
    return [{
      title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : url.hostname,
      url: url.href,
    }];
  });
};

// Gemini runs through novaCoreDesktop inside Electron, which holds the OS-encrypted key.
const generateDesktopResponse = async (prompt) => {
  try {
    const generated = await desktopApi.generateGeminiResponse(prompt);
    if (!generated || typeof generated.text !== "string" || !generated.text.trim()) {
      throw new Error("Google Gemini returned no answer. Try rephrasing the prompt.");
    }
    return { text: generated.text.trim(), sources: sanitizeGeminiSources(generated.sources) };
  } catch (error) {
    const detail = error instanceof Error && error.message
      ? error.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "")
      : "";
    throw new Error(detail || "Gemini could not generate an answer. Try again.");
  }
};

const generateBrowserResponse = async (prompt) => {
  const apiKey = typeof localSettings.geminiApiKey === "string" ? localSettings.geminiApiKey.trim() : "";
  if (!apiKey) throw new Error("Add your Gemini API key in Gemini AI settings before asking for a live answer.");
  let response;
  if (isDesktopShell && !apiBaseUrl && typeof window.NovaCoreGemini?.generateGeminiResponse === "function") {
    // Only reached when a packaged build has no API origin at all: call Google directly with the
    // saved key. With the live server configured, the proxy below is used instead.
    const direct = await window.NovaCoreGemini.generateGeminiResponse({ apiKey, prompt });
    if (!direct || typeof direct.text !== "string" || !direct.text.trim()) {
      throw new Error("Google Gemini returned no answer. Try rephrasing the prompt.");
    }
    return { text: direct.text.trim(), sources: sanitizeGeminiSources(direct.sources) };
  }
  try {
    response = await fetch(geminiProxyPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({ prompt }),
    });
  } catch (error) {
    throw new Error(describeProxyError(geminiProxyPath, error));
  }
  if (!response.ok) {
    const message = await readErrorBody(response);
    throw new Error(message || `Gemini request failed (HTTP ${response.status}).`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("NovaCore's Gemini proxy returned an unreadable response. Try again.");
  }
  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("Google Gemini returned no answer. Try rephrasing the prompt.");
  }
  return { text: payload.text.trim(), sources: sanitizeGeminiSources(payload.sources) };
};

const generateLiveResponse = (prompt) => desktopApi
  ? generateDesktopResponse(prompt)
  : generateBrowserResponse(prompt);

const processThought = async (value, options = {}) => {
  const text = value.trim();
  if (!text) {
    promptNotice.textContent = "Add a thought above before composing.";
    promptInput.focus();
    return;
  }
  if (text.length > 4000) {
    promptNotice.textContent = "Keep your prompt under 4,000 characters.";
    promptInput.focus();
    return;
  }

  const tab = activeWorkspaceTab();
  const tabId = tab?.id;
  const draft = promptInput.value;
  const quickQuery = workspaceQuery.value;
  let response = options.response;
  if (!response) {
    if (isDesktopShell && !desktopApi) {
      promptNotice.textContent = "Gemini is unavailable in this offline build. Open NovaCore in the desktop app or from its hosted site.";
      return;
    }
    if (!desktopApi && !(typeof localSettings.geminiApiKey === "string" && localSettings.geminiApiKey.trim())) {
      promptNotice.textContent = "Add your Gemini API key in Gemini AI settings before asking for a live answer.";
      const settings = document.querySelector("#ai-settings");
      if (settings) settings.open = true;
      geminiApiKeyInput?.focus();
      return;
    }
    composeThoughtButton.disabled = true;
    composeThoughtButton.textContent = "Asking Gemini…";
    promptNotice.textContent = "Sending your prompt to Google Gemini with Google Search grounding…";
    if (tab) {
      tab.draft = draft;
      tab.quickQuery = quickQuery;
      tab.notice = promptNotice.textContent;
      tab.response = null;
    }
    try {
      const generated = await generateLiveResponse(text);
      response = {
        title: isBengaliText(text) || voiceLanguage.value === "bn-BD"
          ? "জেমিনি উত্তর"
          : "Gemini answer",
        intro: generated.text,
        steps: [],
        notes: generated.sources.length
          ? []
          : ["No grounding sources were returned for this answer. Verify important claims independently."],
        sources: generated.sources,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini could not generate an answer.";
      if (activeWorkspaceTabId === tabId) {
        promptNotice.textContent = message;
        if (tab) tab.notice = message;
      }
      return;
    } finally {
      composeThoughtButton.disabled = false;
      composeThoughtButton.innerHTML = 'Ask NovaCore <span class="button-arrow" aria-hidden="true">↗</span>';
    }
  }

  const savedResponse = {
    title: response.title,
    prompt: options.label || text,
    intro: response.intro,
    steps: Array.isArray(response.steps) ? response.steps : [],
    notes: Array.isArray(response.notes) ? response.notes.slice(0, 1) : [],
    sources: Array.isArray(response.sources) ? response.sources : [],
    code: response.code || "",
  };
  const notice = options.response
    ? "Local source analysis is ready below."
    : isBengaliText(text) || voiceLanguage.value === "bn-BD"
      ? "জেমিনি উত্তর প্রস্তুত। উত্তরটি যাচাই করুন এবং নিচের সূত্রগুলো দেখুন।"
      : "Gemini answer ready. Review it and check the sources below.";
  if (tab) {
    tab.search = null;
    tab.draft = draft;
    tab.quickQuery = quickQuery;
    tab.notice = notice;
    tab.response = savedResponse;
    tab.sourceText = sourceInput.value;
    tab.sourceStatus = sourceStatus.textContent || "";
    tab.feedOffset = feedOffset;
    tab.title = text.length > 28 ? `${text.slice(0, 27).trimEnd()}…` : text;
    if (tab.historyIndex < tab.history.length - 1) {
      tab.history.splice(tab.historyIndex + 1);
    }
    tab.history.push({
      kind: "compose",
      query: text,
      title: tab.title,
      draft: tab.draft,
      quickQuery: tab.quickQuery,
      response: savedResponse,
      search: null,
    });
    if (tab.history.length > maxTabHistory) tab.history.shift();
    tab.historyIndex = tab.history.length - 1;
    persistWorkspaceTabs();
  }
  if (!tabId || activeWorkspaceTabId === tabId) {
    renderResponse(savedResponse);
    renderSearchState(null);
    promptNotice.textContent = notice;
    if (tab) renderWorkspaceTabList();
  }
};

const normalizeDirectUrl = (value) => {
  const input = value.trim();
  if (!input || /\s/u.test(input)) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const isLocalAddress =
    /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:.]+\])(?::\d+)?(?:[/?#]|$)/i.test(input);
  const inferredScheme = isLocalAddress ? "http" : "https";
  const address = hasScheme ? input : `${inferredScheme}://${input.replace(/^\/\//, "")}`;
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) return null;

  if (!hasScheme) {
    const validHostname =
      url.hostname === "localhost" ||
      /^\[[\da-f:.]+\]$/i.test(url.hostname) ||
      /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}$/u.test(url.hostname) ||
      /^(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(url.hostname);
    if (!validHostname) return null;
  }
  return url.href;
};

const updateSearchSubmitLabel = () => {
  searchSubmitLabel.textContent = "Search web";
};

const buildDuckDuckGoUrl = (query) => {
  const url = new URL("https://duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("kp", "1");
  return url.href;
};

const openDirectUrl = (destination) => {
  const safeDestination = normalizeDirectUrl(destination);
  if (!safeDestination) throw new Error("Enter a valid HTTP or HTTPS website address.");
  window.location.assign(safeDestination);
};

const containsBengali = (value) => /[\u0980-\u09FF]/u.test(value);

const previewLocalSearch = (value) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  const query = value.trim();
  updateSearchSubmitLabel();
  tab.quickQuery = value;
  if (!query) {
    cancelLiveSearch();
    tab.search = null;
    tab.response = null;
    tab.notice = "Your words stay right here in this preview.";
    renderSearchState(null);
    renderResponse(null);
    promptNotice.textContent = tab.notice;
    scheduleWorkspacePersist();
    return;
  }

  cancelLiveSearch();
  liveSearchResultsByTab.delete(tab.id);
  liveSearchErrorByTab.delete(tab.id);
  const search = { kind: "live", query };
  tab.search = search;
  tab.response = null;
  tab.notice = onlineSearchAvailable()
    ? "Press Search web to fetch current web and image results."
    : "Press Search web to open this query on DuckDuckGo.";
  renderResponse(null);
  renderSearchState(search, { status: "ready" });
  promptNotice.textContent = tab.notice;
  scheduleWorkspacePersist();
};

const runDirectNavigation = (query, destination) => {
  const tab = activeWorkspaceTab();
  if (!tab) return;
  const address = new URL(destination);
  const search = {
    kind: "url",
    query,
    destination,
    hasExactMatches: false,
    answer: { title: "", intro: "", steps: [] },
    resultIndexes: [],
  };
  tab.quickQuery = query;
  tab.search = search;
  tab.response = null;
  tab.notice = `Opening ${address.host} in your browser.`;
  tab.title = address.host;
  if (tab.historyIndex < tab.history.length - 1) {
    tab.history.splice(tab.historyIndex + 1);
  }
  tab.history.push({
    kind: "search",
    query,
    title: tab.title,
    draft: tab.draft,
    quickQuery: query,
    response: null,
    search,
  });
  if (tab.history.length > maxTabHistory) tab.history.shift();
  tab.historyIndex = tab.history.length - 1;
  renderResponse(null);
  renderSearchState(search);
  promptNotice.textContent = tab.notice;
  renderWorkspaceTabList();
  persistWorkspaceTabs();
  openDirectUrl(destination);
};

promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  processThought(promptInput.value);
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

const analyzeLocalSource = (source) => {
  const lines = source.split(/\r\n?|\n/).length;
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  const findings = [];
  const suggestions = [];
  if (/\beval\s*\(|new Function\s*\(/i.test(source)) {
    findings.push("dynamic code evaluation pattern");
    suggestions.push("Avoid evaluating strings as code; use explicit functions and validated data instead.");
  }
  if (/\binnerHTML\b|document\.write\s*\(|dangerouslySetInnerHTML/.test(source)) {
    findings.push("HTML injection sink pattern");
    suggestions.push("Render untrusted values as text and sanitize any HTML at a well-defined trust boundary.");
  }
  if (/\b(fetch|XMLHttpRequest|WebSocket)\b/.test(source)) {
    findings.push("network access pattern");
    suggestions.push("Review destinations, consent, error handling, and whether every request is necessary.");
  }
  if (/\b(addEventListener|onClick|onclick)\b/.test(source)) {
    suggestions.push("Check keyboard access, listener cleanup, and duplicate event registration.");
  }
  if (/\b(media\s*\(|@media|grid|flex)\b/i.test(source)) {
    suggestions.push("Test narrow viewports, zoom, and reduced-motion behavior.");
  }
  if (!suggestions.length) {
    suggestions.push("Check input boundaries, error handling, and the behavior of empty or unusually large values.");
    suggestions.push("Add a focused test for the main behavior and one meaningful edge case.");
  }

  const kind = /<\w+[\s>]|<!doctype/i.test(source) ? "HTML" :
    /(^|\n)\s*[@.#][\w-]+\s*[{]|@media/i.test(source) ? "CSS" :
      /\b(const|let|function|=>|import)\b/.test(source) ? "JavaScript-like" : "plain text";
  if (!findings.length) findings.push("No obvious high-risk pattern matched the local heuristics.");
  return {
    title: "Local source notes",
    intro: `Reviewed ${kind} text locally: ${lines} lines and ${words} words. This is a lightweight pattern check, not execution, a full code review, or a security audit.`,
    steps: [
      `Signals: ${findings.join("; ")}.`,
      ...suggestions.slice(0, 3),
      "Verify every suggestion against the complete project and its tests before making changes.",
    ],
  };
};

const renderFeed = () => {
  feedList.replaceChildren();
  const feedItems = simulatedFeedItems.map((_, index) =>
    simulatedFeedItems[(index + feedOffset) % simulatedFeedItems.length],
  );
  feedItems.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "feed-item";

    const meta = document.createElement("div");
    meta.className = "feed-item-meta";
    const source = document.createElement("span");
    source.textContent = item.source;
    const age = document.createElement("span");
    age.textContent = item.age;
    meta.append(source, age);

    const title = document.createElement("h3");
    title.textContent = item.title;
    const summary = document.createElement("p");
    summary.textContent = item.summary;

    const footer = document.createElement("div");
    footer.className = "feed-item-footer";
    const tags = document.createElement("div");
    tags.className = "feed-tags";
    item.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag;
      tags.append(chip);
    });
    const analyzeButton = document.createElement("button");
    analyzeButton.type = "button";
    analyzeButton.className = "feed-analyze";
    analyzeButton.dataset.feedIndex = String(index);
    analyzeButton.textContent = "Explore signal";
    footer.append(tags, analyzeButton);

    article.append(meta, title, summary, footer);
    feedList.append(article);
  });
};

document.querySelector("#refresh-feed").addEventListener("click", () => {
  feedOffset = (feedOffset + 1) % simulatedFeedItems.length;
  const tab = activeWorkspaceTab();
  if (tab) tab.feedOffset = feedOffset;
  renderFeed();
  sourceStatus.textContent = "Local demo signals rotated. No external feed was fetched.";
  if (tab) {
    tab.sourceStatus = sourceStatus.textContent;
    persistWorkspaceTabs();
  }
});

feedList.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("button[data-feed-index]")
    : null;
  if (!button) return;
  const itemIndex = Number(button.dataset.feedIndex);
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= simulatedFeedItems.length) return;
  const item = simulatedFeedItems[(itemIndex + feedOffset) % simulatedFeedItems.length];
  promptInput.value = item.prompt;
  sourceStatus.textContent = `Opened a local suggestion based on: ${item.title}`;
  processThought(item.prompt);
});

sourceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const source = sourceInput.value.trim();
  if (!source) {
    sourceStatus.textContent = "Paste some source text before analyzing.";
    sourceInput.focus();
    return;
  }
  const response = analyzeLocalSource(source);
  const preview = source.length > 320 ? `${source.slice(0, 320)}…` : source;
  sourceStatus.textContent = "Local heuristic analysis complete. Pasted content was not executed or sent anywhere.";
  processThought(source, {
    response,
    label: `Local source excerpt · ${source.length} characters\n${preview}`,
  });
});

copyCodeButton.addEventListener("click", async () => {
  if (!currentCode) return;
  try {
    await navigator.clipboard.writeText(currentCode);
    copyCodeButton.textContent = "Copied";
  } catch {
    promptNotice.textContent = "Clipboard access was denied. Select the code block and copy it manually.";
  }
});

renderFeed();

workspaceTabList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const closeButton = target?.closest("button[data-close-workspace-tab]");
  if (closeButton) {
    const tabId = closeButton.dataset.closeWorkspaceTab;
    if (tabId) closeWorkspaceTab(tabId);
    return;
  }
  const selectButton = target?.closest("button[data-workspace-tab-id]");
  if (selectButton?.dataset.workspaceTabId) {
    selectWorkspaceTab(selectButton.dataset.workspaceTabId);
  }
});

workspaceTabList.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tabs = Array.from(workspaceTabList.querySelectorAll("[role='tab']"));
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0 || tabs.length < 2) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  next.focus();
  next.click();
});

newWorkspaceTabButton.addEventListener("click", openWorkspaceTab);
historyBackButton.addEventListener("click", () => navigateWorkspaceHistory(-1));
historyForwardButton.addEventListener("click", () => navigateWorkspaceHistory(1));
scanEvolutionButton.addEventListener("click", scanLocalEvolutionSignals);
scanApplicationButton.addEventListener("click", runApplicationDiagnostics);
reviewEvolutionButton.addEventListener("click", reviewEvolutionProposal);
applyEvolutionButton.addEventListener("click", applyReviewedEvolutionProposal);
undoEvolutionButton.addEventListener("click", undoApprovedEvolution);

promptInput.addEventListener("input", () => {
  const tab = activeWorkspaceTab();
  if (!tab || renderingWorkspaceTab) return;
  tab.draft = promptInput.value;
  persistWorkspaceTabs();
});

sourceInput.addEventListener("input", () => {
  const tab = activeWorkspaceTab();
  if (!tab || renderingWorkspaceTab) return;
  tab.sourceText = sourceInput.value;
  persistWorkspaceTabs();
});

document.querySelector("#save-thought").addEventListener("click", () => {
  const thought = promptInput.value.trim();
  if (!thought) {
    promptNotice.textContent = "Add a thought above before saving.";
    promptInput.focus();
    return;
  }
  try {
    sessionStorage.setItem(thoughtStorageKey, thought);
    promptNotice.textContent = "Thought saved for this tab.";
    const tab = activeWorkspaceTab();
    if (tab) {
      tab.draft = promptInput.value;
      tab.notice = promptNotice.textContent;
      persistWorkspaceTabs();
    }
  } catch {
    promptNotice.textContent = "Could not save this thought in the current browser session.";
  }
});

signoutButton.addEventListener("click", () => {
  try {
    clearSession();
    showAuth();
  } catch (error) {
    promptNotice.textContent = error instanceof Error ? error.message : "Could not end the local session.";
  }
});

const restoreSession = async () => {
  // Persistent login (localStorage) takes priority so a returning visitor skips the NovaCore ID
  // screen entirely; the tab-scoped session is the in-memory record of that same sign-in.
  const storedLogin = readStoredLoginState();
  let serialized = null;
  try {
    serialized = sessionStorage.getItem(sessionStorageKey);
  } catch {
    if (!storedLogin.present) {
      setFormMessage("Session storage is unavailable. Sign in again after enabling storage.");
      return;
    }
  }

  if (!storedLogin.present && !serialized) {
    // Not signed in: show the NovaCore ID screen with the last signed-out ID pre-filled.
    const rememberedEmail = readRememberedEmail();
    if (rememberedEmail) {
      accountEmail.value = rememberedEmail;
      accountEmail.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }

  const clearInvalidSession = (message) => {
    try {
      clearSession();
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : message);
    }
  };

  if (storedLogin.present && !storedLogin.state) {
    clearInvalidSession("Could not clear the invalid saved login.");
    return;
  }

  let session = storedLogin.state;
  if (!session) {
    try {
      session = JSON.parse(serialized);
    } catch {
      clearInvalidSession("Could not clear the invalid local session.");
      return;
    }
    if (!session || typeof session.email !== "string" || typeof session.name !== "string") {
      clearInvalidSession("Could not clear the invalid local session.");
      return;
    }
  }

  try {
    const account = await readAccount(session.email);
    if (account && account.name === session.name) {
      await showWorkspace(account);
    } else {
      clearSession();
    }
  } catch (error) {
    setFormMessage(error instanceof Error ? error.message : "Could not restore the local session.");
  }
};

// Keep other open NovaCore tabs in step with the persistent login state.
window.addEventListener("storage", (event) => {
  if (event.key !== loginStateStorageKey || event.storageArea !== localStorage) return;
  if (event.newValue === null) {
    if (!workspaceView.hidden) {
      try {
        clearSession();
      } catch {
        // The tab-scoped data is already gone; just return to the NovaCore ID screen.
      }
      showAuth();
    }
    return;
  }
  const storedLogin = readStoredLoginState();
  if (storedLogin.state && !activeAccount) {
    restoreSession().catch(() => {
      setFormMessage("Could not restore the saved login in this tab.");
    });
  }
});

setAuthMode("login");
updateSearchEngineStatus();
initializeLocalDatabase()
  .then(restoreSession)
  .catch((error) => {
    setFormMessage(error instanceof Error ? error.message : "Could not open NovaCore's local database.");
  });
