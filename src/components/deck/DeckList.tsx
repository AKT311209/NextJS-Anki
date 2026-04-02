import { useState } from "react";
import type { DeckTreeNode } from "@/hooks/use-decks";
import { DeckTree } from "@/components/deck/DeckTree";

export interface DeckListProps {
    readonly nodes: readonly DeckTreeNode[];
    readonly loading: boolean;
    readonly error: string | null;
    readonly onCreateRootDeck: (name: string) => Promise<void>;
    readonly onToggleCollapse: (deckId: number) => void;
    readonly onCreateChild: (deckId: number) => void;
    readonly onRename: (deckId: number) => void;
    readonly onMove: (deckId: number) => void;
    readonly onDelete: (deckId: number) => void;
}

export function DeckList({
    nodes,
    loading,
    error,
    onCreateRootDeck,
    onToggleCollapse,
    onCreateChild,
    onRename,
    onMove,
    onDelete,
}: DeckListProps) {
    const [newDeckName, setNewDeckName] = useState("");

    return (
        <section className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-lg font-semibold text-slate-100">Decks</h2>
                <p className="mt-1 text-sm text-slate-400">
                    Create, rename, move, and review deck hierarchy directly from the home screen.
                </p>

                <form
                    className="mt-4 flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const name = newDeckName.trim();
                        if (name.length === 0) {
                            return;
                        }
                        void onCreateRootDeck(name).then(() => setNewDeckName(""));
                    }}
                >
                    <input
                        value={newDeckName}
                        onChange={(event) => setNewDeckName(event.currentTarget.value)}
                        placeholder="New root deck name"
                        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
                    />
                    <button
                        type="submit"
                        className="rounded-md border border-sky-700/70 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
                    >
                        Create deck
                    </button>
                </form>
            </div>

            {error ? (
                <div className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
                    Loading decks…
                </div>
            ) : (
                <DeckTree
                    nodes={nodes}
                    onToggleCollapse={onToggleCollapse}
                    onCreateChild={onCreateChild}
                    onRename={onRename}
                    onMove={onMove}
                    onDelete={onDelete}
                />
            )}
        </section>
    );
}
