# Repository Guidelines

## Project Structure & Module Organization
- App lives in `floodi/` (Ionic React + Vite + TypeScript).
- Source code: `floodi/src/` (components, pages, contexts, utils, types, assets).
- Tests: unit near sources (e.g., `App.test.tsx`) and `src/__tests__/`.
- E2E: Cypress (config in `floodi/cypress.config.ts`).
- Build output: `floodi/dist/`.
- Docs: `floodi/API.md`, `floodi/ARCHITECTURE.md`, `floodi/DEPENDENCIES.md`.

## Build, Test, and Development Commands
Run inside `floodi/`:
- `npm run dev` — start Vite dev server at `http://localhost:5173`.
- `npm run build` — type‑check then create production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run test.unit` — run unit tests (Vitest + Testing Library).
- `npm run test.e2e` — run Cypress tests (baseUrl `http://localhost:5173`).
- `npm run lint` — run ESLint over `*.ts, *.tsx`.

## Coding Style & Naming Conventions
- TypeScript strict mode; React 19; 2‑space indentation.
- Components: PascalCase filenames in `src/components`/`src/pages` (e.g., `TideChart.tsx`).
- Variables/functions: camelCase; types/interfaces: PascalCase (`StationId`).
- Avoid default exports for components; prefer named exports.
- Linting via ESLint (`eslint.config.js`): React Hooks rules enforced; console/debugger warned in production.
- Paths: use `src/*` alias from `tsconfig.json` (e.g., `import { AuthProvider } from 'src/contexts/AuthContext'`).

## Testing Guidelines
- Unit tests colocated or in `src/__tests__`; name `*.test.tsx/ts`.
- Use Testing Library for React components; keep tests behavior‑focused.
- E2E with Cypress; ensure the dev server is running for local runs.
- Aim for meaningful coverage on core flows (login, station switch, charts).

## Commit & Pull Request Guidelines
- Commits: imperative, concise subject (e.g., "Fix iOS status bar overlap"). Conventional commits welcome (`feat:`, `fix:`) but not required.
- PRs: include purpose, linked issues, testing notes, and screenshots/GIFs for UI changes. Update docs when APIs or architecture change.

## Security & Configuration Tips
- Copy `floodi/.env.example` to `.env`; never commit secrets. Firebase and API keys belong in env files or CI secrets.
- Review `firebase.json` and `codemagic.yaml` before deploying.
