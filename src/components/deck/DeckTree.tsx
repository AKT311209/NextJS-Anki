import type { DeckTreeNode } from "@/hooks/use-decks";
import { DeckCard } from "@/components/deck/DeckCard";

export interface DeckTreeProps {
    readonly nodes: readonly DeckTreeNode[];
    readonly defaultDeckId: number | null;
    readonly onToggleCollapse: (deckId: number) => void;
    readonly onCreateChild: (deckId: number) => void;
    readonly onRename: (deckId: number) => void;
    readonly onMove: (deckId: number) => void;
    readonly onDelete: (deckId: number) => void;
}

export function DeckTree({
    nodes,
    defaultDeckId,
    onToggleCollapse,
    onCreateChild,
    onRename,
    onMove,
    onDelete,
}: DeckTreeProps) {
    if (nodes.length === 0) {
        return (
            <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                No decks yet. Create one to get started.
            </section>
        );
    }

    return (
        <div className="space-y-2">
            {nodes.map((node) => (
                <DeckTreeBranch
                    key={node.deck.id}
                    node={node}
                    defaultDeckId={defaultDeckId}
                    onToggleCollapse={onToggleCollapse}
                    onCreateChild={onCreateChild}
                    onRename={onRename}
                    onMove={onMove}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}

function DeckTreeBranch({
    node,
    defaultDeckId,
    onToggleCollapse,
    onCreateChild,
    onRename,
    onMove,
    onDelete,
}: {
    readonly node: DeckTreeNode;
    readonly defaultDeckId: number | null;
    readonly onToggleCollapse: (deckId: number) => void;
    readonly onCreateChild: (deckId: number) => void;
    readonly onRename: (deckId: number) => void;
    readonly onMove: (deckId: number) => void;
    readonly onDelete: (deckId: number) => void;
}) {
    return (
        <div className="space-y-2">
            <DeckCard
                node={node}
                isDefaultDeck={defaultDeckId === node.deck.id}
                onToggleCollapse={onToggleCollapse}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
            />

            {!node.deck.collapsed && node.children.length > 0 ? (
                <div className="space-y-2">
                    {node.children.map((child) => (
                        <DeckTreeBranch
                            key={child.deck.id}
                            node={child}
                            defaultDeckId={defaultDeckId}
                            onToggleCollapse={onToggleCollapse}
                            onCreateChild={onCreateChild}
                            onRename={onRename}
                            onMove={onMove}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
