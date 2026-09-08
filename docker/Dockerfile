# Multi-stage Dockerfile for CapRover deployment
# Build from repo root: docker build -f docker/Dockerfile .

# 1. Build stage: compile contracts, web frontend, and api
FROM node:22-alpine AS build
WORKDIR /repo

# Copy workspace manifests
COPY package.json package-lock.json turbo.json biome.json ./
COPY packages ./packages

# Install full dependencies (including devDependencies needed for build)
RUN npm ci

# Build API and its dependencies (@tombola/contracts)
RUN npx turbo run build --filter=@tombola/api...

# 2. Production dependencies only stage
FROM node:22-alpine AS prod-deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages ./packages

RUN npm ci --omit=dev

# 3. Production runner stage
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /repo

# Ensure persistent storage mount directory exists with permissions for node user
RUN mkdir -p /app/data && chown -R node:node /app/data /repo
ENV DATA_DIR=/app/data
ENV PORT=3000

# Copy node_modules and built workspace packages with non-root ownership
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/packages ./packages

USER node

EXPOSE 3000

# Run API server (serves Fastify API and WebSockets)
CMD ["node", "packages/api/dist/index.js"]
