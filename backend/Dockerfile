# =============================================================================
# Backend Production Dockerfile — Multi-stage build
# Result: ~200 MB Alpine image with only production dependencies
# =============================================================================

# ---------- Stage 1: Build ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install production + dev dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: Production ----------
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema + generated client
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled JS
COPY --from=builder /app/dist ./dist

# Copy email templates
COPY src/templates ./dist/templates

# Create uploads directory
RUN mkdir -p uploads && chown -R appuser:appgroup /app

USER appuser

# Expose app port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:4000/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
