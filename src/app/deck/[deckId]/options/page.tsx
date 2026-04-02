"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCollection } from "@/hooks/use-collection";
import { optimizeSchedulerParameters, type SchedulerOptimizationResult } from "@/lib/scheduler/params";
import { DEFAULT_DECK_CONFIG_ID, ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";

interface DeckOptionForm {
    readonly newPerDay: number;
    readonly reviewsPerDay: number;
    readonly learningPerDay: number;
    readonly learningSteps: string;
    readonly relearningSteps: string;
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly burySiblings: boolean;
    readonly enableFuzz: boolean;
}

interface RevlogOptimizationRow {
    readonly ease: number;
    readonly ivl: number;
    readonly lastIvl: number;
}

const DEFAULT_FORM: DeckOptionForm = {
    newPerDay: 20,
    reviewsPerDay: 200,
    learningPerDay: 200,
    learningSteps: "1m 10m",
    relearningSteps: "10m",
    requestRetention: 0.9,
    maximumInterval: 36500,
    burySiblings: true,
    enableFuzz: true,
};

export default function DeckOptionsPage() {
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
    const [form, setForm] = useState<DeckOptionForm>(DEFAULT_FORM);
    const [optimization, setOptimization] = useState<SchedulerOptimizationResult | null>(null);

    const loadOptions = useCallback(async () => {
        if (!collection.connection || !collection.ready || deckId === null) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const connection = collection.connection;
            await ensureCollectionBootstrap(connection);

            const decks = new DecksRepository(connection);
            const config = new ConfigRepository(connection);

            const currentDeck = await decks.getById(deckId);
            if (!currentDeck) {
                throw new Error(`Deck ${deckId} not found.`);
            }

            const configId = currentDeck.conf ?? DEFAULT_DECK_CONFIG_ID;
            const existingConfig = await config.getDeckConfig(configId);

            setDeck(currentDeck);
            setForm(resolveDeckOptionForm(existingConfig));
            setOptimization(null);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to load deck options.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready, deckId]);

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }
        void loadOptions();
    }, [collection.connection, collection.ready, loadOptions]);

    const saveOptions = useCallback(async () => {
        if (!collection.connection || !deck) {
            return;
        }

        setSaving(true);
        setError(null);
        setStatus(null);

        try {
            const connection = collection.connection;
            const decks = new DecksRepository(connection);
            const config = new ConfigRepository(connection);

            const configId = deck.conf ?? DEFAULT_DECK_CONFIG_ID;
            if (deck.conf !== configId) {
                await decks.update(deck.id, { conf: configId });
            }

            const learningSteps = parseSteps(form.learningSteps);
            const relearningSteps = parseSteps(form.relearningSteps);

            await config.updateDeckConfig(configId, {
                id: configId,
                name: deck.name,
                newPerDay: form.newPerDay,
                reviewsPerDay: form.reviewsPerDay,
                learningPerDay: form.learningPerDay,
                learningSteps,
                relearningSteps,
                requestRetention: form.requestRetention,
                maximumInterval: form.maximumInterval,
                burySiblings: form.burySiblings,
                enableFuzz: form.enableFuzz,
                new: {
                    perDay: form.newPerDay,
                    delays: learningSteps.map(stepToMinutes),
                },
                rev: {
                    perDay: form.reviewsPerDay,
                    maxIvl: form.maximumInterval,
                },
                lapse: {
                    delays: relearningSteps.map(stepToMinutes),
                },
            });

            setStatus("Deck options saved.");
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to save deck options.";
            setError(message);
        } finally {
            setSaving(false);
        }
    }, [collection.connection, deck, form]);

    const runOptimizer = useCallback(async () => {
        if (!collection.connection || !deck) {
            return;
        }

        setError(null);
        setStatus(null);

        try {
            const rows = await collection.connection.select<RevlogOptimizationRow>(
                `
                SELECT r.ease, r.ivl, r.lastIvl
                FROM revlog r
                INNER JOIN cards c ON c.id = r.cid
                WHERE c.did = ?
                ORDER BY r.id DESC
                LIMIT 20000
                `,
                [deck.id],
            );

            const optimized = optimizeSchedulerParameters(rows, {
                requestRetention: form.requestRetention,
                maximumInterval: form.maximumInterval,
            });

            setOptimization(optimized);
            setForm((current) => ({
                ...current,
                requestRetention: optimized.requestRetention,
                maximumInterval: optimized.maximumInterval,
            }));
            setStatus(`Optimizer processed ${optimized.reviewCount} review(s).`);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to run optimizer.";
            setError(message);
        }
    }, [collection.connection, deck, form.maximumInterval, form.requestRetention]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href="/" className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to decks
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Deck options</h1>
                <p className="text-sm text-slate-400">Tune daily limits and FSRS behavior for this deck.</p>
            </header>

            {loading ? (
                <section className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
                    Loading deck options…
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
                    {status}
                </section>
            ) : null}

            {!loading && deck ? (
                <form
                    className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void saveOptions();
                    }}
                >
                    <div className="grid gap-3 sm:grid-cols-3">
                        <NumberField
                            label="New / day"
                            value={form.newPerDay}
                            onChange={(value) => setForm((current) => ({ ...current, newPerDay: value }))}
                        />
                        <NumberField
                            label="Reviews / day"
                            value={form.reviewsPerDay}
                            onChange={(value) => setForm((current) => ({ ...current, reviewsPerDay: value }))}
                        />
                        <NumberField
                            label="Learning / day"
                            value={form.learningPerDay}
                            onChange={(value) => setForm((current) => ({ ...current, learningPerDay: value }))}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <TextField
                            label="Learning steps"
                            value={form.learningSteps}
                            placeholder="1m 10m"
                            onChange={(value) => setForm((current) => ({ ...current, learningSteps: value }))}
                        />
                        <TextField
                            label="Relearning steps"
                            value={form.relearningSteps}
                            placeholder="10m"
                            onChange={(value) => setForm((current) => ({ ...current, relearningSteps: value }))}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <NumberField
                            label="Desired retention"
                            value={form.requestRetention}
                            min={0.8}
                            max={0.99}
                            step={0.01}
                            onChange={(value) => setForm((current) => ({ ...current, requestRetention: value }))}
                        />
                        <NumberField
                            label="Maximum interval (days)"
                            value={form.maximumInterval}
                            min={1}
                            step={1}
                            onChange={(value) => setForm((current) => ({ ...current, maximumInterval: value }))}
                        />
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm">
                        <label className="inline-flex items-center gap-2 text-slate-200">
                            <input
                                type="checkbox"
                                checked={form.burySiblings}
                                onChange={(event) =>
                                    setForm((current) => ({ ...current, burySiblings: event.currentTarget.checked }))
                                }
                            />
                            Bury siblings
                        </label>
                        <label className="inline-flex items-center gap-2 text-slate-200">
                            <input
                                type="checkbox"
                                checked={form.enableFuzz}
                                onChange={(event) =>
                                    setForm((current) => ({ ...current, enableFuzz: event.currentTarget.checked }))
                                }
                            />
                            Interval fuzzing
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-md border border-sky-700/70 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition enabled:hover:bg-sky-500/20 disabled:opacity-50"
                        >
                            {saving ? "Saving…" : "Save options"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void runOptimizer()}
                            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                        >
                            Run FSRS optimizer
                        </button>
                    </div>
                </form>
            ) : null}

            {optimization ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <h2 className="text-lg font-semibold text-slate-100">Optimizer result</h2>
                    <dl className="mt-3 grid grid-cols-2 gap-2">
                        <Info label="Reviews" value={optimization.reviewCount} />
                        <Info label="Recall rate" value={`${(optimization.recallRate * 100).toFixed(1)}%`} />
                        <Info label="Suggested retention" value={optimization.requestRetention.toFixed(3)} />
                        <Info label="Suggested max interval" value={`${optimization.maximumInterval}d`} />
                    </dl>
                </section>
            ) : null}
        </main>
    );
}

function resolveDeckOptionForm(config: Record<string, unknown> | null): DeckOptionForm {
    if (!config) {
        return DEFAULT_FORM;
    }

    return {
        newPerDay: firstNumber(config.newPerDay, getNestedNumber(config.new, "perDay"), DEFAULT_FORM.newPerDay),
        reviewsPerDay: firstNumber(
            config.reviewsPerDay,
            getNestedNumber(config.rev, "perDay"),
            DEFAULT_FORM.reviewsPerDay,
        ),
        learningPerDay: firstNumber(config.learningPerDay, DEFAULT_FORM.learningPerDay),
        learningSteps: parseStepString(firstArray(config.learningSteps), firstArray(getNestedValue(config.new, "delays"))),
        relearningSteps: parseStepString(
            firstArray(config.relearningSteps),
            firstArray(getNestedValue(config.lapse, "delays")),
        ),
        requestRetention: firstNumber(config.requestRetention, DEFAULT_FORM.requestRetention),
        maximumInterval: firstNumber(
            config.maximumInterval,
            getNestedNumber(config.rev, "maxIvl"),
            DEFAULT_FORM.maximumInterval,
        ),
        burySiblings: firstBoolean(config.burySiblings, DEFAULT_FORM.burySiblings),
        enableFuzz: firstBoolean(config.enableFuzz, DEFAULT_FORM.enableFuzz),
    };
}

function parseStepString(primary: unknown[] | null, fallback: unknown[] | null): string {
    const source = primary ?? fallback ?? [];
    if (!Array.isArray(source) || source.length === 0) {
        return DEFAULT_FORM.learningSteps;
    }

    const steps = source
        .map((value) => {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                return `${Math.trunc(value)}m`;
            }
            if (typeof value === "string") {
                const normalized = value.trim().toLowerCase();
                return /^\d+(m|h|d)$/.test(normalized) ? normalized : null;
            }
            return null;
        })
        .filter((step): step is string => step !== null);

    return steps.length > 0 ? steps.join(" ") : DEFAULT_FORM.learningSteps;
}

function parseSteps(value: string): string[] {
    return value
        .split(/[\s,]+/)
        .map((step) => step.trim().toLowerCase())
        .filter((step) => /^\d+(m|h|d)$/.test(step));
}

function stepToMinutes(step: string): number {
    const match = step.match(/^(\d+)(m|h|d)$/);
    if (!match) {
        return 1;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    if (unit === "m") {
        return value;
    }
    if (unit === "h") {
        return value * 60;
    }
    return value * 60 * 24;
}

function firstNumber(...values: unknown[]): number {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return 0;
}

function firstBoolean(...values: unknown[]): boolean {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return false;
}

function firstArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function getNestedValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return (value as Record<string, unknown>)[key];
}

function getNestedNumber(value: unknown, key: string): number | undefined {
    const candidate = getNestedValue(value, key);
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function NumberField({
    label,
    value,
    onChange,
    min,
    max,
    step,
}: {
    readonly label: string;
    readonly value: number;
    readonly onChange: (value: number) => void;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
}) {
    return (
        <label className="space-y-1 text-sm">
            <span className="text-slate-300">{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(value) ? value : 0}
                onChange={(event) => onChange(Number.parseFloat(event.currentTarget.value))}
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
            />
        </label>
    );
}

function TextField({
    label,
    value,
    placeholder,
    onChange,
}: {
    readonly label: string;
    readonly value: string;
    readonly placeholder: string;
    readonly onChange: (value: string) => void;
}) {
    return (
        <label className="space-y-1 text-sm">
            <span className="text-slate-300">{label}</span>
            <input
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.currentTarget.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
            />
        </label>
    );
}

function Info({ label, value }: { readonly label: string; readonly value: string | number }) {
    return (
        <>
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-slate-100">{value}</dd>
        </>
    );
}
