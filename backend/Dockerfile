# syntax=docker/dockerfile:1

# Production image for the SMS + Open Payments backend.
# The server runs TypeScript directly, so `tsx` is a runtime dependency.
# Dev-only tools (vitest, embedded-postgres, typescript, @types) are skipped.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; the server reads it from the environment.
CMD ["npm", "start"]
