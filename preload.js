const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaCoreDesktop", Object.freeze({
  getGeminiKeyStatus: () => ipcRenderer.invoke("gemini-key-status"),
  saveGeminiApiKey: (apiKey) => ipcRenderer.invoke("save-gemini-api-key", apiKey),
  removeGeminiApiKey: () => ipcRenderer.invoke("remove-gemini-api-key"),
  generateGeminiResponse: (prompt) => ipcRenderer.invoke("generate-gemini-response", prompt),
  searchWeb: (query) => ipcRenderer.invoke("web-search", query),
}));
