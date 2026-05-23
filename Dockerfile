# Build stage
FROM node:22-alpine AS builder

# better-sqlite3 needs native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Production image ---
FROM node:22-alpine AS runner

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/storage/migrations ./dist/storage/migrations

# Signal Hub SQLite store lives here when SIGNAL_STORE_DRIVER=sqlite
RUN mkdir -p .data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
