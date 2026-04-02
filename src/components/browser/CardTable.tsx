import type { SearchCardResult, SearchSort, SearchSortField } from "@/hooks/use-search";
import { queueToLabel } from "@/hooks/use-search";
import { formatBrowserDueValue, formatBrowserIntervalValue } from "@/lib/scheduler/timespan";

export interface CardTableProps {
    readonly rows: readonly SearchCardResult[];
    readonly selectedIds: ReadonlySet<number>;
    readonly sort: SearchSort;
    readonly onToggleSelect: (cardId: number) => void;
    readonly onToggleSelectAllCurrentPage: () => void;
    readonly onSortChange: (field: SearchSortField) => void;
    readonly onOpenCard: (cardId: number) => void;
}

const SORTABLE_COLUMNS: Array<{ key: SearchSortField; label: string }> = [
    { key: "due", label: "Due" },
    { key: "deck", label: "Deck" },
    { key: "reps", label: "Reps" },
    { key: "interval", label: "Interval" },
    { key: "modified", label: "Modified" },
];

export function CardTable({
    rows,
    selectedIds,
    sort,
    onToggleSelect,
    onToggleSelectAllCurrentPage,
    onSortChange,
    onOpenCard,
}: CardTableProps) {
    const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
    const now = new Date();

    return (
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-950/60">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-slate-200">
                                <input type="checkbox" checked={allSelected} onChange={onToggleSelectAllCurrentPage} />
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-slate-200">Card</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-200">Deck</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-200">Notetype</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-200">Queue</th>
                            {SORTABLE_COLUMNS.map((column) => (
                                <th key={column.key} className="px-3 py-2 text-left font-medium text-slate-200">
                                    <button
                                        type="button"
                                        onClick={() => onSortChange(column.key)}
                                        className="inline-flex items-center gap-1 text-left text-slate-200 transition hover:text-white"
                                    >
                                        {column.label}
                                        {sort.field === column.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                                    No cards match this query.
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <tr key={row.id} className="border-t border-slate-800/80 hover:bg-slate-800/40">
                                    <td className="px-3 py-2 align-top">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(row.id)}
                                            onChange={() => onToggleSelect(row.id)}
                                        />
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <button
                                            type="button"
                                            onClick={() => onOpenCard(row.id)}
                                            className="max-w-xs truncate text-left text-sky-200 underline-offset-2 hover:underline"
                                            title={stripHtml(row.questionHtml)}
                                        >
                                            {stripHtml(row.questionHtml) || `Card ${row.id}`}
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 align-top text-slate-200">{row.deckName}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{row.noteTypeName}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{queueToLabel(row.queue)}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{formatBrowserDueValue(row, now)}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{row.deckName}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{row.reps}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{formatBrowserIntervalValue(row)}</td>
                                    <td className="px-3 py-2 align-top text-slate-300">{new Date(row.mod).toLocaleDateString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
