"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCollection } from "@/hooks/use-collection";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";

interface DeckCounts {
    readonly total: number;
    readonly newCount: number;
    readonly learningCount: number;
    readonly reviewCount: number;
}

export default function DeckDetailPage() {
    const params = useParams<{ deckId: string }>();
    const collection = useCollection();

    const deckId = useMemo(() => {
        const parsed = Number.parseInt(params.deckId, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }, [params.deckId]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deck, setDeck] = useState<DeckRecord | null>(null);
    const [counts, setCounts] = useState<DeckCounts | null>(null);

    useEffect(() => {
        if (!collection.connection || !collection.ready || deckId === null) {
            return;
        }

        let cancelled = false;

        void (async () => {
            setLoading(true);
            setError(null);

            try {
                const connection = collection.connection;
                if (!connection) {
                    return;
                }
                await ensureCollectionBootstrap(connection);

                const decks = new DecksRepository(connection);
                const [nextDeck, nextCounts] = await Promise.all([
                    decks.getById(deckId),
                    decks.getDeckCounts(deckId),
                ]);

                if (cancelled) {
                    return;
                }

                setDeck(nextDeck);
                setCounts(nextCounts);
            } catch (cause) {
                if (cancelled) {
                    return;
                }

                const message = cause instanceof Error ? cause.message : "Failed to load deck.";
                setError(message);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [collection.connection, collection.ready, deckId]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href="/" className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to deck list
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Deck details</h1>
            </header>

            {loading ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-300">
                    Loading deck…
                </section>
            ) : null}

            {!loading && error ? (
                <section className="rounded-xl border border-rose-800/70 bg-rose-950/30 p-5 text-sm text-rose-100">
                    {error}
                </section>
            ) : null}

            {!loading && !error && !deck ? (
                <section className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-5 text-sm text-amber-100">
                    Deck not found.
                </section>
            ) : null}

            {!loading && !error && deck ? (
                <>
                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                        <h2 className="text-xl font-semibold text-slate-100">{deck.name}</h2>
                        <p className="mt-2 text-sm text-slate-400">Deck ID: {deck.id}</p>

                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <CountCard label="New" value={counts?.newCount ?? 0} />
                            <CountCard label="Learning" value={counts?.learningCount ?? 0} />
                            <CountCard label="Review" value={counts?.reviewCount ?? 0} />
                            <CountCard label="Total" value={counts?.total ?? 0} />
                        </div>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2">
                        <Link
                            href={`/review/${deck.id}`}
                            className="rounded-xl border border-emerald-700/70 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20"
                        >
                            Study this deck
                        </Link>
                        <Link
                            href={`/editor/new?deckId=${deck.id}`}
                            className="rounded-xl border border-sky-700/70 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
                        >
                            Add note to this deck
                        </Link>
                        <Link
                            href={`/browse`}
                            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
                        >
                            Browse cards
                        </Link>
                        <Link
                            href={`/deck/${deck.id}/options`}
                            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
                        >
                            Deck options
                        </Link>
                        <Link
                            href={`/deck/${deck.id}/custom-study`}
                            className="rounded-xl border border-amber-700/70 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20"
                        >
                            Custom study
                        </Link>
                    </section>
                </>
            ) : null}
        </main>
    );
}

function CountCard({ label, value }: { readonly label: string; readonly value: number }) {
    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
            <div className="text-lg font-semibold text-slate-100">{value}</div>
        </div>
    );
}
