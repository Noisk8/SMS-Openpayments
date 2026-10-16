# syntax=docker/dockerfile:1

# Production image for the SMS + Open Payments backend.
# tsx is required at runtime (the server runs TypeScript directly), so the image
# installs all dependencies rather than only production ones.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; the server reads it from the environment.
CMD ["npm", "start"]
