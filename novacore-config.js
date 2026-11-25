// NovaCore deployment configuration.
//
// Classic script (not inline, not a module) that loads before renderer.js, so the packaged
// desktop and Android builds can point at a hosted API.
//
// The packaged builds (the Windows .exe and the Android .apk both load their page from file://)
// and every page NovaCore itself serves default to the live production server. Set an absolute
// origin here only to override it, e.g. a staging server:
//   window.NOVACORE_API_BASE = "https://my-vps.example.com:8443";
// (a trailing slash is fine)
//
// Leave it empty to use the default above. renderer.js decides the actual origin, so this file
// never has to list localhost for `npm start`.
//
// The host must allow a packaged app's origin in NOVACORE_PUBLIC_ORIGIN, otherwise the API answers
// HTTP 403. The .apk/.exe page loads from file://, so its requests carry the origin "null"; the
// server must therefore run with:
//   NOVACORE_PUBLIC_ORIGIN=null
// (see parseOriginList/allowedCorsOrigin in server.js, which accept the literal origin "null").
window.NOVACORE_API_BASE = "";
