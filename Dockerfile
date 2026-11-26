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
# Download routes served by server.js (staticFiles):
#   /app-setup.exe, /downloads/app-setup.exe, /downloads/NovaCore-Setup-1.0.0.exe
#                              -> dist/NovaCore-Setup-1.0.0.exe
#   /app-debug.apk, /downloads/app-debug.apk, /downloads/NovaCore-Android-debug.apk
#                              -> downloads/app-debug.apk / downloads/NovaCore-Android-debug.apk
# Both are committed build outputs, so the image ships them. A route whose file is absent answers
# 404 "not built yet", which a visitor sees as "File wasn't available on site".
# The Windows installer is a *web* installer: /app-setup.exe hands the user a ~1.3 MB stub that
# downloads its payload from /dist/novacore-local-search-1.0.0-x64.nsis.7z on this same image.
# .dockerignore must never exclude dist/ or *.exe. Copies are split so a missing path is obvious.
COPY package.json server.js gemini-api.js content-filter.js duckduckgo-search.js ./
COPY app.html landing.html style.css bootstrap.js novacore-config.js renderer.js manifest.webmanifest service-worker.js ./
COPY icons ./icons
COPY dist/NovaCore-Setup-1.0.0.exe ./dist/NovaCore-Setup-1.0.0.exe
COPY dist/novacore-local-search-1.0.0-x64.nsis.7z ./dist/novacore-local-search-1.0.0-x64.nsis.7z
COPY dist/latest.yml ./dist/latest.yml
COPY build-windows-installer.ps1 ./build-windows-installer.ps1
COPY downloads ./downloads

# Fail the image build, not the deploy, if a local require() is missing from the COPY list above.
# Requiring server.js only defines functions (it starts listening only when run directly).
RUN node -e "require('./server.js'); require('./content-filter.js'); require('./gemini-api.js'); require('./duckduckgo-search.js');" \
  && node --check server.js \
  && node -e "const fs=require('fs');const need=['dist/NovaCore-Setup-1.0.0.exe','dist/novacore-local-search-1.0.0-x64.nsis.7z','downloads/app-debug.apk','downloads/NovaCore-Android-debug.apk'];const missing=need.filter((f)=>!fs.existsSync(f)||fs.statSync(f).size<100000);if(missing.length){console.error('Missing or truncated download(s): '+missing.join(', '));process.exit(1);}console.log('Downloads ready:',need.map((f)=>f+'='+fs.statSync(f).size).join(' '));"

# Run as the unprivileged user that ships with the official Node images.
# The downloads must be world-readable: a file copied with 0600 (which is what some Windows tooling
# writes) would leave /app-setup.exe answering 500 once the process drops to `node`.
RUN chmod -R a+rX /app && find /app/dist /app/downloads -type f -exec chmod a+r {} +
USER node

# Many providers assign a dynamic PORT; EXPOSE is documentation only, the server reads PORT.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js", "--no-open"]
