import Link from "next/link";
import { getDeckLeafName, type DeckTreeNode } from "@/hooks/use-decks";

export interface DeckCardProps {
    readonly node: DeckTreeNode;
    readonly onToggleCollapse: (deckId: number) => void;
    readonly onCreateChild: (deckId: number) => void;
    readonly onRename: (deckId: number) => void;
    readonly onMove: (deckId: number) => void;
    readonly onDelete: (deckId: number) => void;
}

export function DeckCard({
    node,
    onToggleCollapse,
    onCreateChild,
    onRename,
    onMove,
    onDelete,
}: DeckCardProps) {
    const hasChildren = node.children.length > 0;
    const collapsed = Boolean(node.deck.collapsed);

    return (
        <article
            className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2"
            style={{ marginLeft: `${node.depth * 0.9}rem` }}
        >
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => onToggleCollapse(node.deck.id)}
                    disabled={!hasChildren}
                    className="h-7 min-w-7 rounded border border-slate-700 px-2 text-xs text-slate-300 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                    aria-label={collapsed ? "Expand deck" : "Collapse deck"}
                    title={collapsed ? "Expand" : "Collapse"}
                >
                    {hasChildren ? (collapsed ? "▸" : "▾") : "•"}
                </button>

                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-100">{getDeckLeafName(node.deck.name)}</h3>
                    <p className="truncate text-xs text-slate-400">{node.deck.name}</p>
                </div>

                <Link
                    href={`/review/${node.deck.id}`}
                    className="rounded-md border border-emerald-700/70 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                >
                    Study
                </Link>

                <Link
                    href={`/deck/${node.deck.id}`}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
                >
                    Open
                </Link>

                <Link
                    href={`/deck/${node.deck.id}/options`}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
                >
                    Options
                </Link>

                <Link
                    href={`/deck/${node.deck.id}/custom-study`}
                    className="rounded-md border border-amber-700/70 bg-amber-500/10 px-2 py-1 text-xs text-amber-100 transition hover:bg-amber-500/20"
                >
                    Custom Study
                </Link>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                    type="button"
                    onClick={() => onCreateChild(node.deck.id)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 transition hover:bg-slate-800"
                >
                    Add child
                </button>
                <button
                    type="button"
                    onClick={() => onRename(node.deck.id)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 transition hover:bg-slate-800"
                >
                    Rename
                </button>
                <button
                    type="button"
                    onClick={() => onMove(node.deck.id)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 transition hover:bg-slate-800"
                >
                    Move
                </button>
                <button
                    type="button"
                    onClick={() => onDelete(node.deck.id)}
                    className="rounded-md border border-rose-700/70 bg-rose-500/10 px-2 py-1 text-rose-200 transition hover:bg-rose-500/20"
                >
                    Delete
                </button>
            </div>
        </article>
    );
}
