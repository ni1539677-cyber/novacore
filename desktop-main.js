const { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { generateGeminiResponse } = require("./gemini-api");
const contentFilter = require("./content-filter");
// Same DuckDuckGo client the local /api/search proxy uses; it only defines functions on load.
const { fetchDuckDuckGoWeb, fetchDuckDuckGoImages } = require("./server");

const appHtmlPath = path.join(__dirname, "app.html");
const appUrl = pathToFileURL(appHtmlPath).href;
const geminiKeyPath = () => path.join(app.getPath("userData"), "gemini-api-key.enc");
let mainWindow;

app.whenReady().then(() => {
  registerGeminiIpcHandlers();
  createMainWindow();
}).catch((error) => {
  dialog.showErrorBox(
    "NovaCore could not start",
    error instanceof Error ? error.message : "NovaCore could not start.",
  );
  app.quit();
});

function assertTrustedSender(event) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) throw new Error("This NovaCore request is not allowed.");
  let senderPath;
  try {
    senderPath = fileURLToPath(new URL(frameUrl));
  } catch {
    throw new Error("This NovaCore request is not allowed.");
  }
  if (path.resolve(senderPath) !== path.resolve(appHtmlPath)) {
    throw new Error("This NovaCore request is not allowed.");
  }
}

async function readGeminiApiKey() {
  let encrypted;
  try {
    encrypted = await fs.readFile(geminiKeyPath(), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw new Error("Could not read the encrypted Gemini API key.");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption is unavailable, so NovaCore cannot safely read the saved Gemini API key.");
  }
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    throw new Error("The saved Gemini API key could not be decrypted. Remove it and save the key again.");
  }
}

function registerGeminiIpcHandlers() {
  ipcMain.handle("gemini-key-status", async (event) => {
    assertTrustedSender(event);
    return { configured: Boolean(await readGeminiApiKey()) };
  });
  ipcMain.handle("save-gemini-api-key", async (event, apiKey) => {
    assertTrustedSender(event);
    if (typeof apiKey !== "string" || apiKey.trim().length < 10 || apiKey.length > 512) {
      throw new Error("Enter a valid Google Gemini API key.");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption is unavailable. NovaCore will not save this API key without encryption.");
    }
    const encrypted = safeStorage.encryptString(apiKey.trim()).toString("base64");
    try {
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      await fs.writeFile(geminiKeyPath(), encrypted, { encoding: "utf8", mode: 0o600 });
    } catch {
      throw new Error("Could not save the encrypted Gemini API key.");
    }
    return { configured: true };
  });
  ipcMain.handle("remove-gemini-api-key", async (event) => {
    assertTrustedSender(event);
    try {
      await fs.unlink(geminiKeyPath());
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw new Error("Could not remove the saved Gemini API key.");
      }
    }
    return { configured: false };
  });
  ipcMain.handle("generate-gemini-response", async (event, prompt) => {
    assertTrustedSender(event);
    if (typeof prompt !== "string" || prompt.length > 4000) {
      throw new Error("Enter a prompt between 1 and 4,000 characters.");
    }
    const apiKey = await readGeminiApiKey();
    return generateGeminiResponse({
      apiKey,
      prompt,
      fetchImpl: (url, options) => net.fetch(url, options),
    });
  });
  ipcMain.handle("web-search", async (event, query) => {
    assertTrustedSender(event);
    if (typeof query !== "string" || !query.trim() || query.length > 4000) {
      throw new Error("Enter a search query between 1 and 4,000 characters.");
    }
    return searchDuckDuckGo(query.trim());
  });
}

// The desktop window loads app.html from disk, so it has no same-origin /api/search proxy.
// The main process runs the same DuckDuckGo lookup instead and returns the same payload shape.
async function searchDuckDuckGo(query) {
  if (contentFilter.containsBlockedTerm(query)) {
    throw new Error(contentFilter.blockedMessage);
  }
  const signal = AbortSignal.timeout(25_000);
  const [web, images] = await Promise.allSettled([
    fetchDuckDuckGoWeb(query, signal),
    fetchDuckDuckGoImages(query, signal),
  ]);
  const webResults = web.status === "fulfilled"
    ? web.value.filter((result) => !contentFilter.containsBlockedTerm(
      `${result.title} ${result.description} ${result.source} ${result.url}`,
    )) : [];
  const imageResults = images.status === "fulfilled"
    ? images.value.filter((result) => !contentFilter.containsBlockedTerm(
      `${result.title} ${result.source} ${result.pageUrl} ${result.imageUrl}`,
    )) : [];
  const warnings = [];
  if (web.status === "rejected") warnings.push(`Web results unavailable: ${web.reason?.message || "DuckDuckGo search failed."}`);
  if (images.status === "rejected") warnings.push(`Image results unavailable: ${images.reason?.message || "DuckDuckGo image search failed."}`);
  if (warnings.length === 2) {
    const failures = [web.reason, images.reason];
    throw new Error(failures.find((error) => typeof error?.message === "string" && error.message)?.message ||
      "DuckDuckGo could not complete the search. Check the network connection and try again.");
  }
  return { provider: "DuckDuckGo", query, webResults, imageResults, warnings };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 360,
    minHeight: 640,
    title: "NovaCore",
    backgroundColor: "#080b17",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    let destination;
    try {
      destination = fileURLToPath(new URL(url));
    } catch {
      event.preventDefault();
      openExternalUrl(url);
      return;
    }
    if (path.resolve(destination) === path.resolve(appHtmlPath)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(appHtmlPath);
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      void shell.openExternal(url.href);
    }
  } catch {
    dialog.showErrorBox("Invalid link", "NovaCore could not open this external address.");
  }
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
