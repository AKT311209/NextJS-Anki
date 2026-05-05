"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCollection } from "@/hooks/use-collection";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import {
    CustomStudyError,
    CustomStudyService,
    type CustomStudyCramKind,
    type CustomStudyDefaults,
    type CustomStudyTagDefault,
} from "@/lib/scheduler/custom-study";

type CustomStudyMode =
    | "new-limit-delta"
    | "review-limit-delta"
    | "forgot-days"
    | "review-ahead-days"
    | "preview-days"
    | "cram";

interface CramTagState extends CustomStudyTagDefault {
    readonly include: boolean;
    readonly exclude: boolean;
}

const MODE_LABELS: ReadonlyArray<{ readonly mode: CustomStudyMode; readonly label: string }> = [
    { mode: "review-ahead-days", label: "Review ahead" },
    { mode: "forgot-days", label: "Review forgotten cards" },
    { mode: "new-limit-delta", label: "Increase today’s new card limit" },
    { mode: "review-limit-delta", label: "Increase today’s review card limit" },
    { mode: "cram", label: "Study by card state or tag" },
    { mode: "preview-days", label: "Preview new cards" },
];

const CRAM_KIND_OPTIONS: ReadonlyArray<{ readonly value: CustomStudyCramKind; readonly label: string }> = [
    { value: "new", label: "New cards only" },
    { value: "due", label: "Due cards only" },
    { value: "review", label: "All review cards in random order" },
    { value: "all", label: "All cards in random order (don’t reschedule)" },
];

export default function CustomStudyPage() {
    const params = useParams<{ deckId: string }>();
    const collection = useCollection();

    const deckId = useMemo(() => {
        const parsed = Number.parseInt(params.deckId, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }, [params.deckId]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [deck, setDeck] = useState<DeckRecord | null>(null);
    const [defaults, setDefaults] = useState<CustomStudyDefaults | null>(null);
    const [mode, setMode] = useState<CustomStudyMode>("review-ahead-days");
    const [value, setValue] = useState(1);
    const [cramKind, setCramKind] = useState<CustomStudyCramKind>("new");
    const [tagState, setTagState] = useState<CramTagState[]>([]);
    const [studyDeckId, setStudyDeckId] = useState<number | null>(null);

    const modeConfig = useMemo(() => resolveModeConfig(mode, defaults), [mode, defaults]);

    const loadData = useCallback(async () => {
        if (!collection.connection || !collection.ready || deckId === null) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const connection = collection.connection;
            await ensureCollectionBootstrap(connection);

            const decks = new DecksRepository(connection);
            const customStudy = new CustomStudyService(connection);

            const [currentDeck, nextDefaults] = await Promise.all([
                decks.getById(deckId),
                customStudy.getDefaults(deckId),
            ]);

            if (!currentDeck) {
                throw new Error(`Deck ${deckId} not found.`);
            }

            setDeck(currentDeck);
            setDefaults(nextDefaults);
            setTagState(nextDefaults.tags.map((tag) => ({ ...tag })));
            setValue(resolveModeConfig(mode, nextDefaults).defaultValue);
            setStudyDeckId(null);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to load custom study options.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready, deckId, mode]);

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }

        void loadData();
    }, [collection.connection, collection.ready, loadData]);

    useEffect(() => {
        setValue(modeConfig.defaultValue);
    }, [modeConfig.defaultValue]);

    const submit = useCallback(async () => {
        if (!collection.connection || deckId === null) {
            return;
        }

        setSaving(true);
        setError(null);
        setStatus(null);
        setStudyDeckId(null);

        try {
            const customStudy = new CustomStudyService(collection.connection);

            if (mode === "new-limit-delta") {
                await customStudy.apply({
                    deckId,
                    mode,
                    delta: Math.trunc(value),
                });
                setStatus("Updated today’s new-card limit extension.");
            } else if (mode === "review-limit-delta") {
                await customStudy.apply({
                    deckId,
                    mode,
                    delta: Math.trunc(value),
                });
                setStatus("Updated today’s review-card limit extension.");
            } else if (mode === "forgot-days") {
                const result = await customStudy.apply({
                    deckId,
                    mode,
                    days: Math.max(1, Math.trunc(value)),
                });
                setStatus(formatFilteredDeckStatus(result.movedCardCount));
                setStudyDeckId(result.filteredDeckId ?? null);
            } else if (mode === "review-ahead-days") {
                const result = await customStudy.apply({
                    deckId,
                    mode,
                    days: Math.max(1, Math.trunc(value)),
                });
                setStatus(formatFilteredDeckStatus(result.movedCardCount));
                setStudyDeckId(result.filteredDeckId ?? null);
            } else if (mode === "preview-days") {
                const result = await customStudy.apply({
                    deckId,
                    mode,
                    days: Math.max(1, Math.trunc(value)),
                });
                setStatus(formatFilteredDeckStatus(result.movedCardCount));
                setStudyDeckId(result.filteredDeckId ?? null);
            } else {
                const include = tagState.filter((tag) => tag.include).map((tag) => tag.name);
                const exclude = tagState.filter((tag) => tag.exclude).map((tag) => tag.name);

                const result = await customStudy.apply({
                    deckId,
                    mode,
                    cram: {
                        kind: cramKind,
                        cardLimit: Math.max(0, Math.trunc(value)),
                        tagsToInclude: include,
                        tagsToExclude: exclude,
                    },
                });

                setStatus(formatFilteredDeckStatus(result.movedCardCount));
                setStudyDeckId(result.filteredDeckId ?? null);
            }

            if (mode === "new-limit-delta" || mode === "review-limit-delta" || mode === "cram") {
                const refreshedDefaults = await new CustomStudyService(collection.connection).getDefaults(deckId);
                setDefaults(refreshedDefaults);
                setTagState(refreshedDefaults.tags.map((tag) => ({ ...tag })));
            }
        } catch (cause) {
            if (cause instanceof CustomStudyError) {
                setError(cause.message);
            } else {
                const message = cause instanceof Error ? cause.message : "Custom Study failed.";
                setError(message);
            }
        } finally {
            setSaving(false);
        }
    }, [collection.connection, cramKind, deckId, mode, tagState, value]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href={deckId === null ? "/" : `/deck/${deckId}`} className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to deck
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Custom Study</h1>
            </header>

            {loading ? (
                <section className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
                    Loading custom study options…
                </section>
            ) : null}

            {!loading && deck ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <h2 className="text-lg font-semibold text-slate-100">{deck.name}</h2>
                    <p className="mt-1 text-xs text-slate-400">Deck ID: {deck.id}</p>
                </section>
            ) : null}

            {error ? (
                <section className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {error}
                </section>
            ) : null}

            {status ? (
                <section className="rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
                    <div>{status}</div>
                    {studyDeckId !== null ? (
                        <div className="mt-2">
                            <Link
                                href={`/review/${studyDeckId}`}
                                className="text-emerald-200 underline underline-offset-4 hover:text-emerald-100"
                            >
                                Study now →
                            </Link>
                        </div>
                    ) : null}
                </section>
            ) : null}

            {!loading && defaults ? (
                <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <section className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Mode</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {MODE_LABELS.map((entry) => (
                                <label key={entry.mode} className="inline-flex items-center gap-2 text-sm text-slate-200">
                                    <input
                                        type="radio"
                                        name="custom-study-mode"
                                        checked={mode === entry.mode}
                                        onChange={() => {
                                            setMode(entry.mode);
                                            setStatus(null);
                                            setError(null);
                                            setStudyDeckId(null);
                                        }}
                                    />
                                    {entry.label}
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Settings</h3>
                        {modeConfig.titleText ? <p className="text-sm text-slate-300">{modeConfig.titleText}</p> : null}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 text-sm">
                                <span className="text-slate-300">{modeConfig.numberLabel}</span>
                                <input
                                    type="number"
                                    min={modeConfig.min}
                                    max={modeConfig.max}
                                    value={Number.isFinite(value) ? value : 0}
                                    onChange={(event) => setValue(Number.parseInt(event.currentTarget.value, 10))}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
                                />
                            </label>

                            {mode === "cram" ? (
                                <label className="space-y-1 text-sm">
                                    <span className="text-slate-300">Card type</span>
                                    <select
                                        value={cramKind}
                                        onChange={(event) => setCramKind(event.currentTarget.value as CustomStudyCramKind)}
                                        className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
                                    >
                                        {CRAM_KIND_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                        </div>
                    </section>

                    {mode === "cram" ? (
                        <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Tag filters</h3>
                            {tagState.length === 0 ? (
                                <p className="text-sm text-slate-400">No tags found in this deck.</p>
                            ) : (
                                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                                    {tagState.map((tag) => (
                                        <div
                                            key={tag.name}
                                            className="grid gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 sm:grid-cols-[1fr_auto_auto]"
                                        >
                                            <span className="truncate text-sm text-slate-200">{tag.name}</span>
                                            <label className="inline-flex items-center gap-1 text-xs text-emerald-200">
                                                <input
                                                    type="checkbox"
                                                    checked={tag.include}
                                                    onChange={(event) => {
                                                        const checked = event.currentTarget.checked;
                                                        setTagState((current) =>
                                                            current.map((entry) =>
                                                                entry.name === tag.name
                                                                    ? {
                                                                        ...entry,
                                                                        include: checked,
                                                                        exclude: checked ? false : entry.exclude,
                                                                    }
                                                                    : entry,
                                                            ),
                                                        );
                                                    }}
                                                />
                                                Include
                                            </label>
                                            <label className="inline-flex items-center gap-1 text-xs text-rose-200">
                                                <input
                                                    type="checkbox"
                                                    checked={tag.exclude}
                                                    onChange={(event) => {
                                                        const checked = event.currentTarget.checked;
                                                        setTagState((current) =>
                                                            current.map((entry) =>
                                                                entry.name === tag.name
                                                                    ? {
                                                                        ...entry,
                                                                        exclude: checked,
                                                                        include: checked ? false : entry.include,
                                                                    }
                                                                    : entry,
                                                            ),
                                                        );
                                                    }}
                                                />
                                                Exclude
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    ) : null}

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void submit()}
                            disabled={saving}
                            className="rounded-md border border-sky-700/70 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition enabled:hover:bg-sky-500/20 disabled:opacity-50"
                        >
                            {saving ? "Working…" : modeConfig.submitLabel}
                        </button>
                    </div>
                </section>
            ) : null}
        </main>
    );
}

function resolveModeConfig(mode: CustomStudyMode, defaults: CustomStudyDefaults | null): {
    readonly titleText: string;
    readonly numberLabel: string;
    readonly min: number;
    readonly max: number;
    readonly defaultValue: number;
    readonly submitLabel: string;
} {
    if (mode === "new-limit-delta") {
        return {
            titleText: formatAvailableCount(
                "Available new cards",
                defaults?.availableNew ?? 0,
                defaults?.availableNewInChildren ?? 0,
            ),
            numberLabel: "Increase today’s new card limit by",
            min: -9999,
            max: 9999,
            defaultValue: defaults?.extendNew ?? 0,
            submitLabel: "Apply",
        };
    }

    if (mode === "review-limit-delta") {
        return {
            titleText: formatAvailableCount(
                "Available review cards",
                defaults?.availableReview ?? 0,
                defaults?.availableReviewInChildren ?? 0,
            ),
            numberLabel: "Increase today’s review card limit by",
            min: -9999,
            max: 9999,
            defaultValue: defaults?.extendReview ?? 0,
            submitLabel: "Apply",
        };
    }

    if (mode === "forgot-days") {
        return {
            titleText: "",
            numberLabel: "Review cards forgotten in the last (days)",
            min: 1,
            max: 30,
            defaultValue: 1,
            submitLabel: "Create custom session",
        };
    }

    if (mode === "review-ahead-days") {
        return {
            titleText: "",
            numberLabel: "Review ahead by (days)",
            min: 1,
            max: 9999,
            defaultValue: 1,
            submitLabel: "Create custom session",
        };
    }

    if (mode === "preview-days") {
        return {
            titleText: "",
            numberLabel: "Preview new cards added in the last (days)",
            min: 1,
            max: 9999,
            defaultValue: 1,
            submitLabel: "Create custom session",
        };
    }

    return {
        titleText: "",
        numberLabel: "Cards from the deck",
        min: 0,
        max: 9999,
        defaultValue: 100,
        submitLabel: "Choose tags & create",
    };
}

function formatAvailableCount(label: string, own: number, children: number): string {
    if (children <= 0) {
        return `${label}: ${own}`;
    }

    return `${label}: ${own} (+${children} in child decks)`;
}

function formatFilteredDeckStatus(movedCardCount: number | undefined): string {
    const count = Math.max(0, Math.trunc(movedCardCount ?? 0));
    if (count === 1) {
        return "Created custom study session with 1 card.";
    }

    return `Created custom study session with ${count} cards.`;
}
