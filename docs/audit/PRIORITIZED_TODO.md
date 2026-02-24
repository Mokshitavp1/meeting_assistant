# Prioritized TODO

## P0 (immediate)
1. Upgrade backend vulnerable deps (`nodemailer`, transitive `tar/rimraf/minimatch`) with regression tests.
2. Decide single local backend port (`3000` vs `4000`) and align frontend `.env` + docs.
3. Approve cleanup and remove JS shadow files in `frontend/src/**/*.js`.

## P1 (this sprint)
1. Add backend `tsconfig.test.json` and `npm run test:typecheck`.
2. Add CI checks: `npm run build`, lint, and audit thresholds.
3. Add standardized API error schema shared by frontend/backend.
4. Add server-side pagination defaults to all large list endpoints.

## P2 (next sprint)
1. Add route-level code-splitting for dashboard/meeting/task pages.
2. Introduce backend request correlation IDs and structured logging fields.
3. Add auth/session threat model doc (CSRF, token rotation, cookie policy).
4. Add DB seed variants for local/dev/staging.
