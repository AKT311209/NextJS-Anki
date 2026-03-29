# NextJS-Anki — Migration Plan

> Migrate Anki Desktop to a NextJS web-based, client-first application.
> All logic & storage runs in the browser. FSRS scheduling preserved faithfully.

---

## Guiding Principles

1. **Client-first**: All computation in the browser (Web Workers for heavy ops)
2. **FSRS fidelity**: Use `ts-fsrs` — the battle-tested TypeScript port of FSRS v6
3. **Anki compatibility**: Import/export `.apkg` files, preserve SQLite schema for data portability
4. **Offline-capable**: PWA with Service Worker, OPFS for persistent storage
5. **Progressive enhancement**: Core review works offline; sync is a future add-on

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) | SSR for initial load, client for all logic |
| Language | TypeScript (strict) | Type safety across entire codebase |
| UI | shadcn/ui + TailwindCSS v4 | Accessible, composable, performant |
| State | Zustand | Lightweight, works with Web Workers |
| Scheduler | ts-fsrs | Official TS port of FSRS, browser-compatible |
| Storage | wa-sqlite + OPFS VFS | Full SQLite in browser, best perf |
| Fallback storage | sql.js + IndexedDB | Compatibility for older browsers |
| Media | OPFS (Origin Private File System) | Binary file storage, high perf |
| Offline | next-pwa + Workbox | Service Worker caching |
| Heavy compute | Web Workers (comlink) | Non-blocking FSRS, search, import |
| Math rendering | KaTeX or MathJax 3 | LaTeX rendering in cards |
| Charts | Recharts or D3.js | Statistics visualizations |
| i18n | next-intl | Internationalization support |
| Testing | Vitest + Playwright | Unit + E2E testing |

---

## Project Structure

```
src/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx
│   ├── page.tsx                  # Deck list (home)
│   ├── review/
│   │   └── [deckId]/page.tsx     # Review session
│   ├── browse/
│   │   └── page.tsx              # Card browser
│   ├── editor/
│   │   └── [noteId]/page.tsx     # Note editor
│   ├── stats/
│   │   └── page.tsx              # Statistics
│   ├── import/
│   │   └── page.tsx              # Import
│   ├── settings/
│   │   └── page.tsx              # Settings
│   └── deck/
│       └── [deckId]/
│           ├── page.tsx          # Deck detail
│           └── options/page.tsx  # Deck options
│
├── lib/
│   ├── storage/                  # Storage layer
│   │   ├── database.ts           # wa-sqlite connection manager
│   │   ├── schema.ts             # Schema definition & migrations
│   │   ├── repositories/         # Data access objects
│   │   │   ├── cards.ts
│   │   │   ├── notes.ts
│   │   │   ├── decks.ts
│   │   │   ├── notetypes.ts
│   │   │   ├── revlog.ts
│   │   │   ├── media.ts
│   │   │   └── config.ts
│   │   └── sql-functions.ts      # Custom SQL functions (field_at_index, etc.)
│   │
│   ├── scheduler/                # Scheduling engine
│   │   ├── engine.ts             # Scheduler core (wraps ts-fsrs)
│   │   ├── states.ts             # State machine (New/Learn/Review/Relearn)
│   │   ├── queue.ts              # Queue builder (fetches due cards)
│   │   ├── answering.ts          # Card answering logic
│   │   ├── fuzz.ts               # Interval fuzzing
│   │   ├── burying.ts            # Sibling/user bury logic
│   │   └── params.ts             # FSRS parameter optimization
│   │
│   ├── rendering/                # Card rendering
│   │   ├── template-parser.ts    # Mustache-like template → AST
│   │   ├── template-renderer.ts  # AST → HTML with field substitution
│   │   ├── cloze.ts              # Cloze deletion processing
│   │   ├── filters.ts            # Built-in filters (text, type, tts, etc.)
│   │   ├── math.ts               # LaTeX/MathJax processing
│   │   └── sanitizer.ts          # HTML sanitization
│   │
│   ├── search/                   # Search system
│   │   ├── parser.ts             # Search string → AST
│   │   ├── sql-builder.ts        # AST → SQL WHERE clause
│   │   └── nodes.ts              # SearchNode type definitions
│   │
│   ├── import-export/            # Import/Export
│   │   ├── apkg-reader.ts        # .apkg → parsed data
│   │   ├── apkg-writer.ts        # Data → .apkg file
│   │   ├── csv-import.ts         # CSV import
│   │   └── media-handler.ts      # Media file management
│   │
│   ├── media/                    # Media management
│   │   ├── store.ts              # OPFS media storage
│   │   └── references.ts         # Media reference tracking
│   │
│   └── types/                    # Shared type definitions
│       ├── card.ts
│       ├── note.ts
│       ├── deck.ts
│       ├── notetype.ts
│       ├── revlog.ts
│       └── scheduler.ts
│
├── workers/                      # Web Workers
│   ├── scheduler.worker.ts       # FSRS computation
│   ├── search.worker.ts          # Search execution
│   └── import.worker.ts          # Import processing
│
├── hooks/                        # React hooks
│   ├── use-collection.ts         # Collection lifecycle
│   ├── use-review.ts             # Review session state
│   ├── use-decks.ts              # Deck CRUD
│   ├── use-search.ts             # Search with results
│   └── use-stats.ts              # Statistics data
│
├── components/                   # UI components
│   ├── review/
│   │   ├── ReviewCard.tsx        # Card display
│   │   ├── AnswerButtons.tsx     # Again/Hard/Good/Easy
│   │   ├── ReviewProgress.tsx    # Session progress bar
│   │   └── CardHtml.tsx          # Rendered card HTML
│   ├── deck/
│   │   ├── DeckList.tsx
│   │   ├── DeckCard.tsx
│   │   └── DeckTree.tsx
│   ├── editor/
│   │   ├── NoteEditor.tsx
│   │   ├── FieldEditor.tsx
│   │   ├── TagEditor.tsx
│   │   └── TemplateEditor.tsx
│   ├── browser/
│   │   ├── CardBrowser.tsx
│   │   ├── SearchBar.tsx
│   │   └── CardTable.tsx
│   ├── stats/
│   │   ├── ReviewHeatmap.tsx
│   │   ├── RetentionChart.tsx
│   │   └── ForecastChart.tsx
│   └── shared/
│       ├── Modal.tsx
│       ├── Toast.tsx
│       └── DropdownMenu.tsx
│
└── stores/                       # Zustand stores
    ├── collection-store.ts
    ├── review-store.ts
    └── ui-store.ts
```

---

## Phased Implementation

### Potential Quicks (Quick Wins)

If the immediate goal is to de-risk fast and ship usable value early, run these quick wins before full parity work.

| Quick | Goal | Scope (include) | Defer (exclude) | Exit criteria |
|------|------|------------------|------------------|---------------|
| Quick 1 | **First review in browser** | Minimal schema (`col`, `notes`, `cards`, `revlog`), one default deck, Basic notetype, create note → answer card flow | Full browser, stats, import/export, advanced filters | Can add a Basic note and complete at least one full review cycle with persisted state |
| Quick 2 | **Template/rendering confidence** | Parser + renderer for `{{Field}}`, conditionals, `{{FrontSide}}`, basic cloze `{{c1::...}}` | Rare filters, delimiter switching, advanced TTS/furigana | Built-in Basic + Basic Reversed + Cloze sample cards render correctly |
| Quick 3 | **Scheduler parity smoke path** | New/Learn/Review transitions, revlog writes, queue order learn → review → new | Optimizer, easy-days simulation, advanced bury edge cases | Intervals and transitions on golden test cards match expected output |
| Quick 4 | **Search MVP** | `deck:`, `note:`, `tag:`, plain text, `is:due` → SQL | Full search grammar (`rated:`, regex, advanced props) | User can reliably find due cards and tagged cards in browser UI |
| Quick 5 | **Safety + offline baseline** | OPFS DB persistence, app shell cache, manual backup export button | Full sync, background backup scheduler, conflict UI | App opens offline and data survives reloads/restarts |

### Revised Fast-Track Sequence (Recommended)

1. **Sprint A (Foundation + Quick 1)**
   - Complete Phase 0 + minimal subset of Phase 1 and Phase 4
   - Deliver end-to-end review vertical slice
2. **Sprint B (Quick 2 + Quick 3)**
   - Complete core parts of Phase 2 and Phase 3
   - Validate scheduler transitions and rendering parity on fixture deck
3. **Sprint C (Quick 4)**
   - Deliver search MVP + basic card browser workflow from Phase 5
4. **Sprint D (Quick 5)**
   - Complete essential Phase 8 offline path and backup workflow
5. **Then continue full roadmap**
   - Resume remaining scope in Phases 5–9 for full Anki-like parity

This ordering preserves the original architecture while reducing early project risk and time-to-first-value.

### Phase 0: Project Scaffolding

**Goal**: Bootable NextJS app with all tooling configured.

**Tasks:**
1. `npx create-next-app@latest` with TypeScript, TailwindCSS, App Router
2. Install core deps: `ts-fsrs`, `wa-sqlite`, `sql.js`, `zustand`, `comlink`, `shadcn/ui`
3. Configure `next.config.js` for WASM support, Web Workers, headers for OPFS
4. Set up Vitest + Playwright
5. Create the directory structure above
6. Configure PWA manifest + next-pwa

**Key files:** `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`

---

### Phase 1: Storage Layer

**Goal**: Browser SQLite with Anki-compatible schema, accessible from main thread and workers.

**Tasks:**
1. **Database manager** (`lib/storage/database.ts`)
   - wa-sqlite initialization with OPFS VFS (primary)
   - sql.js + IndexedDB fallback for older browsers
   - Connection pooling for worker access
   - Auto-save with debounced writes

2. **Schema definition** (`lib/storage/schema.ts`)
   - Port Anki's `schema11.sql` to TypeScript
   - Migration system with version tracking
   - Create all tables: `col`, `notes`, `cards`, `revlog`, `graves`
   - Create all indexes: `ix_cards_nid`, `ix_cards_sched`, etc.

3. **Custom SQL functions** (`lib/storage/sql-functions.ts`)
   - `field_at_index(flds, ord)` — Extract nth field from 0x1f-separated string
   - `fnvhash(text)` — Field checksum
   - `process_text(text, flags)` — Case folding, HTML strip, normalize
   - `extract_fsrs_variable(data, key)` — Read FSRS JSON from card data
   - `extract_fsrs_retrievability(data, decay, now)` — Calculate retrievability

4. **Repositories** (`lib/storage/repositories/`)
   - `cards.ts` — CRUD, queue queries, scheduling queries
   - `notes.ts` — CRUD, field access, duplicate detection
   - `decks.ts` — CRUD, hierarchy management, counts
   - `notetypes.ts` — CRUD, template management
   - `revlog.ts` — Insert, queries by card/date
   - `media.ts` — Media reference tracking
   - `config.ts` — Global and per-deck config

**Reference:** `ANKIDESKTOP/rslib/src/storage/schema11.sql`, `ANKIDESKTOP/rslib/src/storage/`

**Verification:** Open DB, run schema migration, insert/query cards and notes.

---

### Phase 2: Core Domain & Scheduling

**Goal**: ts-fsrs integrated, state machine ported, card answering works.

**Tasks:**
1. **Type definitions** (`lib/types/`)
   - Port all types from Anki proto definitions
   - Card, Note, Deck, Notetype, Revlog, SchedulerConfig
   - Match Anki's field-for-field layout for .apkg compatibility

2. **Scheduler engine** (`lib/scheduler/engine.ts`)
   - Wrap `ts-fsrs` with Anki-compatible interface
   - Map Anki's 4-state model (New/Learn/Review/Relearn) to ts-fsrs states
   - Handle FSRS parameters (w[0]–w[20])
   - Support SM-2 fallback for legacy cards

3. **State machine** (`lib/scheduler/states.ts`)
   - Port `rslib/src/scheduler/states/` logic
   - `StateContext` with all configuration parameters
   - Calculate next states for each rating (Again/Hard/Good/Easy)
   - Handle learning steps, graduating intervals

4. **Queue builder** (`lib/scheduler/queue.ts`)
   - Fetch due cards in correct order (learn → review → new)
   - Apply per-day limits (new_per_day, reviews_per_day)
   - Handle interday learning cards
   - Respect burying

5. **Answering** (`lib/scheduler/answering.ts`)
   - Port `rslib/src/scheduler/answering/mod.rs`
   - Apply rating → compute new state → update card
   - Create revlog entry
   - Handle leech detection
   - Handle sibling burying

6. **Fuzz** (`lib/scheduler/fuzz.ts`)
   - Port interval fuzzing algorithm
   - Deterministic seed based on card ID + date

7. **Scheduler worker** (`workers/scheduler.worker.ts`)
   - Move FSRS computation to Web Worker via comlink
   - Batch operations for parameter optimization

**Reference:** `ANKIDESKTOP/rslib/src/scheduler/`, `ANKIDESKTOP/proto/anki/scheduler.proto`

**Verification:** Create a note, generate cards, answer them, verify correct state transitions and intervals.

---

### Phase 3: Card Rendering

**Goal**: Anki templates render correctly, including cloze and filters.

**Tasks:**
1. **Template parser** (`lib/rendering/template-parser.ts`)
   - Port `rslib/src/template.rs` parsing logic
   - Parse `{{Field}}`, `{{#Field}}`, `{{^Field}}`, `{{Field:filter}}`
   - Handle comments, alternative delimiters
   - Build AST: Text, Replacement, Conditional, NegatedConditional

2. **Template renderer** (`lib/rendering/template-renderer.ts`)
   - Evaluate AST with field values
   - Apply filters to field content
   - Handle `{{FrontSide}}` reference
   - Error reporting for invalid templates

3. **Cloze processing** (`lib/rendering/cloze.ts`)
   - Parse `{{c1::text}}` and `{{c1::text::hint}}` syntax
   - Generate correct HTML for active/inactive clozes
   - Handle nested clozes
   - Cloze deletion numbering

4. **Filters** (`lib/rendering/filters.ts`)
   - `text` — Strip HTML tags
   - `type` — Type-in answer input field
   - `furigana`/`kana`/`kanji` — Japanese reading support
   - `tts` — Text-to-speech tags

5. **HTML sanitizer** (`lib/rendering/sanitizer.ts`)
   - Sanitize user HTML to prevent XSS
   - Allow safe subset of HTML tags and attributes
   - Handle media references

6. **Math rendering** (`lib/rendering/math.ts`)
   - KaTeX/MathJax integration for `$$...$$` and `\(...\)` syntax
   - Lazy-load math renderer
   - Cache rendered equations

**Reference:** `ANKIDESKTOP/rslib/src/template.rs`, `ANKIDESKTOP/rslib/src/card_rendering/`

**Verification:** Render cards from all built-in notetypes (Basic, Basic+Reverse, Cloze) and verify output matches Anki Desktop.

---

### Phase 4: Review System (UI)

**Goal**: Fully functional review session in the browser.

**Tasks:**
1. **Review page** (`app/review/[deckId]/page.tsx`)
   - Card display area (question → reveal → answer)
   - Answer buttons with interval previews ("Again (<1m)", "Good (<1d)")
   - Session progress indicator
   - Keyboard shortcuts (Space=Good, 1=Again, 2=Hard, 3=Good, 4=Easy)

2. **ReviewCard component** (`components/review/ReviewCard.tsx`)
   - Render card HTML safely in iframe or shadow DOM
   - Handle question/answer toggle
   - Audio autoplay for sound tags
   - Image display
   - Night mode CSS injection

3. **Review store** (`stores/review-store.ts`)
   - Current card state
   - Queue management
   - Answer processing flow
   - Undo support

4. **useReview hook** (`hooks/use-review.ts`)
   - Fetch next card from queue
   - Submit answer → get next card
   - Handle session end (no more cards)

5. **Answer buttons** (`components/review/AnswerButtons.tsx`)
   - Dynamic labels with predicted intervals
   - Color coding (Again=red, Hard=orange, Good=green, Easy=blue)
   - Keyboard shortcut hints

**Reference:** `ANKIDESKTOP/qt/aqt/reviewer.py`, `ANKIDESKTOP/ts/reviewer/`

**Verification:** Complete a full review session with new, learning, and review cards.

---

### Phase 5: Deck & Note Management (UI)

**Goal**: Create/edit decks, notes, notetypes. Browse and search cards.

**Tasks:**
1. **Home page / Deck list** (`app/page.tsx`)
   - Deck tree with card counts (new, learning, review, due today)
   - Deck CRUD (create, rename, delete, move)
   - Deck options (FSRS params, daily limits, learning steps)
   - Collapse/expand deck hierarchy

2. **Note editor** (`app/editor/[noteId]/page.tsx`)
   - Rich text field editors (bold, italic, lists, code)
   - Tag editor with autocomplete
   - Media insertion (images, audio)
   - Notetype switcher
   - Card preview (live rendered cards)
   - Duplicate detection

3. **Card browser** (`app/browse/page.tsx`)
   - Search bar with Anki-compatible search syntax
   - Sortable table of cards
   - Bulk actions (suspend, bury, delete, move, flag)
   - Preview pane (question/answer)
   - Card info panel (scheduling details)

4. **Notetype manager**
   - List notetypes
   - Edit fields (add, remove, reorder)
   - Edit templates (Q/A HTML, CSS)
   - Cloze notetype support
   - Standard notetypes pre-installed (Basic, Basic+Reverse, Cloze)

5. **Deck options** (`app/deck/[deckId]/options/page.tsx`)
   - Daily limits (new, review)
   - Learning steps
   - FSRS parameters (desired retention, max interval, fuzz)
   - FSRS optimizer (compute optimal parameters from review history)
   - Display options

**Reference:** `ANKIDESKTOP/qt/aqt/deckbrowser.py`, `ANKIDESKTOP/qt/aqt/editor.py`, `ANKIDESKTOP/qt/aqt/browser/`

**Verification:** Create a deck, add notes, edit them, browse and search, modify deck options.

---

### Phase 6: Import/Export

**Goal**: Read and write `.apkg` files.

**Tasks:**
1. **APKG reader** (`lib/import-export/apkg-reader.ts`)
   - Open ZIP file using `fflate` or `pako`
   - Parse `media` JSON metadata
   - Open embedded SQLite with `sql.js` (temp DB)
   - Read cards, notes, decks, notetypes, revlog
   - Map to internal data model
   - Handle duplicate detection (guid-based)
   - Import media to OPFS

2. **APKG writer** (`lib/import-export/apkg-writer.ts`)
   - Gather cards/notes for export (by deck or search)
   - Create temp SQLite database with Anki schema
   - Write data with ID remapping
   - Collect referenced media
   - Package as ZIP with `.apkg` extension
   - Trigger browser download

3. **CSV import** (`lib/import-export/csv-import.ts`)
   - Parse CSV/TSV files
   - Field mapping UI
   - Duplicate detection
   - Preview before import

4. **Import UI** (`app/import/page.tsx`)
   - File picker (drag-and-drop + button)
   - Import progress indicator
   - Conflict resolution UI
   - Import summary report

5. **Import worker** (`workers/import.worker.ts`)
   - Offload ZIP extraction + SQLite parsing to Web Worker

**Reference:** `ANKIDESKTOP/rslib/src/import_export/`, `ANKIDESKTOP/pylib/anki/importing/`

**Verification:** Import an existing `.apkg` file, verify cards appear correctly, export a deck as `.apkg`.

---

### Phase 7: Statistics & Visualization

**Goal**: Review stats, retention graphs, forecast charts.

**Tasks:**
1. **Stats page** (`app/stats/page.tsx`)
   - Today's review count, correct rate
   - Card counts by state (new, learning, review, relearning)
   - Total cards, notes, reviews

2. **Charts**
   - Review heatmap (calendar view)
   - Retention over time (line chart)
   - Interval distribution (histogram)
   - Future review forecast
   - Ease factor distribution
   - Card maturity breakdown
   - Hours of day review distribution

3. **Deck-specific stats**
   - Per-deck retention
   - Per-deck forecast
   - FSRS parameter display

4. **useStats hook** (`hooks/use-stats.ts`)
   - Aggregate queries from revlog and cards
   - Cache computed statistics

**Reference:** `ANKIDESKTOP/rslib/src/stats/`, `ANKIDESKTOP/pylib/anki/stats.py`, `ANKIDESKTOP/ts/routes/card-info/`

**Verification:** Review some cards, then view stats page with accurate numbers.

---

### Phase 8: Offline Support & PWA

**Goal**: Full offline functionality, installable as PWA.

**Tasks:**
1. **Service Worker** (via `next-pwa`)
   - Cache all static assets
   - Cache WASM files (wa-sqlite, sql.js)
   - Cache fonts, icons
   - Handle offline fallback

2. **PWA manifest**
   - App name, icons, theme color
   - `display: standalone`
   - Start URL

3. **Offline indicators**
   - Show online/offline status
   - Queue operations when offline
   - Sync when back online (if sync implemented)

4. **Data backup**
   - Export entire collection as `.apkg` for backup
   - Scheduled backup reminders
   - OPFS data durability handling

**Verification:** Disconnect network, verify app loads and reviewing works.

---

### Phase 9: Sync (Future)

**Goal**: Optional sync with a remote server.

**Scope note**: This is a future phase. The initial version is standalone.

**Potential approaches:**
- Custom sync server (Node.js + SQLite)
- AnkiWeb protocol reverse-engineering (not recommended)
- CouchDB-style replication
- CRDT-based (e.g., Y.js)
- Simple export/import workflow

---

## Key Technical Decisions

### Why wa-sqlite over sql.js?
- wa-sqlite supports OPFS VFS for **persistent** storage without manual export/import
- sql.js is in-memory only — requires saving entire DB to IndexedDB on every write
- wa-sqlite with OPFS gives near-native SQLite performance
- sql.js kept as fallback for browsers without OPFS

### Why ts-fsrs?
- Official TypeScript port maintained by the open-spaced-repetition project
- Used in production by multiple applications
- API matches FSRS v6 algorithm
- Browser-compatible, no Node.js dependencies
- Supports parameter optimization

### Why Web Workers?
- FSRS parameter optimization is CPU-intensive
- Search queries on large collections can block UI
- Import processing (ZIP + SQLite parsing)
- comlink provides clean async interface

### Why OPFS for media?
- Direct binary file read/write
- Synchronous access from Web Workers
- No size limits (unlike IndexedDB quotas)
- Better performance than base64 in IndexedDB

### Schema Compatibility
The internal SQLite schema closely mirrors Anki's `schema11.sql` for:
- Direct `.apkg` import (read Anki SQLite directly)
- Easy export to Anki-compatible format
- Future sync compatibility

---

## Verification Checklist

### Quick-Track Gates

- [ ] **Quick 1**: Add Basic note → review once → close/reopen app → state persists
- [ ] **Quick 2**: Basic/Basic+Reverse/Cloze sample templates render as expected
- [ ] **Quick 3**: New/Learn/Review transitions + intervals validated on golden fixtures
- [ ] **Quick 4**: Search MVP operators (`deck:`, `note:`, `tag:`, `is:due`, text) work end-to-end
- [ ] **Quick 5**: App launches offline with existing data and can perform backup export

After each phase, verify:

- [ ] **Phase 0**: `npm run dev` starts without errors, all deps installed
- [ ] **Phase 1**: Can create/open DB, run schema migration, CRUD on all tables
- [ ] **Phase 2**: Create note → generate cards → answer → verify state transitions + intervals match Anki
- [ ] **Phase 3**: Render Basic, Basic+Reverse, Cloze cards identically to Anki Desktop
- [ ] **Phase 4**: Complete full review session with keyboard shortcuts
- [ ] **Phase 5**: Create deck, add notes, browse, search, edit notetypes
- [ ] **Phase 6**: Import `.apkg`, verify data, export `.apkg`, verify in Anki Desktop
- [ ] **Phase 7**: Stats reflect actual review data accurately
- [ ] **Phase 8**: App works fully offline, installable as PWA

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| wa-sqlite OPFS not available | sql.js + IndexedDB fallback path |
| FSRS algorithm differences | Test against Anki Desktop with same review history, compare intervals |
| Large collection performance | Web Workers + pagination + lazy loading |
| Template edge cases | Port Anki's template test suite |
| Media handling in browser | OPFS + File System Access API |
| Browser storage limits | Show warnings, export reminders |
