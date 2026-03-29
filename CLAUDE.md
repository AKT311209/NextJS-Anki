# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Migration of Anki Desktop to a NextJS web-based, client-first spaced repetition application. All logic and storage runs in the browser. The `ANKIDESKTOP/` directory contains the full upstream Anki source (`ankitects/anki`) as a **read-only reference** — do not modify it.

## Documentation

- `DOCS/plan.md` — Phased migration plan with tech stack, project structure, and implementation tasks
- `DOCS/analyze_ankidesktop.md` — Deep analysis of Anki Desktop's architecture, data model, FSRS algorithm, scheduler state machine, template rendering, search system, and storage schema
- `DOCS/status.md` — **Implementation log.** After every implementation request, append an entry here documenting what was done, key decisions, and files changed. Keep chronological order.

## Architecture

The new app follows a client-first browser architecture:

```
NextJS App (React) → Zustand stores → Web Workers (comlink) → wa-sqlite (OPFS)
```

Core layers being built (in `src/`):
- `lib/storage/` — wa-sqlite with Anki-compatible SQLite schema, custom SQL functions, repositories
- `lib/scheduler/` — Wraps `ts-fsrs` for FSRS v6 scheduling, state machine, queue builder, answering logic
- `lib/rendering/` — Mustache-like template parser/renderer, cloze processing, filters, math rendering
- `lib/search/` — Anki-compatible search parser → AST → SQL builder
- `lib/import-export/` — .apkg reader/writer, CSV import
- `workers/` — Web Workers for FSRS computation, search, import (via comlink)

## Key Anki Concepts

**Data model**: Note (fields) → Notetype (templates) → Cards. One note can generate multiple cards via templates. Cards belong to Decks.

**Scheduler states**: New → Learning → Review → Relearning. FSRS uses memory state (stability + difficulty) and a 17-21 weight parameter model. Intervals calculated from the forgetting curve: `R(t,S) = (1 + FACTOR × t/S)^DECAY`.

**Template syntax**: `{{Field}}`, `{{#Field}}...{{/Field}}` (conditional), `{{^Field}}...{{/Field}}` (negated), `{{Field:filter}}`, `{{c1::text}}` (cloze). Port from `ANKIDESKTOP/rslib/src/template.rs`.

**Storage**: SQLite schema mirrors Anki's `schema11.sql` for .apkg compatibility. Key tables: `cards`, `notes`, `revlog`, `col`. Fields stored as 0x1f-separated strings.

## Reference: Finding Anki Source

| What | Where in ANKIDESKTOP/ |
|------|-----------------------|
| FSRS algorithm | `rslib/src/scheduler/fsrs/` |
| Scheduler states | `rslib/src/scheduler/states/` |
| Card answering | `rslib/src/scheduler/answering/mod.rs` |
| Queue builder | `rslib/src/scheduler/queue/` |
| Template parser | `rslib/src/template.rs` |
| Search parser | `rslib/src/search/parser.rs` |
| Search→SQL | `rslib/src/search/sqlwriter.rs` |
| Storage schema | `rslib/src/storage/schema11.sql` |
| Import/export | `rslib/src/import_export/` |
| Protobuf API | `proto/anki/*.proto` |

## Tech Stack

Next.js 15 (App Router), TypeScript strict, TailwindCSS v4, shadcn/ui, Zustand, ts-fsrs, wa-sqlite + OPFS VFS (sql.js fallback), comlink (Web Workers), next-pwa, KaTeX/MathJax, Recharts, next-intl, Vitest + Playwright.
