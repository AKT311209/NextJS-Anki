# Anki Desktop — Architecture & Logic Analysis

> Source: `ANKIDESKTOP/` (upstream `ankitects/anki` at `main`)

---

## 1. Architecture Overview

Anki Desktop is a **4-layer application**:

```
┌─────────────────────────────────────────────┐
│  Layer 4: Svelte/TS Web UI  (ts/)           │  ← Card reviewer, editor, stats charts
├─────────────────────────────────────────────┤
│  Layer 3: Qt GUI Shell      (qt/aqt/)       │  ← Window management, menus, dialogs
├─────────────────────────────────────────────┤
│  Layer 2: Python API        (pylib/anki/)    │  ← Collection API, business logic wrappers
├─────────────────────────────────────────────┤
│  Layer 1: Rust Core         (rslib/)         │  ← Scheduler, storage, search, rendering
└─────────────────────────────────────────────┘
         │
    SQLite (collection.anki2)
```

**Communication flow:**
- Layer 4 ↔ Layer 3: pMsg/postMessage bridge (webview ↔ Qt)
- Layer 3 ↔ Layer 2: Direct Python calls (`mw.col.*`)
- Layer 2 ↔ Layer 1: Protobuf over PyO3 bridge (`rsbridge`)
- Layer 1 ↔ SQLite: rusqlite

### Key Stats
- ~225 Rust files, ~235 Python files, ~407 Svelte components
- 14 Rust workspace crates
- ~60+ proto message types

---

## 2. Core Data Model

### 2.1 Entities & Relationships

```
Deck (1) ──< (N) Card (N) >── (1) Note (N) >── (1) Notetype
                                         │
                                         └── Template[] → generates Cards
```

**A Note has fields (user data). A Notetype defines the field schema + card templates. Each template produces one Card. Cards are assigned to Decks.**

### 2.2 Card (`rslib/src/card/mod.rs`, `proto/anki/cards.proto`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | i64 | Unique ID (timestamp-based) |
| `note_id` | i64 | Parent note |
| `deck_id` | i64 | Owning deck |
| `template_idx` | u16 | Which template generated this card |
| `ctype` | enum | `New=0, Learn=1, Review=2, Relearn=3` |
| `queue` | enum | `UserBuried=-3, SchedBuried=-2, Suspended=-1, New=0, Learn=1, Review=2, DayLearn=3` |
| `due` | i32 | Day number (review) or position (new) or timestamp (learn) |
| `interval` | u32 | Days since last review (0 for new) |
| `ease_factor` | u16 | ×1000 (e.g., 2500 = 2.5) |
| `reps` | u32 | Total successful reviews |
| `lapses` | u32 | Times forgotten (Again in review) |
| `remaining_steps` | u32 | Steps left in learning/relearning |
| `original_due` | i32 | Preserved when in filtered deck |
| `original_deck_id` | i64 | Preserved when in filtered deck |
| `flags` | u8 | 7 user flag colors |
| `memory_state` | FsrsMemoryState? | FSRS stability + difficulty |
| `desired_retention` | f32? | Per-card target retention |
| `decay` | f32? | FSRS decay parameter |

### 2.3 Note (`rslib/src/notes/mod.rs`, `proto/anki/notes.proto`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | i64 | Unique ID |
| `guid` | string | Globally unique (for sync) |
| `notetype_id` | i64 | Notetype reference |
| `mtime` | TimestampSecs | Last modified |
| `usn` | i64 | Update sequence number (sync) |
| `tags` | string[] | Space-separated tags |
| `fields` | string[] | Field values (0x1f separated in DB) |
| `sort_field` | string? | First field for sorting |
| `checksum` | u32? | Field content hash |

### 2.4 Deck (`rslib/src/decks/mod.rs`, `proto/anki/decks.proto`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | i64 | Unique ID |
| `name` | NativeDeckName | Hierarchical (`Parent::Child`) |
| `kind` | enum | `Normal` or `Filtered` |
| `config_id` | i64 | DeckConfig reference (normal decks) |
| `filtered_search` | string | Search term (filtered decks) |
| `browser_columns` | Column[] | Custom browser layout |

**Deck Hierarchy**: Names use `::` separator. `Default` deck always exists (id=1). Parent decks aggregate child counts.

### 2.5 Notetype (`rslib/src/notetype/mod.rs`, `proto/anki/notetypes.proto`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | i64 | Unique ID |
| `name` | string | Display name |
| `fields` | NoteField[] | Field definitions |
| `templates` | CardTemplate[] | Q/A template pairs |
| `css` | string | Shared styling |
| `kind` | enum | `Normal` or `Cloze` |

**CardTemplate**:
```typescript
{
  name: string;          // "Card 1"
  qfmt: string;          // Question template HTML
  afmt: string;          // Answer template HTML
  ord: number;           // Order/index
  browser_qfmt?: string; // Custom browser question format
  browser_afmt?: string; // Custom browser answer format
}
```

### 2.6 Revlog (`rslib/src/storage/schema11.sql`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | i64 | Timestamp in ms |
| `card_id` | i64 | Card reference |
| `usn` | i64 | Update sequence number |
| `rating` | i32 | `Again=1, Hard=2, Good=3, Easy=4` |
| `interval` | i32 | New interval |
| `last_interval` | i32 | Previous interval |
| `ease_factor` | i32 | Ease factor |
| `taken_ms` | i32 | Time spent on card |
| `review_kind` | enum | `Learning=0, Review=1, Relearn=2, Manual=3, Resched=4` |

---

## 3. FSRS Algorithm Internals

### 3.1 Location
`rslib/src/scheduler/fsrs/` — wraps the external `fsrs` Rust crate (FSRS v6).

### 3.2 Memory State

```rust
struct FsrsMemoryState {
    stability: f32,    // Days until 90% retention
    difficulty: f32,    // 1.0 – 10.0
}
```

**Stability** = the interval at which retrievability drops to the target retention (default 90%).
**Difficulty** = inherent card difficulty, updated on each review.

### 3.3 Forgetting Curve

```
R(t, S) = (1 + FACTOR × (t / S))^DECAY
```

Where:
- `R` = retrievability (probability of recall)
- `t` = elapsed days since last review
- `S` = stability
- `DECAY = -0.5`, `FACTOR = 19/81 ≈ 0.2346`

### 3.4 Initial Values (First Review)

For a **new card** rated `G` (Again=1, Hard=2, Good=3, Easy=4):

```
S₀(G) = w[G-1]          // w[0]..w[3] are initial stability weights
D₀(G) = w[4] - e^((G-1) × w[5]) + 1   // initial difficulty
```

### 3.5 Stability Update (After Recall)

```
S'ₐ = S × (e^w[8] × (11 - D) × S^(-w[9]) × (e^(1-R) × w[10] - 1) × penalty)
```

Penalties include:
- **Hard penalty**: `w[15]` applied for Hard rating
- **Easy bonus**: `w[16]` applied for Easy rating
- **Short-term**: Adjusted when within learning steps

### 3.6 Stability Update (After Forgetting)

```
S'ₓ = w[11] × D^(-w[12]) × ((S + 1)^w[13] - 1) × e^((1-R) × w[14])
```

### 3.7 Difficulty Update

```
D' = w[7] × D₀(G) + (1 - w[7]) × D   // weighted average
D' = clamp(D', 1, 10)
```

### 3.8 Next Interval Calculation

```
I(r, S) = clamp(
  (r^(1/DECAY) - 1) / FACTOR × S,
  minimum_interval,
  maximum_interval
)
```

Where `r` = desired retention (default 0.9).

### 3.9 FSRS Parameters (17–21 weights)

| Index | Name | Purpose |
|-------|------|---------|
| w[0]–w[3] | Initial stability | S₀ for each rating |
| w[4]–w[5] | Initial difficulty | D₀ calculation |
| w[6] | Hard multiplier | Hard interval modifier |
| w[7] | Difficulty weight | D update smoothing |
| w[8]–w[10] | Stability (recall) | S update after recall |
| w[11]–w[14] | Stability (forget) | S update after lapse |
| w[15] | Hard penalty | Hard-specific modifier |
| w[16] | Easy bonus | Easy-specific modifier |
| w[17]–w[20] | Short-term | Learning step modeling |

### 3.10 Parameter Optimization (`params.rs`)

- Takes review history (revlog) as training data
- Optimizes w[0]–w[20] using gradient descent
- Evaluates with log-loss and RMSE metrics
- Supports historical retention for pre-FSRS reviews
- Runs batch optimization over all review data

### 3.11 Simulation (`simulator.rs`)

- Predicts future review workload
- Tests different retention targets (0.70–0.95)
- Supports load balancing (distribute reviews evenly)
- Supports "easy days" (reduced workload on specific days)
- Used for "optimal retention" suggestion

---

## 4. Scheduler State Machine

### 4.1 States (`rslib/src/scheduler/states/mod.rs`)

```
                    ┌──────────┐
          ┌────────│   New    │────────┐
          │        └──────────┘        │
          │ (first review)             │
          ▼                             │
    ┌───────────┐  Again   ┌──────────────┐
    │ Learning  │─────────▶│  Relearning  │
    └─────┬─────┘          └──────┬───────┘
          │ Good/Easy              │ Good/Easy
          ▼                        │
    ┌───────────┐  Again           │
    │  Review   │──────────────────┘
    └───────────┘
```

### 4.2 Learning Steps

Configured per deck as time intervals: e.g., `["1m", "10m"]`

- Steps are processed left→right
- `Again` → restart from first step
- `Good` on last step → graduate to Review
- `Hard` → repeat current step (or 1.5× current if single step)
- `Easy` → immediately graduate with bonus interval

### 4.3 Review State Intervals

**SM-2 (legacy):**
```
interval_good = max(interval × ease_factor, 1)
interval_hard = interval × hard_multiplier
interval_easy = interval × easy_multiplier
```

**FSRS:**
```
interval_again = failing_review_interval()   // calculated from FSRS
interval_hard  = FSRS-calculated
interval_good  = FSRS-calculated
interval_easy  = FSRS-calculated
```

### 4.4 Ease Factor Updates

```
EF(Again) = EF - 0.20
EF(Hard)  = EF - 0.15
EF(Good)  = unchanged
EF(Easy)  = EF + 0.15

Minimum: 1.30
```

### 4.5 Fuzz (`rslib/src/scheduler/states/fuzz/`)

Applied to review intervals to spread review load:
- Random offset based on interval length
- `±5%` for intervals < 2.5 days
- Up to `±1 day` for intervals < 30 days
- Increasing range for longer intervals
- Seed based on card ID + current date for consistency

### 4.6 Answering Flow (`rslib/src/scheduler/answering/mod.rs`)

1. Load card + deck config + scheduler context
2. Compute FSRS next states (if enabled)
3. Apply rating → determine new `CardState`
4. Update card fields (due, interval, queue, reps, lapses, etc.)
5. Create revlog entry
6. Handle leech detection (suspend if threshold reached)
7. Handle sibling burying (bury other cards of same note)
8. Update study queues
9. Return updated card + revlog

### 4.7 Queue Management (`rslib/src/scheduler/queue/`)

**Card queues:** fetched in order:
1. **Learning/Relearning** — sorted by due timestamp, interday before intraday
2. **Review** — sorted by due day, then random within day
3. **New** — sorted by position, limited by `new/day` setting

**Limits per day:**
- `new_per_day` — max new cards
- `reviews_per_day` — max review cards (soft limit)
- New cards are pulled after reviews are exhausted

**Burying:**
- After review, sibling cards of the same note can be buried (configurable)
- Burying sets queue to `SchedBuried` until next day
- User bury sets queue to `UserBuried` (until manually unburi)

---

## 5. Card Rendering Pipeline

### 5.1 Template Parser (`rslib/src/template.rs`)

Parses Mustache-like syntax into AST:

```
ParsedNode::Text("...")
ParsedNode::Replacement { key: "Field", filters: ["text", "type"] }
ParsedNode::Conditional { key: "Field", children: [...] }
ParsedNode::NegatedConditional { key: "Field", children: [...] }
ParsedNode::Comment("...")
```

### 5.2 Template Syntax

| Syntax | Meaning |
|--------|---------|
| `{{Field}}` | Field replacement |
| `{{Field:filter}}` | Field with filter |
| `{{#Field}}...{{/Field}}` | Show if field non-empty |
| `{{^Field}}...{{/Field}}` | Show if field empty |
| `{{FrontSide}}` | Question side content |
| `{{c1::text}}` | Cloze deletion |
| `{{c1::text::hint}}` | Cloze with hint |
| `{{Type:Field}}` | Type-in answer |
| `<!-- ... -->` | Comments |
| `{{=<% %>=}}` | Change delimiter |

### 5.3 Built-in Filters

| Filter | Purpose |
|--------|---------|
| (none) | Raw HTML output |
| `text` | Strip HTML, plain text |
| `type` | Type-in answer input |
| `furigana` | Japanese reading |
| `kana` | Japanese kana only |
| `kanji` | Japanese kanji only |
| `tts` | Text-to-speech |
| `cloze` | Cloze-specific rendering |

### 5.4 Cloze Processing

Cloze notes use `{{c1::text}}` syntax in field content:
- Card 1 reveals c1, obscures c2+
- Card 2 reveals c2, obscures c1, c3+
- Active cloze → orange highlight
- Inactive cloze → `[...]` placeholder

### 5.5 Rendering Flow

```
Field Values → Template Parser → AST Evaluator → HTML Output
                                          ↓
                                    Filter Pipeline
                                          ↓
                                    MathJax/LaTeX Processing
                                          ↓
                                    Final Card HTML
```

### 5.6 MathJax/LaTeX

- MathJax loaded in webview for rendering
- LaTeX can be pre-rendered to SVG (cached in media folder)
- Supports `$$...$$` (display) and `\(...\)` (inline)

---

## 6. Search System

### 6.1 Parser (`rslib/src/search/parser.rs`)

Converts search string → AST using `nom` parser combinator.

**SearchNode variants:**

| Node | Example | SQL Target |
|------|---------|------------|
| `UnqualifiedText` | `hello` | Full-text search across fields |
| `SingleField` | `front:hello` | Specific note field |
| `AddedInDays` | `added:7` | Card creation time |
| `EditedInDays` | `edited:3` | Note modification time |
| `CardTemplate` | `card:1` | Template ordinal |
| `Deck` | `deck:"My Deck"` | Deck name (with children) |
| `Notetype` | `note:Basic` | Notetype name |
| `StateKind` | `is:due` | Card queue/type |
| `PropertyKind` | `prop:ivl>5` | Card numeric property |
| `Tag` | `tag:important` | Note tags |
| `Flag` | `flag:3` | Card flag |
| `Rated` | `rated:3:2` | Recent review rating |
| `Regex` | `re:pattern` | Regex search |

### 6.2 SQL Writer (`rslib/src/search/sqlwriter.rs`)

AST → SQL WHERE clause with parameterized queries.

**Custom SQL functions registered on the connection:**
- `field_at_index(flds, ord)` — Extract nth field from 0x1f-separated string
- `process_text(text, flags)` — Case folding, strip HTML, normalize
- `regexp(pattern, text)` — Regex matching
- `fnvhash(text)` — Field checksum
- `extract_fsrs_variable(data, key)` — Read FSRS custom data JSON
- `extract_fsrs_retrievability(data, decay, now)` — Calculate current retrievability

### 6.3 Operators

- **AND**: Implicit (space) or `+`
- **OR**: `or` or `|`
- **NOT**: `-` prefix
- **Grouping**: `(...)` parentheses

---

## 7. Storage Layer

### 7.1 Schema (`rslib/src/storage/schema11.sql`)

**Tables:**

```sql
-- Collection metadata (single row)
col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)

-- Core data
notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps,
       lapses, left, odue, odid, flags, data)
revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)

-- Sync tracking
graves (usn, oid, type)
```

**Indexes (critical for performance):**
```sql
ix_cards_nid       -- cards(nid)         — note→card lookup
ix_cards_sched     -- cards(did, queue, due) — queue building
ix_cards_usn       -- cards(usn)         — sync
ix_notes_usn       -- notes(usn)         — sync
ix_notes_csum      -- notes(csum)        — duplicate detection
ix_revlog_cid      -- revlog(cid)        — card review history
ix_revlog_usn      -- revlog(usn)        — sync
```

### 7.2 JSON Columns in `col` Table

The `col` table stores several JSON blobs:
- `conf` — Global config (scheduler version, FSRS params, etc.)
- `models` — Notetype definitions
- `decks` — Deck definitions
- `dconf` — Deck configurations
- `tags` — Tag list

Modern Anki is gradually migrating these to separate tables.

### 7.3 Schema Migrations

- Schema version tracked in `col.scm`
- Migrations run on collection open
- Anki tracks schema version and applies incremental upgrades

---

## 8. Import/Export

### 8.1 .apkg Format

```
deck.apkg (ZIP archive)
├── collection.anki2    — SQLite database (full schema)
├── media               — JSON: {"checksum_name": "original_name", ...}
├── 0                   — Media file (checksum-named)
├── 1                   — Media file
└── ...
```

### 8.2 Import Process (`rslib/src/import_export/`)

1. Open ZIP archive
2. Extract `media` JSON and `collection.anki2` SQLite
3. Open temp SQLite connection to imported collection
4. For each note/card:
   - Map notetype fields
   - Handle duplicate detection (guid matching)
   - Remap deck IDs to avoid conflicts
   - Import media files
5. Merge into main collection

### 8.3 Export Process

1. Gather target cards/notes (by deck or search)
2. Create new SQLite database with schema
3. Write selected data (with ID remapping)
4. Collect referenced media files
5. Package as ZIP with `.apkg` extension

### 8.4 CSV Import (`pylib/anki/importing/`)

- Configurable delimiter (comma, tab, semicolon, etc.)
- Field mapping UI
- Duplicate detection (first field match)
- Tag handling
- HTML detection

---

## 9. Sync Protocol

### 9.1 Architecture (`rslib/src/sync/`)

```
Client                          Server (AnkiWeb)
  │                                  │
  │──── login ──────────────────────▶│
  │◀─── host_key ───────────────────│
  │                                  │
  │──── meta (USN check) ──────────▶│
  │◀─── remote_usn ─────────────────│
  │                                  │
  │──── apply changes (local) ─────▶│
  │◀─── apply changes (remote) ─────│
  │                                  │
  │──── media sync ────────────────▶│
  │◀─── media files ────────────────│
```

### 9.2 Conflict Resolution

- Uses **Update Sequence Numbers (USN)**: monotonically increasing
- Each modified record gets the current USN
- On sync: send local changes (usn > last_sync), receive remote changes
- **Newest-wins** conflict resolution based on modification timestamp
- Deletions tracked in `graves` table

### 9.3 Media Sync

- Checksum-based comparison
- Upload new/changed media files
- Download missing media files
- ZIP-based batch transfer for efficiency

---

## 10. Addon System

### 10.1 Architecture (`qt/aqt/addons.py`)

- Addons are Python packages installed in `~/.local/share/Anki2/addons21/`
- Each addon has a `manifest.json` and optionally `__init__.py`
- Loaded at startup, hooks into GUI lifecycle

### 10.2 Hook System (`rslib/src/backend/` → generated hooks)

**100+ hook points** including:
- `card_will_be_added` / `card_did_render`
- `review_did_answer` / `review_will_show`
- `deck_browser_will_show_menu`
- `editor_did_load_note`
- `state_did_reset`

### 10.3 Not Portable to Web

The addon system is Python/Qt-specific and would need a completely different plugin architecture for web (e.g., JavaScript plugins with defined APIs).

---

## 11. Key Files Reference

| Component | Path |
|-----------|------|
| Rust scheduler | `rslib/src/scheduler/` |
| FSRS algorithm | `rslib/src/scheduler/fsrs/` |
| State machine | `rslib/src/scheduler/states/` |
| Card answering | `rslib/src/scheduler/answering/mod.rs` |
| Queue builder | `rslib/src/scheduler/queue/` |
| Template parser | `rslib/src/template.rs` |
| Card rendering | `rslib/src/card_rendering/` |
| Search parser | `rslib/src/search/parser.rs` |
| Search→SQL | `rslib/src/search/sqlwriter.rs` |
| Storage schema | `rslib/src/storage/schema11.sql` |
| Collection | `rslib/src/collection.rs` |
| Protobuf defs | `proto/anki/*.proto` |
| Python API | `pylib/anki/*.py` |
| Qt GUI | `qt/aqt/*.py` |
| Svelte UI | `ts/` |
