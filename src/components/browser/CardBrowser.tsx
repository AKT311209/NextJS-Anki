"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CardTable } from "@/components/browser/CardTable";
import { SearchBar } from "@/components/browser/SearchBar";
import { useDecks } from "@/hooks/use-decks";
import { queueToLabel, useSearch, type SearchSortField } from "@/hooks/use-search";
import { formatBrowserDueValue, formatBrowserIntervalValue } from "@/lib/scheduler/timespan";

export interface CardBrowserProps {
    readonly initialQuery?: string;
}

export function CardBrowser({ initialQuery = "" }: CardBrowserProps) {
    const search = useSearch(initialQuery);
    const decks = useDecks();

    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [focusedCardId, setFocusedCardId] = useState<number | null>(null);
    const [moveDeckId, setMoveDeckId] = useState<number | null>(null);
    const [flagValue, setFlagValue] = useState(1);
    const [actionError, setActionError] = useState<string | null>(null);

    const availableIds = useMemo(
        () => new Set(search.results.map((result) => result.id)),
        [search.results],
    );

    const actionableSelectedIds = useMemo(
        () => [...selectedIds].filter((id) => availableIds.has(id)),
        [availableIds, selectedIds],
    );

    const selectedIdsOnPage = useMemo(
        () => new Set(actionableSelectedIds),
        [actionableSelectedIds],
    );

    const effectiveFocusedCardId = useMemo(() => {
        if (focusedCardId && availableIds.has(focusedCardId)) {
            return focusedCardId;
        }
        return search.results[0]?.id ?? null;
    }, [availableIds, focusedCardId, search.results]);

    const effectiveMoveDeckId = moveDeckId ?? decks.defaultDeckId;

    const focusedCard = useMemo(
        () => search.results.find((result) => result.id === effectiveFocusedCardId) ?? null,
        [effectiveFocusedCardId, search.results],
    );

    const selectedCount = actionableSelectedIds.length;
    const pageCount = Math.max(1, Math.ceil(search.total / search.pageSize));

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-[110rem] flex-col gap-4 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href="/" className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to decks
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Card browser</h1>
                <p className="text-sm text-slate-400">
                    Search cards with Anki-style syntax, inspect previews, and run bulk actions.
                </p>
            </header>

            <SearchBar
                query={search.query}
                loading={search.loading}
                onQueryChange={search.setQuery}
                onSubmit={() => {
                    void search.reload();
                }}
            />

            {search.error ? (
                <section className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {search.error}
                </section>
            ) : null}

            {actionError ? (
                <section className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {actionError}
                </section>
            ) : null}

            <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                <div className="space-y-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-300">
                                {search.total} result(s)
                            </span>
                            <span className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-300">
                                {selectedCount} selected
                            </span>

                            <button
                                type="button"
                                disabled={selectedCount === 0}
                                onClick={() =>
                                    runBulkAction(
                                        async () => {
                                            await search.applyBulkAction({
                                                action: "suspend",
                                                cardIds: actionableSelectedIds,
                                            });
                                        },
                                        setActionError,
                                        () => setSelectedIds(new Set()),
                                    )
                                }
                                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                            >
                                Suspend
                            </button>

                            <button
                                type="button"
                                disabled={selectedCount === 0}
                                onClick={() =>
                                    runBulkAction(
                                        async () => {
                                            await search.applyBulkAction({
                                                action: "bury",
                                                cardIds: actionableSelectedIds,
                                            });
                                        },
                                        setActionError,
                                        () => setSelectedIds(new Set()),
                                    )
                                }
                                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                            >
                                Bury
                            </button>

                            <button
                                type="button"
                                disabled={selectedCount === 0}
                                onClick={() => {
                                    if (!window.confirm(`Delete ${selectedCount} selected card(s)?`)) {
                                        return;
                                    }

                                    void runBulkAction(
                                        async () => {
                                            await search.applyBulkAction({
                                                action: "delete",
                                                cardIds: actionableSelectedIds,
                                            });
                                        },
                                        setActionError,
                                        () => setSelectedIds(new Set()),
                                    );
                                }}
                                className="rounded-md border border-rose-700/70 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200 transition enabled:hover:bg-rose-500/20 disabled:opacity-40"
                            >
                                Delete
                            </button>

                            <div className="ml-auto flex flex-wrap items-center gap-2">
                                <select
                                    value={effectiveMoveDeckId ?? ""}
                                    onChange={(event) => setMoveDeckId(Number.parseInt(event.currentTarget.value, 10))}
                                    className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100"
                                >
                                    {decks.decks.map((deck) => (
                                        <option key={deck.id} value={deck.id}>
                                            {deck.name}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    disabled={selectedCount === 0 || effectiveMoveDeckId === null}
                                    onClick={() =>
                                        runBulkAction(
                                            async () => {
                                                await search.applyBulkAction({
                                                    action: "move",
                                                    cardIds: actionableSelectedIds,
                                                    targetDeckId: effectiveMoveDeckId ?? undefined,
                                                });
                                            },
                                            setActionError,
                                            () => setSelectedIds(new Set()),
                                        )
                                    }
                                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                                >
                                    Move
                                </button>

                                <select
                                    value={flagValue}
                                    onChange={(event) => setFlagValue(Number.parseInt(event.currentTarget.value, 10))}
                                    className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100"
                                >
                                    {[0, 1, 2, 3, 4, 5, 6, 7].map((flag) => (
                                        <option key={flag} value={flag}>
                                            Flag {flag}
                                        </option>
                                    ))}
                                </select>

                                <button
                                    type="button"
                                    disabled={selectedCount === 0}
                                    onClick={() =>
                                        runBulkAction(
                                            async () => {
                                                await search.applyBulkAction({
                                                    action: "flag",
                                                    cardIds: actionableSelectedIds,
                                                    flagValue,
                                                });
                                            },
                                            setActionError,
                                            () => setSelectedIds(new Set()),
                                        )
                                    }
                                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                                >
                                    Flag
                                </button>
                            </div>
                        </div>
                    </div>

                    <CardTable
                        rows={search.results}
                        selectedIds={selectedIdsOnPage}
                        sort={search.sort}
                        onToggleSelect={(cardId) => {
                            setSelectedIds((current) => {
                                const next = new Set(current);
                                if (next.has(cardId)) {
                                    next.delete(cardId);
                                } else {
                                    next.add(cardId);
                                }
                                return next;
                            });
                        }}
                        onToggleSelectAllCurrentPage={() => {
                            setSelectedIds((current) => {
                                const allSelected = search.results.every((result) => current.has(result.id));
                                const next = new Set(current);

                                if (allSelected) {
                                    for (const result of search.results) {
                                        next.delete(result.id);
                                    }
                                } else {
                                    for (const result of search.results) {
                                        next.add(result.id);
                                    }
                                }

                                return next;
                            });
                        }}
                        onSortChange={(field) => {
                            setSort(search.sort, field, search.setSort);
                        }}
                        onOpenCard={setFocusedCardId}
                    />

                    <footer className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                        <span>
                            Page {search.page} of {pageCount}
                        </span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => search.setPage(Math.max(1, search.page - 1))}
                                disabled={search.page <= 1}
                                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                onClick={() => search.setPage(Math.min(pageCount, search.page + 1))}
                                disabled={search.page >= pageCount}
                                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    </footer>
                </div>

                <aside className="space-y-3">
                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                        <h2 className="text-lg font-semibold text-slate-100">Preview</h2>
                        {focusedCard ? (
                            <div className="mt-3 space-y-3 text-sm">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-400">Question</p>
                                    <div
                                        className="prose prose-invert mt-1 max-w-none rounded-md border border-slate-800 bg-slate-950/50 p-3 text-sm"
                                        dangerouslySetInnerHTML={{ __html: focusedCard.questionHtml }}
                                    />
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-400">Answer</p>
                                    <div
                                        className="prose prose-invert mt-1 max-w-none rounded-md border border-slate-800 bg-slate-950/50 p-3 text-sm"
                                        dangerouslySetInnerHTML={{ __html: focusedCard.answerHtml }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <p className="mt-3 text-sm text-slate-400">Select a card to preview.</p>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                        <h2 className="text-lg font-semibold text-slate-100">Card info</h2>
                        {focusedCard ? (
                            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                <Info label="Card ID" value={focusedCard.id} />
                                <Info label="Note ID" value={focusedCard.nid} />
                                <Info label="Deck" value={focusedCard.deckName} />
                                <Info label="Notetype" value={focusedCard.noteTypeName} />
                                <Info label="Queue" value={queueToLabel(focusedCard.queue)} />
                                <Info label="Due" value={formatBrowserDueValue(focusedCard)} />
                                <Info label="Interval" value={formatBrowserIntervalValue(focusedCard)} />
                                <Info label="Reps" value={focusedCard.reps} />
                                <Info label="Lapses" value={focusedCard.lapses} />
                                <Info label="Factor" value={focusedCard.factor} />
                                <Info label="Flags" value={focusedCard.flags} />
                            </dl>
                        ) : (
                            <p className="mt-3 text-sm text-slate-400">No card selected.</p>
                        )}
                    </section>
                </aside>
            </section>
        </main>
    );
}

function setSort(
    current: { readonly field: SearchSortField; readonly direction: "asc" | "desc" },
    requested: SearchSortField,
    apply: (sort: { readonly field: SearchSortField; readonly direction: "asc" | "desc" }) => void,
): void {
    if (current.field === requested) {
        apply({
            field: requested,
            direction: current.direction === "asc" ? "desc" : "asc",
        });
        return;
    }

    apply({
        field: requested,
        direction: "asc",
    });
}

async function runBulkAction(
    operation: () => Promise<void>,
    onError: (message: string | null) => void,
    onSuccess: () => void,
): Promise<void> {
    onError(null);
    try {
        await operation();
        onSuccess();
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Bulk action failed.";
        onError(message);
    }
}

function Info({ label, value }: { readonly label: string; readonly value: string | number }) {
    return (
        <>
            <dt className="text-slate-400">{label}</dt>
            <dd className="truncate text-slate-100" title={String(value)}>
                {value}
            </dd>
        </>
    );
}
