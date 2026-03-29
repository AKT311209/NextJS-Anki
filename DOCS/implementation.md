# NextJS-Anki — Detailed Implementation Plan

> Goal: deliver a usable, offline-capable spaced-repetition web app quickly, then expand to Anki-compatible parity in controlled increments.

---

## 0) Execution Strategy

Use **two tracks**:

1. **Quick-Win Track (MVP first)**
   - Ship working review flow early.
   - De-risk storage, scheduler, and rendering before broad UI work.
2. **Parity Track (full Anki-compatible scope)**
   - Add advanced search, import/export completeness, stats depth, and future sync.

Each step below has:
- **Objective**
- **Tasks** (ordered)
- **Deliverables**
- **Acceptance Gate**

---

## Quick-Win Track (Steps 1–8)

### Step 1 — Bootstrap & Guardrails

**Objective**: Ensure a stable development base with strict typing and test plumbing.

**Tasks**
1. Scaffold/verify Next.js 15 app-router setup with TypeScript strict mode.
2. Install baseline dependencies (`zustand`, `comlink`, `ts-fsrs`, `wa-sqlite`, `sql.js`, test tooling).
3. Configure lint, format, unit test, and e2e test scripts.
4. Add architecture folder skeleton from `plan.md`.
5. Add CI baseline workflow (typecheck + unit tests).

**Deliverables**
- Running app shell
- Green typecheck and baseline test run
- Stable folder conventions for feature work

**Acceptance Gate**
- `dev`, `typecheck`, and `test` commands complete successfully.

---

### Step 2 — Storage Core (Minimal Schema First)

**Objective**: Persist core study data in browser SQLite with OPFS primary path.

**Tasks**
1. Implement DB initialization module with:
   - wa-sqlite + OPFS (primary)
   - sql.js fallback path for non-OPFS environments
2. Create initial schema migration with essential tables:
   - `col`, `notes`, `cards`, `revlog`
3. Add required indexes for queue and note lookup.
4. Implement transaction helpers and error boundaries.
5. Add simple seed function for default deck + notetype metadata.

**Deliverables**
- `database.ts` + migration scripts
- Deterministic schema versioning
- Re-openable persistent collection

**Acceptance Gate**
- Fresh DB initializes once, reopens cleanly, and preserves inserted note/card data after reload.

---

### Step 3 — Repository Layer (CRUD + Query Contracts)

**Objective**: Expose stable storage APIs used by scheduler and UI.

**Tasks**
1. Implement repositories for `notes`, `cards`, and `revlog`.
2. Add deck-facing read helpers (due counts, queue candidates).
3. Add duplicate-detection helper for notes.
4. Add repository unit tests with realistic fixtures.
5. Add error mapping (DB errors → user-safe messages).

**Deliverables**
- Tested repository interfaces
- Query primitives for queue building

**Acceptance Gate**
- CRUD + due-query tests pass consistently on clean and seeded databases.

---

### Step 4 — Scheduler MVP (New/Learn/Review)

**Objective**: Support answer flow with correct card state transitions and interval updates.

**Tasks**
1. Implement scheduler context model (deck config + now + timezone).
2. Build queue order logic: learn/relearn → review → new.
3. Wrap `ts-fsrs` for review scheduling and memory state updates.
4. Implement rating handler (`Again/Hard/Good/Easy`) that:
   - updates card state
   - writes revlog entry
   - returns next-interval previews
5. Add deterministic tests for transition paths and interval outputs.

**Deliverables**
- `engine.ts`, `queue.ts`, `answering.ts` MVP versions
- Scheduler regression tests (golden fixtures)

**Acceptance Gate**
- For fixture cards, state transitions and intervals match expected baseline outputs.

---

### Step 5 — Template Rendering MVP

**Objective**: Render common card types reliably for review.

**Tasks**
1. Implement parser/renderer for:
   - `{{Field}}`
   - `{{#Field}}...{{/Field}}`
   - `{{^Field}}...{{/Field}}`
   - `{{FrontSide}}`
2. Implement cloze MVP: `{{c1::text}}` and `{{c1::text::hint}}`.
3. Add basic filter support (`text`, default raw HTML path).
4. Add sanitization layer for rendered output.
5. Add fixture tests for Basic, Basic+Reverse, Cloze notetypes.

**Deliverables**
- Rendering pipeline modules
- Snapshot/fixture rendering tests

**Acceptance Gate**
- Built-in sample notes render correctly on question and answer sides.

---

### Step 6 — Review Vertical Slice UI

**Objective**: Ship first end-to-end study workflow in browser.

**Tasks**
1. Build review page with card display and reveal/answer flow.
2. Add answer buttons + keyboard shortcuts (`1..4`, space).
3. Wire state store (`review-store`) to scheduler + repositories.
4. Show progress indicators and empty-session state.
5. Add basic undo-last-answer support.

**Deliverables**
- Functional review screen
- Integrated scheduler + renderer path

**Acceptance Gate**
- User can create sample note and complete at least one full review cycle with persisted result.

---

### Step 7 — Search MVP + Browser MVP

**Objective**: Enable users to find and inspect cards rapidly.

**Tasks**
1. Implement search parser subset:
   - plain text
   - `deck:`
   - `note:`
   - `tag:`
   - `is:due`
2. Convert AST subset to SQL WHERE clauses.
3. Build browser page table with pagination + sorting.
4. Add preview pane for selected card.
5. Add integration tests for each supported operator.

**Deliverables**
- Search parser + SQL builder MVP
- Browser page with usable card inspection workflow

**Acceptance Gate**
- Supported search operators produce accurate and stable results on fixture collection.

---

### Step 8 — Offline Baseline + Backup Safety

**Objective**: Guarantee “no network, still usable” behavior.

**Tasks**
1. Configure PWA app shell caching.
2. Ensure WASM assets are cached and available offline.
3. Add online/offline indicator in UI.
4. Add manual backup export action (collection package or DB snapshot).
5. Validate cold-start offline behavior with persisted data.

**Deliverables**
- Installable/offline-capable baseline
- User-visible backup path

**Acceptance Gate**
- App launches offline and supports review with existing local data.

---

## Parity Track (Steps 9–16)

### Step 9 — Complete Storage Compatibility

**Objective**: Reach near-schema parity with Anki-compatible structures.

**Tasks**
1. Add remaining tables (`graves`, config and metadata structures as needed).
2. Add custom SQL functions needed by search and FSRS data extraction.
3. Expand migration strategy for forward schema evolution.
4. Add migration tests for upgrade paths.

**Acceptance Gate**
- Collection can evolve across schema versions without data loss.

---

### Step 10 — Full Scheduler Features

**Objective**: Align scheduler behavior with advanced Anki expectations.

**Tasks**
1. Add relearning edge cases and interday learning handling.
2. Implement bury/suspend/leech handling.
3. Add interval fuzzing behavior.
4. Add optional parameter optimization workflow.
5. Add comparison tests against curated expected scheduler outcomes.

**Acceptance Gate**
- Advanced transition and burying behavior validated via fixture suite.

---

### Step 11 — Full Rendering Features

**Objective**: Expand template fidelity and media/math behavior.

**Tasks**
1. Add extended filters (`type`, furigana/kana/kanji, tts where applicable).
2. Add advanced parser behavior (comments, delimiter switching if needed).
3. Integrate math rendering pipeline and caching.
4. Harden sanitizer/media resolution paths.

**Acceptance Gate**
- Complex templates and math-heavy cards render correctly and safely.

---

### Step 12 — Deck/Note/Notetype Management UX

**Objective**: Provide robust authoring and management features.

**Tasks**
1. Deck tree CRUD + hierarchy operations.
2. Note editor with tag management + live card preview.
3. Notetype manager for fields/templates/CSS edits.
4. Deck options UI for scheduling limits and FSRS settings.

**Acceptance Gate**
- Users can create and maintain full study content without leaving the app.

---

### Step 13 — Import/Export (.apkg + CSV)

**Objective**: Interoperate with existing Anki ecosystems.

**Tasks**
1. Implement `.apkg` reader (ZIP + SQLite extraction + media mapping).
2. Implement `.apkg` writer with ID remapping and media packaging.
3. Implement CSV import with field mapping and duplicate handling.
4. Add import/export worker for heavy operations.

**Acceptance Gate**
- Import/export roundtrip succeeds on representative decks and media.

---

### Step 14 — Statistics & Analytics

**Objective**: Deliver high-value learning feedback.

**Tasks**
1. Build aggregate queries for retention and workload trends.
2. Implement key charts (heatmap, retention, forecast, interval distribution).
3. Add deck-level filtering and date-range controls.
4. Validate chart correctness against fixture review histories.

**Acceptance Gate**
- Displayed stats are internally consistent and reproducible.

---

### Step 15 — Performance & Workerization Hardening

**Objective**: Keep UI responsive on large collections.

**Tasks**
1. Move heavy scheduler/search/import operations to workers.
2. Add pagination and incremental rendering in browser tables.
3. Add lightweight performance instrumentation (query timing, worker latency).
4. Set performance budgets and regression checks.

**Acceptance Gate**
- Core interactions remain responsive on large fixture collections.

---

### Step 16 — Release Readiness & Future Sync Boundary

**Objective**: Stabilize v1 standalone and prepare sync-ready architecture.

**Tasks**
1. Run full QA matrix (unit, integration, e2e, offline checks).
2. Finalize backup/restore UX and user-facing safeguards.
3. Document non-goals and sync boundary interfaces.
4. Prepare release notes and migration guide.

**Acceptance Gate**
- v1 passes full test matrix and documentation is complete for handoff.

---

## Suggested Milestones

- **M1 (end of Step 4):** Persistent collection + scheduler core functional
- **M2 (end of Step 6):** End-to-end review MVP shipped
- **M3 (end of Step 8):** Offline baseline + backup safety complete
- **M4 (end of Step 13):** Import/export interoperability complete
- **M5 (end of Step 16):** Stable standalone release candidate

---

## Quality Gates (Apply to Every Step)

1. Add/update tests for each behavior change.
2. Keep migrations forward-safe and idempotent.
3. Avoid blocking main-thread work for heavy tasks.
4. Preserve schema and scheduling compatibility assumptions documented in `analyze_ankidesktop.md`.
5. Record completed work in `DOCS/status.md` in chronological order.
