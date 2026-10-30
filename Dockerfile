# Digiteq Studio: one container serving the web app and the API.
FROM node:24-slim

# ffmpeg places the logo on images and videos, and renders demo-mode clips.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so code changes don't reinstall everything.
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci --prefix server --omit=dev && npm ci --prefix web

COPY server server
COPY web web
RUN npm run build --prefix web && rm -rf web/node_modules

ENV NODE_ENV=production \
    DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/src/index.js"]
