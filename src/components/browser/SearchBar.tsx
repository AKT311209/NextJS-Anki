export interface SearchBarProps {
    readonly query: string;
    readonly loading: boolean;
    readonly onQueryChange: (query: string) => void;
    readonly onSubmit: () => void;
}

const QUICK_FILTERS = ["is:due", "is:new", "is:review", "is:suspended", "tag:", "deck:", "note:"];

export function SearchBar({ query, loading, onQueryChange, onSubmit }: SearchBarProps) {
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
        </section>
    );
}
