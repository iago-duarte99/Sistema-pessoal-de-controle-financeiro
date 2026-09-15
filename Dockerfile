FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

# Preserve the repository layout required by Express and shared imports.
COPY index.html app.js styles.css auth.css ./
COPY js/ ./js/
COPY assets/ ./assets/
COPY backend/server.js backend/services-schema.js ./backend/
COPY backend/src/ ./backend/src/

USER node
CMD ["npm", "--prefix", "backend", "start"]
