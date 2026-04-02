"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DeckList } from "@/components/deck/DeckList";
import { getDeckLeafName, useDecks } from "@/hooks/use-decks";

const LINKS = [
    { href: "/browse", label: "Browse cards" },
    { href: "/editor/new", label: "Add note" },
    { href: "/stats", label: "Stats" },
    { href: "/import", label: "Import" },
    { href: "/settings", label: "Settings" },
];

export default function HomePage() {
    const decks = useDecks();

    const deckNameToId = useMemo(() => {
        const map = new Map<string, number>();
        for (const deck of decks.decks) {
            map.set(deck.name.toLowerCase(), deck.id);
        }
        return map;
    }, [decks.decks]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
            <header className="space-y-3">
                <h1 className="text-4xl font-bold tracking-tight text-slate-100">NextJS-Anki</h1>
                <p className="max-w-3xl text-sm text-slate-300 sm:text-base">
                    Phase 05 is live: deck hierarchy management, note workflows, browser search, and deck options all wired
                    to the in-browser SQLite collection.
                </p>

                <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {LINKS.map((link) => (
                        <li key={link.href}>
                            <Link
                                href={link.href}
                                className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-center text-sm font-medium transition hover:border-slate-700 hover:bg-slate-800"
                            >
                                {link.label}
                            </Link>
                        </li>
                    ))}
                </ul>
            </header>

            <DeckList
                nodes={decks.tree}
                defaultDeckId={decks.defaultDeckId}
                loading={decks.loading}
                error={decks.error}
                onCreateRootDeck={async (name) => {
                    await decks.createDeck(name, null);
                }}
                onToggleCollapse={(deckId) => {
                    void decks.toggleDeckCollapsed(deckId);
                }}
                onCreateChild={(deckId) => {
                    const parent = decks.decks.find((deck) => deck.id === deckId);
                    const suggested = parent ? `${getDeckLeafName(parent.name)} Child` : "";
                    const next = window.prompt("Child deck name", suggested);
                    if (!next || next.trim().length === 0) {
                        return;
                    }
                    void decks.createDeck(next.trim(), deckId);
                }}
                onRename={(deckId) => {
                    const deck = decks.decks.find((entry) => entry.id === deckId);
                    if (!deck) {
                        return;
                    }

                    const currentLeaf = getDeckLeafName(deck.name);
                    const nextName = window.prompt("Rename deck", currentLeaf);
                    if (!nextName || nextName.trim().length === 0) {
                        return;
                    }

                    void decks.renameDeck(deckId, nextName.trim());
                }}
                onMove={(deckId) => {
                    const deck = decks.decks.find((entry) => entry.id === deckId);
                    if (!deck) {
                        return;
                    }

                    const parentName = window.prompt(
                        "Move deck under parent (full path). Leave blank to move to root.",
                        "",
                    );
                    if (parentName === null) {
                        return;
                    }

                    const trimmed = parentName.trim().toLowerCase();
                    if (trimmed.length === 0) {
                        void decks.moveDeck(deckId, null);
                        return;
                    }

                    const targetId = deckNameToId.get(trimmed);
                    if (!targetId) {
                        window.alert("Parent deck not found.");
                        return;
                    }

                    void decks.moveDeck(deckId, targetId);
                }}
                onDelete={(deckId) => {
                    if (!window.confirm("Delete this deck and all subdecks? Cards will be moved to default deck.")) {
                        return;
                    }

                    const fallback = decks.defaultDeckId ?? undefined;
                    void decks.deleteDeck(deckId, fallback);
                }}
            />
        </main>
    );
}
