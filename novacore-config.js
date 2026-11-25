// NovaCore deployment configuration.
//
// Classic script (not inline, not a module) that loads before renderer.js, so the packaged
// desktop and Android builds can point at a hosted API instead of a localhost server.
//
// Set an absolute API origin, or leave it empty to use the same origin as the page:
//   window.NOVACORE_API_BASE = "https://novacore-api.onrender.com";
//   window.NOVACORE_API_BASE = "https://my-vps.example.com:8443";
//   window.NOVACORE_API_BASE = "https://app.novacore.example/";  // a trailing slash is fine
//
// The host must allow this app's origin in NOVACORE_PUBLIC_ORIGIN, otherwise the API answers
// HTTP 403. The Android page loads from file://, so its requests carry the origin "null"; start
// the server with:
//   NOVACORE_PUBLIC_ORIGIN=null HOST=0.0.0.0
// (see parseOriginList/allowedCorsOrigin in server.js, which accept the literal origin "null").
//
// Leave it empty for the default `npm start` server and the Electron desktop build.
window.NOVACORE_API_BASE = "";
