"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { DEFAULT_DECK_CONFIG_ID, ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";

export interface DeckCounts {
    readonly total: number;
    readonly newCount: number;
    readonly learningCount: number;
    readonly reviewCount: number;
    readonly dueToday: number;
}

export interface DeckWithCounts extends DeckRecord {
    readonly counts: DeckCounts;
}

export interface DeckTreeNode {
    readonly deck: DeckWithCounts;
    readonly depth: number;
    readonly children: readonly DeckTreeNode[];
}

export interface UseDecksResult {
    readonly loading: boolean;
    readonly error: string | null;
    readonly decks: readonly DeckWithCounts[];
    readonly tree: readonly DeckTreeNode[];
    readonly defaultDeckId: number | null;
    readonly reload: () => Promise<void>;
    readonly createDeck: (name: string, parentDeckId?: number | null) => Promise<void>;
    readonly renameDeck: (deckId: number, nextName: string) => Promise<void>;
    readonly moveDeck: (deckId: number, parentDeckId: number | null) => Promise<void>;
    readonly deleteDeck: (deckId: number, moveCardsToDeckId?: number) => Promise<void>;
    readonly toggleDeckCollapsed: (deckId: number) => Promise<void>;
}

interface DueTodayRow {
    readonly dueToday: number;
}

const EMPTY_COUNTS: DeckCounts = {
    total: 0,
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    dueToday: 0,
};

export function useDecks(): UseDecksResult {
    const collection = useCollection();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [defaultDeckId, setDefaultDeckId] = useState<number | null>(null);
    const [decks, setDecks] = useState<DeckWithCounts[]>([]);

    const deckById = useMemo(() => {
        const map = new Map<number, DeckWithCounts>();
        for (const deck of decks) {
            map.set(deck.id, deck);
        }
        return map;
    }, [decks]);

    const reload = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const connection = collection.connection;
            const bootstrap = await ensureCollectionBootstrap(connection);
            setDefaultDeckId(bootstrap.defaultDeckId);

            const repository = new DecksRepository(connection);
            const list = await repository.list();

            const nowMs = Date.now();
            const today = Math.floor(nowMs / 86_400_000);

            const withCounts = await Promise.all(
                list.map(async (deck) => {
                    const [counts, dueTodayRow] = await Promise.all([
                        repository.getDeckCounts(deck.id),
                        connection.get<DueTodayRow>(
                            `
                            SELECT
                                COALESCE(SUM(CASE WHEN queue = 1 AND due <= ? THEN 1 ELSE 0 END), 0)
                                + COALESCE(SUM(CASE WHEN queue IN (2, 3) AND due <= ? THEN 1 ELSE 0 END), 0)
                                AS dueToday
                            FROM cards
                            WHERE did = ?
                            `,
                            [nowMs, today, deck.id],
                        ),
                    ]);

                    return {
                        ...deck,
                        counts: {
                            total: counts.total,
                            newCount: counts.newCount,
                            learningCount: counts.learningCount,
                            reviewCount: counts.reviewCount,
                            dueToday: Number(dueTodayRow?.dueToday ?? 0),
                        },
                    } satisfies DeckWithCounts;
                }),
            );

            withCounts.sort((left, right) => left.name.localeCompare(right.name));
            setDecks(withCounts);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to load decks.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready]);

    const createDeck = useCallback(
        async (name: string, parentDeckId?: number | null) => {
            if (!collection.connection) {
                return;
            }

            const trimmed = name.trim();
            if (trimmed.length === 0) {
                return;
            }

            const parent = parentDeckId === null || parentDeckId === undefined
                ? null
                : deckById.get(parentDeckId) ?? null;
            const fullName = parent ? `${parent.name}::${trimmed}` : trimmed;

            const repository = new DecksRepository(collection.connection);
            await repository.create(fullName, {
                conf: DEFAULT_DECK_CONFIG_ID,
            });
            await reload();
        },
        [collection.connection, deckById, reload],
    );

    const renameDeck = useCallback(
        async (deckId: number, nextName: string) => {
            if (!collection.connection) {
                return;
            }

            const existing = deckById.get(deckId);
            if (!existing) {
                return;
            }

            const trimmed = nextName.trim();
            if (trimmed.length === 0) {
                return;
            }

            const parentPath = getParentPath(existing.name);
            const fullName = trimmed.includes("::")
                ? trimmed
                : parentPath
                    ? `${parentPath}::${trimmed}`
                    : trimmed;

            await renameDeckAndDescendants(collection.connection, existing.id, existing.name, fullName);
            await reload();
        },
        [collection.connection, deckById, reload],
    );

    const moveDeck = useCallback(
        async (deckId: number, parentDeckId: number | null) => {
            if (!collection.connection) {
                return;
            }

            const existing = deckById.get(deckId);
            if (!existing) {
                return;
            }

            const parent = parentDeckId === null ? null : deckById.get(parentDeckId) ?? null;
            if (parent && (parent.name === existing.name || parent.name.startsWith(`${existing.name}::`))) {
                throw new Error("Cannot move a deck inside itself.");
            }

            const leafName = existing.name.split("::").at(-1) ?? existing.name;
            const nextName = parent ? `${parent.name}::${leafName}` : leafName;

            await renameDeckAndDescendants(collection.connection, existing.id, existing.name, nextName);
            await reload();
        },
        [collection.connection, deckById, reload],
    );

    const deleteDeck = useCallback(
        async (deckId: number, moveCardsToDeckId?: number) => {
            if (!collection.connection) {
                return;
            }

            const existing = deckById.get(deckId);
            if (!existing) {
                return;
            }

            const repository = new DecksRepository(collection.connection);
            const allDecks = await repository.list();
            const children = allDecks
                .filter((deck) => deck.id !== deckId && deck.name.startsWith(`${existing.name}::`))
                .sort((left, right) => right.name.length - left.name.length);

            for (const child of children) {
                await repository.delete(child.id, moveCardsToDeckId);
            }

            await repository.delete(deckId, moveCardsToDeckId);
            await reload();
        },
        [collection.connection, deckById, reload],
    );

    const toggleDeckCollapsed = useCallback(
        async (deckId: number) => {
            if (!collection.connection) {
                return;
            }

            const existing = deckById.get(deckId);
            if (!existing) {
                return;
            }

            const repository = new DecksRepository(collection.connection);
            await repository.update(deckId, {
                collapsed: !Boolean(existing.collapsed),
            });
            await reload();
        },
        [collection.connection, deckById, reload],
    );

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }
        void reload();
    }, [collection.connection, collection.ready, reload]);

    return {
        loading: loading || collection.loading,
        error: error ?? collection.error,
        decks,
        tree: useMemo(() => buildDeckTree(decks), [decks]),
        defaultDeckId,
        reload,
        createDeck,
        renameDeck,
        moveDeck,
        deleteDeck,
        toggleDeckCollapsed,
    };
}

async function renameDeckAndDescendants(
    connection: NonNullable<ReturnType<typeof useCollection>["connection"]>,
    deckId: number,
    currentName: string,
    nextName: string,
): Promise<void> {
    if (currentName === nextName) {
        return;
    }

    const repository = new DecksRepository(connection);
    const decks = await repository.list();

    await repository.update(deckId, { name: nextName });

    const prefix = `${currentName}::`;
    const replacementPrefix = `${nextName}::`;

    for (const deck of decks) {
        if (deck.id === deckId) {
            continue;
        }

        if (!deck.name.startsWith(prefix)) {
            continue;
        }

        const suffix = deck.name.slice(prefix.length);
        await repository.update(deck.id, {
            name: `${replacementPrefix}${suffix}`,
        });
    }
}

function buildDeckTree(decks: readonly DeckWithCounts[]): DeckTreeNode[] {
    if (decks.length === 0) {
        return [];
    }

    const byName = new Map<string, DeckWithCounts>();
    const byId = new Map<number, DeckTreeNode & { children: DeckTreeNode[] }>();

    for (const deck of decks) {
        byName.set(deck.name, deck);
        byId.set(deck.id, {
            deck,
            depth: 0,
            children: [],
        });
    }

    const roots: Array<DeckTreeNode & { children: DeckTreeNode[] }> = [];

    for (const deck of decks) {
        const node = byId.get(deck.id);
        if (!node) {
            continue;
        }

        const parentPath = getParentPath(deck.name);
        const parentDeck = parentPath ? byName.get(parentPath) : undefined;
        const parentNode = parentDeck ? byId.get(parentDeck.id) : undefined;

        if (!parentNode) {
            roots.push(node);
        } else {
            parentNode.children.push(node);
        }
    }

    const orderedRoots = roots.sort((left, right) => left.deck.name.localeCompare(right.deck.name));
    return orderedRoots.map((node) => withDepth(node, 0));
}

function withDepth(node: DeckTreeNode & { children: DeckTreeNode[] }, depth: number): DeckTreeNode {
    const children = [...node.children]
        .sort((left, right) => left.deck.name.localeCompare(right.deck.name))
        .map((child) => withDepth(child as DeckTreeNode & { children: DeckTreeNode[] }, depth + 1));

    return {
        deck: node.deck,
        depth,
        children,
    };
}

function getParentPath(deckName: string): string | null {
    const parts = deckName.split("::");
    if (parts.length <= 1) {
        return null;
    }
    return parts.slice(0, -1).join("::");
}

export function getDeckLeafName(deckName: string): string {
    return deckName.split("::").at(-1) ?? deckName;
}

export function getDeckCountsOrEmpty(deck?: DeckWithCounts): DeckCounts {
    return deck?.counts ?? EMPTY_COUNTS;
}
