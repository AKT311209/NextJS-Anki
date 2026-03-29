# Implementation Status Log

## 2026-03-29

- Revised `DOCS/plan.md` to prioritize potential quick wins (quick-track slices) before full parity.
	- Added **Potential Quicks (Quick Wins)** table with scope, deferrals, and exit criteria.
	- Added **Revised Fast-Track Sequence** to reduce time-to-first-value while preserving architecture.
	- Added **Quick-Track Gates** under verification checklist.
- Added `DOCS/implementation.md` with a detailed step-by-step implementation plan.
	- Organized into **Quick-Win Track (Steps 1–8)** and **Parity Track (Steps 9–16)**.
	- Included objectives, ordered tasks, deliverables, and acceptance gates for each step.
	- Added milestone definitions and cross-step quality gates.

- Implemented **Phase 0: Project Scaffolding**.
	- Bootstrapped a complete Next.js + TypeScript + Tailwind + App Router project structure in-repo.
	- Installed and configured core dependencies: `ts-fsrs`, `wa-sqlite`, `sql.js`, `zustand`, `comlink`, `next-pwa`, and shadcn prerequisites.
	- Added `next.config.ts` with:
		- WebAssembly support for `wa-sqlite`
		- Explicit local dev origin allowances
		- COOP/COEP/CORP headers for browser storage/runtime isolation requirements
		- PWA integration via `next-pwa`
	- Added testing toolchain:
		- `vitest` + RTL setup (`vitest.config.ts`, `src/test/setup.ts`, unit smoke test)
		- `playwright` config and e2e smoke test
	- Created the planned scaffold directories and placeholder files across:
		- `src/lib/*` (storage, scheduler, rendering, search, import-export, media, types)
		- `src/workers/*`
		- `src/hooks/*`
		- `src/components/*`
		- `src/stores/*`
		- `src/app/*` route skeleton pages
	- Added PWA manifest and icon assets in `public/`.
	- Updated root `.gitignore` for Next/Node/test artifacts while preserving `ANKIDESKTOP` ignore.
	- Key implementation decisions:
		- `create-next-app` could not scaffold directly in this folder because `NextJS-Anki` violates npm lowercase package-name constraints; scaffold was created manually to keep project at repository root.
		- Next.js 16 defaults to Turbopack, which conflicts with custom webpack/WASM config; scripts were pinned to `--webpack` for deterministic behavior.
		- TypeScript includes were restricted to this project (`src/`, `tests/`) so the read-only upstream `ANKIDESKTOP/` reference tree is not typechecked.
	- Verification completed:
		- `npm run typecheck` ✅
		- `npm run lint` ✅
		- `npm test` ✅
		- `npm run test:e2e` ✅
		- `npm run build` ✅

