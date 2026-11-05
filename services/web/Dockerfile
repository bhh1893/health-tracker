# Build stage: Node, node_modules and the sources. None of it reaches the final image.
# The tag must match .node-version; CI fails if it does not.
FROM node:26.13.0-trixie-slim AS build
WORKDIR /app

# Dependencies first: this layer is reused until the lockfile changes, not on every edit.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# Final stage: nginx and static files only. The image holds no environment-specific
# value, so the same image runs on Vagrant and in any cloud (ADR 0007).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Numeric so Kubernetes runAsNonRoot can verify it without reading /etc/passwd.
# Same uid as the base image; stated here so this file shows it.
USER 101
EXPOSE 8080
