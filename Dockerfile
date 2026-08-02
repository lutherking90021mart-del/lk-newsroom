# Production image for Railway and other container hosts.
FROM node:20-alpine

WORKDIR /app

# Install the locked dependency set first to keep builds reproducible.
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code after dependencies so ordinary code changes reuse the cache.
COPY . .

ENV NODE_ENV=production
EXPOSE 5173

CMD ["npm", "run", "start"]
