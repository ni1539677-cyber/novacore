# NovaCore search + Gemini proxy for public hosting (Render, Fly.io, Railway, a VPS, ...).
# The image is intentionally tiny: the server uses only Node.js built-ins.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Only the files the server actually serves/needs. No node_modules required.
# Every local module server.js requires must be listed here, or the container starts and then
# exits with "Cannot find module". The RUN below proves the list is complete at build time.
COPY package.json server.js gemini-api.js content-filter.js duckduckgo-search.js ./
COPY app.html landing.html style.css bootstrap.js novacore-config.js renderer.js manifest.webmanifest service-worker.js ./
COPY icons ./icons
# The landing page's Android download points at this build output. Without it the served page
# would answer 404 for its own download button.
COPY downloads ./downloads

# Fail the image build, not the deploy, if a local require() is missing from the COPY list above.
# Requiring server.js only defines functions (it starts listening only when run directly).
RUN node -e "require('./server.js'); require('./content-filter.js'); require('./gemini-api.js'); require('./duckduckgo-search.js');" \
  && node --check server.js

# Run as the unprivileged user that ships with the official Node images.
USER node

# Many providers assign a dynamic PORT; EXPOSE is documentation only, the server reads PORT.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js", "--no-open"]
