// Vercel serverless adapter for the NovaCore proxy.
//
// Vercel cannot run server.js as a long-lived process, so each API route is an HTTP function.
// Rather than re-implementing search/Gemini, this starts the real server once on a loopback port
// inside the function instance and forwards the request to it, so validation, CORS rules, the
// content filter, rate limiting, and response shapes stay identical to the Docker/Render build.
//
// Required environment variables:
//   NOVACORE_PUBLIC_ORIGIN  the deployed site origin allowed to call this API
//   NOVACORE_TRUST_PROXY    "true" (Vercel sits behind a proxy)
// Optional:
//   NOVACORE_GEMINI_API_KEY server-side Gemini key
const http = require("node:http");
const { startServer, serverAddress } = require("../server");

let serverReady;

async function ensureServer() {
  if (!serverReady) {
    // Vercel sits behind a proxy, so rate limits must key off the client address header here too.
    process.env.NOVACORE_TRUST_PROXY = "true";
    // The real listener's port is read back below; startServer's resolved value is not the port.
    serverReady = startServer({ openBrowser: false, port: 0, host: "127.0.0.1" }).then(() => {
      const address = serverAddress();
      if (!address || typeof address !== "object") {
        throw new Error("NovaCore proxy did not expose a listening port.");
      }
      return address.port;
    });
  }
  return serverReady;
}

module.exports = async function handler(request, response) {
  const port = await ensureServer();
  const body = request.body === undefined
    ? ""
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      method: request.method,
      path: request.url,
      headers: {
        "Content-Type": request.headers["content-type"] || "application/json",
        ...(request.headers["x-goog-api-key"] ? { "x-goog-api-key": request.headers["x-goog-api-key"] } : {}),
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(request.headers["x-forwarded-for"] ? { "x-forwarded-for": request.headers["x-forwarded-for"] } : {}),
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers.connection;
      delete headers["keep-alive"];
      delete headers["transfer-encoding"];
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.statusCode = 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "NovaCore's proxy could not complete this request. Try again." }));
  });
  if (body) upstream.write(body);
  upstream.end();
};
