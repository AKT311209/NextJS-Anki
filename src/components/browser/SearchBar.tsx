import type { SearchFacets, SearchFilters, SearchStateFilter } from "@/hooks/use-search";

export interface SearchBarProps {
    readonly query: string;
    readonly loading: boolean;
    readonly filters: SearchFilters;
    readonly facets: SearchFacets;
    readonly onQueryChange: (query: string) => void;
    readonly onDeckFiltersChange: (deckIds: readonly number[]) => void;
    readonly onNotetypeFiltersChange: (notetypeIds: readonly number[]) => void;
    readonly onTagFiltersChange: (tags: readonly string[]) => void;
    readonly onStateFiltersChange: (states: readonly SearchStateFilter[]) => void;
    readonly onFlagFiltersChange: (flags: readonly number[]) => void;
    readonly onClearFilters: () => void;
    readonly onSubmit: () => void;
}

const QUICK_FILTERS = [
    "is:due",
    "is:new",
    "is:learning",
    "is:review",
    "is:suspended",
    "is:buried",
    "is:flagged",
    "tag:",
    "deck:",
    "note:",
    "flag:1",
    "cid:",
    "nid:",
];

const STATE_FILTERS: Array<{ readonly value: SearchStateFilter; readonly label: string }> = [
    { value: "due", label: "Due" },
    { value: "new", label: "New" },
    { value: "learning", label: "Learning" },
    { value: "review", label: "Review" },
    { value: "suspended", label: "Suspended" },
    { value: "buried", label: "Buried" },
    { value: "flagged", label: "Flagged" },
    { value: "leech", label: "Leech" },
];

const FLAG_FILTERS = [1, 2, 3, 4, 5, 6, 7];

export function SearchBar({
    query,
    loading,
    filters,
    facets,
    onQueryChange,
    onDeckFiltersChange,
    onNotetypeFiltersChange,
    onTagFiltersChange,
    onStateFiltersChange,
    onFlagFiltersChange,
    onClearFilters,
    onSubmit,
}: SearchBarProps) {
    const selectedDeckIds = new Set(filters.deckIds);
    const selectedNotetypeIds = new Set(filters.notetypeIds);
    const selectedTags = new Set(filters.tags);
    const selectedStates = new Set(filters.states);
    const selectedFlags = new Set(filters.flags);
    const hasActiveFilters =
        filters.deckIds.length > 0 ||
        filters.notetypeIds.length > 0 ||
        filters.tags.length > 0 ||
        filters.states.length > 0 ||
        filters.flags.length > 0;

    return (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                }}
            >
                <input
                    value={query}
                    onChange={(event) => onQueryChange(event.currentTarget.value)}
                    placeholder="Search cards (deck:, note:, tag:, is:due, text…)"
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="rounded-md border border-sky-700/70 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition enabled:hover:bg-sky-500/20 disabled:opacity-50"
                >
                    {loading ? "Searching…" : "Search"}
                </button>
            </form>

            <div className="flex flex-wrap gap-2">
                {QUICK_FILTERS.map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        onClick={() => {
                            const suffix = query.trim().length > 0 ? " " : "";
                            onQueryChange(`${query}${suffix}${filter}`);
                        }}
                        className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
                    >
                        {filter}
                    </button>
                ))}
            </div>

            <section className="space-y-3 rounded-lg border border-slate-800/90 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                        Faceted filters (multi-select)
                    </p>
                    <button
                        type="button"
                        disabled={!hasActiveFilters}
                        onClick={onClearFilters}
                        className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                    >
                        Clear filters
                    </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-300">States</p>
                        <div className="flex flex-wrap gap-2">
                            {STATE_FILTERS.map((state) => {
                                const selected = selectedStates.has(state.value);
                                return (
                                    <button
                                        key={state.value}
                                        type="button"
                                        onClick={() => onStateFiltersChange(toggleState(filters.states, state.value))}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition ${selected
                                            ? "border-sky-600/80 bg-sky-500/20 text-sky-100"
                                            : "border-slate-700 text-slate-300 hover:bg-slate-800"
                                            }`}
                                    >
                                        {state.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-300">Flags</p>
                        <div className="flex flex-wrap gap-2">
                            {FLAG_FILTERS.map((flag) => {
                                const selected = selectedFlags.has(flag);
                                return (
                                    <button
                                        key={flag}
                                        type="button"
                                        onClick={() => onFlagFiltersChange(toggleNumber(filters.flags, flag))}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition ${selected
                                            ? "border-amber-600/80 bg-amber-500/20 text-amber-100"
                                            : "border-slate-700 text-slate-300 hover:bg-slate-800"
                                            }`}
                                    >
                                        Flag {flag}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-300">Decks</p>
                        <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                            {facets.decks.length === 0 ? (
                                <p className="text-xs text-slate-500">No decks found.</p>
                            ) : (
                                facets.decks.map((deck) => (
                                    <label
                                        key={deck.id}
                                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800/60"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedDeckIds.has(deck.id)}
                                            onChange={() => onDeckFiltersChange(toggleNumber(filters.deckIds, deck.id))}
                                        />
                                        <span className="truncate">{deck.name}</span>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-300">Notetypes</p>
                        <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                            {facets.notetypes.length === 0 ? (
                                <p className="text-xs text-slate-500">No notetypes found.</p>
                            ) : (
                                facets.notetypes.map((notetype) => (
                                    <label
                                        key={notetype.id}
                                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800/60"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedNotetypeIds.has(notetype.id)}
                                            onChange={() =>
                                                onNotetypeFiltersChange(toggleNumber(filters.notetypeIds, notetype.id))
                                            }
                                        />
                                        <span className="truncate">{notetype.name}</span>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-300">Top tags</p>
                    {facets.tags.length === 0 ? (
                        <p className="text-xs text-slate-500">No tags found yet.</p>
                    ) : (
                        <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1">
                            {facets.tags.map((tag) => {
                                const selected = selectedTags.has(tag.name);
                                return (
                                    <button
                                        key={tag.name}
                                        type="button"
                                        onClick={() => onTagFiltersChange(toggleText(filters.tags, tag.name))}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition ${selected
                                            ? "border-emerald-600/80 bg-emerald-500/20 text-emerald-100"
                                            : "border-slate-700 text-slate-300 hover:bg-slate-800"
                                            }`}
                                        title={`${tag.count} note(s)`}
                                    >
                                        {tag.name} <span className="text-slate-400">({tag.count})</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>
        </section>
    );
}

function toggleNumber(values: readonly number[], target: number): number[] {
    const next = new Set(values);
    if (next.has(target)) {
        next.delete(target);
    } else {
        next.add(target);
    }

    return [...next].sort((left, right) => left - right);
}

function toggleText(values: readonly string[], target: string): string[] {
    const normalized = target.trim();
    if (normalized.length === 0) {
        return [...values];
    }

    const next = new Set(values.map((value) => value.trim()).filter((value) => value.length > 0));
    if (next.has(normalized)) {
        next.delete(normalized);
    } else {
        next.add(normalized);
    }

    return [...next].sort((left, right) => left.localeCompare(right));
}

function toggleState(values: readonly SearchStateFilter[], target: SearchStateFilter): SearchStateFilter[] {
    const next = new Set(values);
    if (next.has(target)) {
        next.delete(target);
    } else {
        next.add(target);
    }

    return STATE_FILTERS.map((state) => state.value).filter((value) => next.has(value));
}
