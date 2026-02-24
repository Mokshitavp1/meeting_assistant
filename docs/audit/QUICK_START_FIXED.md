# Quick Start Guide (Fixed Project)

## 1) Prerequisites
- Node.js >= 18
- npm >= 9
- Docker (PostgreSQL + Redis)

## 2) Environment Setup

1. Copy templates:
   - `cp backend/.env.example backend/.env`
   - `cp frontend/.env.example frontend/.env`
2. Ensure at minimum:
   - backend: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
   - frontend: `VITE_API_URL`, `VITE_SOCKET_URL`

## 3) Start Infrastructure
- From repo root:
  - `docker compose -f docker/docker-compose.yml up -d`

## 4) Backend Setup
- `cd backend`
- `npm install`
- `npx prisma generate`
- `npx prisma migrate dev`
- Optional seed:
  - set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`
  - run `npm run seed`
- Run backend:
  - `npm run dev`

## 5) Frontend Setup
- `cd frontend`
- `npm install`
- `npm run dev`

## 6) Build Verification
- Backend: `cd backend && npm run build`
- Frontend: `cd frontend && npm run build`

## 7) Known Follow-up Actions
- Resolve backend `npm audit` high vulnerabilities before production release.
- Decide and standardize API port (`3000`/`4000`) in env files and docs.
- Remove JS shadow files from `frontend/src` after approval.
