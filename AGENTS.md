# AGENTS.md

## Cursor Cloud specific instructions

This repo is a Japanese care-taxi (介護タクシー) cloud fare-meter PWA. It contains three
npm packages, each with its own `package.json` + `package-lock.json`:

- root — React 19 + Vite 8 frontend (the meter + `/accounting` module)
- `functions/` — Firebase Cloud Functions (`engines.node` = 20)
- `workers/driver-proxy/` — Cloudflare Worker reservation proxy

Standard commands live in `README.md` and each `package.json` `scripts`. Notable ones:
`npm run dev` (frontend dev server), `npm run build`, `npm run lint`, `npm run test`
(vitest), `npm run test:driver-proxy` (worker tests via `tsx --test`), and
`npm run build --prefix functions` (functions `tsc`). The update script already runs
`npm ci` in all three packages.

Non-obvious caveats:

- **Dev server base path**: Vite `base` is `/care-taxi-meter/`, so the app is served at
  `http://localhost:5173/care-taxi-meter/` — the bare `http://localhost:5173/` returns a
  blank/404. Use the full base path (including for API/proxy paths).
- **Firebase is required for real login/data, and there is NO emulator wiring**. The app
  reads `VITE_FIREBASE_*` from `.env.local` (copy `.env.example`) and talks to a live
  Firebase project; login (`loginStaff` callable) and Firestore-backed screens will not
  work without valid credentials. Do not expect a local Firebase emulator to be picked up.
- **Test core meter functionality WITHOUT Firebase/login via review-demo mode**: routes
  `/care-taxi-meter/review-demo/reservations` and `/care-taxi-meter/review-demo/case` run a
  self-contained demo (fixed coordinates, in-memory demo session) that exercises the
  meter → fare breakdown → settlement flow. Review-demo mode blocks all production writes,
  so it is the fastest way to verify the app end-to-end locally.
- **Lint currently reports pre-existing errors** (`npm run lint`) in the committed source;
  a clean lint exit is not the baseline. Do not assume you introduced them.
- Optional integrations (Google Maps geocoding, `reservation-v4` reservation proxy, NTA
  invoice lookup) are inactive unless their env vars are set in `.env.local`; the core app
  runs without them.
