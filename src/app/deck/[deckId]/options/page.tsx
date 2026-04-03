"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCollection } from "@/hooks/use-collection";
import { optimizeSchedulerParameters, type SchedulerOptimizationResult } from "@/lib/scheduler/params";
import { DEFAULT_DECK_CONFIG_ID, ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import type {
    SchedulerAnswerAction,
    SchedulerNewCardGatherPriority,
    SchedulerNewCardSortOrder,
    SchedulerQuestionAction,
    SchedulerReviewMix,
    SchedulerReviewSortOrder,
} from "@/lib/types/scheduler";

interface DeckOptionForm {
    readonly newPerDay: number;
    readonly reviewsPerDay: number;
    readonly learningPerDay: number;
    readonly learningSteps: string;
    readonly relearningSteps: string;
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly fsrsWeights: readonly number[];
    readonly newCardGatherPriority: SchedulerNewCardGatherPriority;
    readonly newCardSortOrder: SchedulerNewCardSortOrder;
    readonly newReviewMix: SchedulerReviewMix;
    readonly interdayLearningMix: SchedulerReviewMix;
    readonly reviewSortOrder: SchedulerReviewSortOrder;
    readonly buryNew: boolean;
    readonly buryReviews: boolean;
    readonly buryInterdayLearning: boolean;
    readonly leechAction: "tag-only" | "suspend";
    readonly disableAutoplay: boolean;
    readonly skipQuestionWhenReplayingAnswer: boolean;
    readonly capAnswerTimeToSecs: number;
    readonly showTimer: boolean;
    readonly stopTimerOnAnswer: boolean;
    readonly secondsToShowQuestion: number;
    readonly secondsToShowAnswer: number;
    readonly waitForAudio: boolean;
    readonly questionAction: SchedulerQuestionAction;
    readonly answerAction: SchedulerAnswerAction;
    readonly easyDaysPercentages: readonly number[];
    readonly newCardsIgnoreReviewLimit: boolean;
    readonly applyAllParentLimits: boolean;
    readonly enableFuzz: boolean;
}

interface RevlogOptimizationRow {
    readonly id: number;
    readonly cid: number;
    readonly ease: number;
    readonly ivl: number;
    readonly lastIvl: number;
    readonly type: number;
}

const DEFAULT_FORM: DeckOptionForm = {
    newPerDay: 20,
    reviewsPerDay: 200,
    learningPerDay: 200,
    learningSteps: "1m 10m",
    relearningSteps: "10m",
    requestRetention: 0.9,
    maximumInterval: 36500,
    fsrsWeights: [],
    newCardGatherPriority: "deck",
    newCardSortOrder: "template",
    newReviewMix: "mix-with-reviews",
    interdayLearningMix: "mix-with-reviews",
    reviewSortOrder: "due",
    buryNew: false,
    buryReviews: false,
    buryInterdayLearning: false,
    leechAction: "tag-only",
    disableAutoplay: false,
    skipQuestionWhenReplayingAnswer: false,
    capAnswerTimeToSecs: 60,
    showTimer: false,
    stopTimerOnAnswer: false,
    secondsToShowQuestion: 0,
    secondsToShowAnswer: 0,
    waitForAudio: true,
    questionAction: "show-answer",
    answerAction: "bury-card",
    easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
    newCardsIgnoreReviewLimit: false,
    applyAllParentLimits: false,
    enableFuzz: true,
};

const DESIRED_RETENTION_MIN = 0.8;
const DESIRED_RETENTION_MAX = 0.99;
const DESIRED_RETENTION_STEP = 0.01;
const EASY_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const NEW_GATHER_PRIORITY_OPTIONS: ReadonlyArray<{
    readonly label: string;
    readonly value: SchedulerNewCardGatherPriority;
}> = [
        { label: "Deck", value: "deck" },
        { label: "Deck, then random notes", value: "deck-then-random-notes" },
        { label: "Ascending position", value: "lowest-position" },
        { label: "Descending position", value: "highest-position" },
        { label: "Random notes", value: "random-notes" },
        { label: "Random cards", value: "random-cards" },
    ];

const NEW_SORT_ORDER_OPTIONS: ReadonlyArray<{
    readonly label: string;
    readonly value: SchedulerNewCardSortOrder;
}> = [
        { label: "Card template, then gather order", value: "template" },
        { label: "Gather order", value: "no-sort" },
        { label: "Card template, then random", value: "template-then-random" },
        { label: "Random note, then template", value: "random-note-then-template" },
        { label: "Random", value: "random-card" },
    ];

const REVIEW_SORT_ORDER_OPTIONS: ReadonlyArray<{
    readonly label: string;
    readonly value: SchedulerReviewSortOrder;
}> = [
        { label: "Due date, then random", value: "due" },
        { label: "Due date, then deck", value: "due-then-deck" },
        { label: "Deck, then due date", value: "deck-then-due" },
        { label: "Intervals ascending", value: "interval-ascending" },
        { label: "Intervals descending", value: "interval-descending" },
        { label: "Ease ascending", value: "ease-ascending" },
        { label: "Ease descending", value: "ease-descending" },
        { label: "Retrievability ascending", value: "retrievability-ascending" },
        { label: "Retrievability descending", value: "retrievability-descending" },
        { label: "Relative overdueness", value: "relative-overdueness" },
        { label: "Random", value: "random" },
        { label: "Added", value: "added" },
        { label: "Reverse added", value: "reverse-added" },
    ];

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
    const disabledNewSortOrders = useMemo(
        () => disabledNewSortOrdersForGather(form.newCardGatherPriority),
        [form.newCardGatherPriority],
    );

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
            const [existingConfig, globalConfig] = await Promise.all([
                config.getDeckConfig(configId),
                config.getGlobalConfig(),
            ]);

            setDeck(currentDeck);
            setForm(resolveDeckOptionForm(existingConfig, globalConfig));
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
            const normalizedRetention = normalizeRequestRetention(form.requestRetention);
            const normalizedMaximumInterval = Math.max(1, Math.trunc(form.maximumInterval));
            const normalizedCapAnswerTimeToSecs = Math.min(7200, Math.max(1, Math.trunc(form.capAnswerTimeToSecs)));
            const normalizedSecondsToShowQuestion = Math.max(0, roundToStep(form.secondsToShowQuestion, 0.1));
            const normalizedSecondsToShowAnswer = Math.max(0, roundToStep(form.secondsToShowAnswer, 0.1));
            const normalizedQuestionAction = normalizeQuestionAction(form.questionAction);
            const normalizedAnswerAction = normalizeAnswerAction(form.answerAction);
            const normalizedReviewSortOrder = normalizeReviewSortOrder(form.reviewSortOrder);
            const normalizedNewCardGatherPriority = normalizeNewCardGatherPriority(form.newCardGatherPriority);
            const normalizedNewCardSortOrder = coerceNewCardSortOrderForGather(
                normalizeNewCardSortOrder(form.newCardSortOrder),
                normalizedNewCardGatherPriority,
            );
            const normalizedNewReviewMix = normalizeReviewMix(form.newReviewMix);
            const normalizedInterdayLearningMix = normalizeReviewMix(form.interdayLearningMix);
            const normalizedEasyDaysPercentages = normalizeEasyDaysPercentages(form.easyDaysPercentages);
            const burySiblings = form.buryNew || form.buryReviews || form.buryInterdayLearning;

            await config.updateDeckConfig(configId, {
                id: configId,
                name: deck.name,
                newPerDay: form.newPerDay,
                reviewsPerDay: form.reviewsPerDay,
                learningPerDay: form.learningPerDay,
                learningSteps,
                relearningSteps,
                requestRetention: normalizedRetention,
                maximumInterval: normalizedMaximumInterval,
                fsrsWeights: form.fsrsWeights,
                newCardGatherPriority: normalizedNewCardGatherPriority,
                newCardSortOrder: normalizedNewCardSortOrder,
                newReviewMix: normalizedNewReviewMix,
                interdayLearningMix: normalizedInterdayLearningMix,
                reviewSortOrder: normalizedReviewSortOrder,
                disableAutoplay: form.disableAutoplay,
                skipQuestionWhenReplayingAnswer: form.skipQuestionWhenReplayingAnswer,
                capAnswerTimeToSecs: normalizedCapAnswerTimeToSecs,
                showTimer: form.showTimer,
                stopTimerOnAnswer: form.stopTimerOnAnswer,
                secondsToShowQuestion: normalizedSecondsToShowQuestion,
                secondsToShowAnswer: normalizedSecondsToShowAnswer,
                waitForAudio: form.waitForAudio,
                questionAction: encodeQuestionAction(normalizedQuestionAction),
                answerAction: encodeAnswerAction(normalizedAnswerAction),
                easyDaysPercentages: normalizedEasyDaysPercentages,
                burySiblings,
                buryNew: form.buryNew,
                buryReviews: form.buryReviews,
                buryInterdayLearning: form.buryInterdayLearning,
                leechAction: form.leechAction,
                enableFuzz: form.enableFuzz,
                newMix: encodeReviewMix(normalizedNewReviewMix),
                interday_learning_mix: encodeReviewMix(normalizedInterdayLearningMix),
                dayLearnMix: encodeReviewMix(normalizedInterdayLearningMix),
                newGatherPriority: encodeNewCardGatherPriority(normalizedNewCardGatherPriority),
                new_gather_priority: encodeNewCardGatherPriority(normalizedNewCardGatherPriority),
                new_card_gather_priority: encodeNewCardGatherPriority(normalizedNewCardGatherPriority),
                newSortOrder: encodeNewCardSortOrder(normalizedNewCardSortOrder),
                new_sort_order: encodeNewCardSortOrder(normalizedNewCardSortOrder),
                new_card_sort_order: encodeNewCardSortOrder(normalizedNewCardSortOrder),
                reviewOrder: encodeReviewSortOrder(normalizedReviewSortOrder),
                review_order: encodeReviewSortOrder(normalizedReviewSortOrder),
                disable_autoplay: form.disableAutoplay,
                skip_question_when_replaying_answer: form.skipQuestionWhenReplayingAnswer,
                cap_answer_time_to_secs: normalizedCapAnswerTimeToSecs,
                maxTaken: normalizedCapAnswerTimeToSecs,
                max_taken: normalizedCapAnswerTimeToSecs,
                show_timer: form.showTimer,
                timer: form.showTimer ? 1 : 0,
                stop_timer_on_answer: form.stopTimerOnAnswer,
                seconds_to_show_question: normalizedSecondsToShowQuestion,
                seconds_to_show_answer: normalizedSecondsToShowAnswer,
                wait_for_audio: form.waitForAudio,
                question_action: encodeQuestionAction(normalizedQuestionAction),
                answer_action: encodeAnswerAction(normalizedAnswerAction),
                easy_days_percentages: normalizedEasyDaysPercentages,
                autoplay: !form.disableAutoplay,
                replayq: !form.skipQuestionWhenReplayingAnswer,
                new: {
                    perDay: form.newPerDay,
                    delays: learningSteps.map(stepToMinutes),
                    bury: form.buryNew,
                },
                rev: {
                    perDay: form.reviewsPerDay,
                    maxIvl: normalizedMaximumInterval,
                    bury: form.buryReviews,
                },
                lapse: {
                    delays: relearningSteps.map(stepToMinutes),
                    leechAction: form.leechAction === "suspend" ? 0 : 1,
                },
            });

            await config.updateGlobalConfig({
                newCardsIgnoreReviewLimit: form.newCardsIgnoreReviewLimit,
                applyAllParentLimits: form.applyAllParentLimits,
            });

            setForm((current) => ({
                ...current,
                requestRetention: normalizedRetention,
                maximumInterval: normalizedMaximumInterval,
                capAnswerTimeToSecs: normalizedCapAnswerTimeToSecs,
                secondsToShowQuestion: normalizedSecondsToShowQuestion,
                secondsToShowAnswer: normalizedSecondsToShowAnswer,
                questionAction: normalizedQuestionAction,
                answerAction: normalizedAnswerAction,
                newCardGatherPriority: normalizedNewCardGatherPriority,
                newCardSortOrder: normalizedNewCardSortOrder,
                reviewSortOrder: normalizedReviewSortOrder,
                newReviewMix: normalizedNewReviewMix,
                interdayLearningMix: normalizedInterdayLearningMix,
                easyDaysPercentages: normalizedEasyDaysPercentages,
            }));

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
                SELECT r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.type
                FROM revlog r
                INNER JOIN cards c ON c.id = r.cid
                WHERE c.did = ?
                ORDER BY c.id ASC, r.id ASC
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
                fsrsWeights: [...optimized.weights],
            }));
            setStatus(
                `Optimizer processed ${optimized.reviewCount} review(s) and produced ${optimized.weights.length} parameter(s).`,
            );
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
                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Scheduling</h3>
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
                                min={DESIRED_RETENTION_MIN}
                                max={DESIRED_RETENTION_MAX}
                                step={DESIRED_RETENTION_STEP}
                                onChange={(value) =>
                                    setForm((current) => ({
                                        ...current,
                                        requestRetention: normalizeRequestRetention(value),
                                    }))
                                }
                            />
                            <NumberField
                                label="Maximum interval (days)"
                                value={form.maximumInterval}
                                min={1}
                                step={1}
                                onChange={(value) => setForm((current) => ({ ...current, maximumInterval: value }))}
                            />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 text-sm">
                                <span className="text-slate-300">Leech action</span>
                                <select
                                    value={form.leechAction}
                                    onChange={(event) => {
                                        const value = event.currentTarget.value === "suspend" ? "suspend" : "tag-only";
                                        setForm((current) => ({ ...current, leechAction: value }));
                                    }}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
                                >
                                    <option value="tag-only">Tag only</option>
                                    <option value="suspend">Suspend card</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Display ordering</h3>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <SelectField
                                label="New card gather order"
                                value={form.newCardGatherPriority}
                                onChange={(value) =>
                                    setForm((current) => {
                                        const gather = normalizeNewCardGatherPriority(value);
                                        return {
                                            ...current,
                                            newCardGatherPriority: gather,
                                            newCardSortOrder: coerceNewCardSortOrderForGather(
                                                current.newCardSortOrder,
                                                gather,
                                            ),
                                        };
                                    })
                                }
                                options={NEW_GATHER_PRIORITY_OPTIONS}
                            />
                            <SelectField
                                label="New card sort order"
                                value={form.newCardSortOrder}
                                onChange={(value) =>
                                    setForm((current) => ({
                                        ...current,
                                        newCardSortOrder: coerceNewCardSortOrderForGather(
                                            normalizeNewCardSortOrder(value),
                                            current.newCardGatherPriority,
                                        ),
                                    }))
                                }
                                options={NEW_SORT_ORDER_OPTIONS}
                                disabledValues={disabledNewSortOrders}
                            />
                            <SelectField
                                label="New/review order"
                                value={form.newReviewMix}
                                onChange={(value) =>
                                    setForm((current) => ({ ...current, newReviewMix: normalizeReviewMix(value) }))
                                }
                                options={[
                                    { label: "Mix with reviews", value: "mix-with-reviews" },
                                    { label: "After reviews", value: "after-reviews" },
                                    { label: "Before reviews", value: "before-reviews" },
                                ]}
                            />
                            <SelectField
                                label="Interday learning/review order"
                                value={form.interdayLearningMix}
                                onChange={(value) =>
                                    setForm((current) => ({ ...current, interdayLearningMix: normalizeReviewMix(value) }))
                                }
                                options={[
                                    { label: "Mix with reviews", value: "mix-with-reviews" },
                                    { label: "After reviews", value: "after-reviews" },
                                    { label: "Before reviews", value: "before-reviews" },
                                ]}
                            />
                            <SelectField
                                label="Review sort order"
                                value={form.reviewSortOrder}
                                onChange={(value) =>
                                    setForm((current) => ({ ...current, reviewSortOrder: normalizeReviewSortOrder(value) }))
                                }
                                options={REVIEW_SORT_ORDER_OPTIONS}
                            />
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Audio</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.disableAutoplay}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, disableAutoplay: checked }));
                                    }}
                                />
                                Disable autoplay
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.skipQuestionWhenReplayingAnswer}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, skipQuestionWhenReplayingAnswer: checked }));
                                    }}
                                />
                                Skip question audio when replaying answer
                            </label>
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Timers</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <NumberField
                                label="Maximum answer seconds"
                                value={form.capAnswerTimeToSecs}
                                min={1}
                                max={7200}
                                step={1}
                                onChange={(value) => setForm((current) => ({ ...current, capAnswerTimeToSecs: value }))}
                            />
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.showTimer}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, showTimer: checked }));
                                    }}
                                />
                                Show answer timer
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.stopTimerOnAnswer}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, stopTimerOnAnswer: checked }));
                                    }}
                                />
                                Stop timer on answer
                            </label>
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Auto advance</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <NumberField
                                label="Seconds to show question"
                                value={form.secondsToShowQuestion}
                                min={0}
                                step={0.1}
                                onChange={(value) => setForm((current) => ({ ...current, secondsToShowQuestion: value }))}
                            />
                            <NumberField
                                label="Seconds to show answer"
                                value={form.secondsToShowAnswer}
                                min={0}
                                step={0.1}
                                onChange={(value) => setForm((current) => ({ ...current, secondsToShowAnswer: value }))}
                            />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.waitForAudio}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, waitForAudio: checked }));
                                    }}
                                />
                                Wait for audio
                            </label>
                            <SelectField
                                label="Question action"
                                value={form.questionAction}
                                onChange={(value) =>
                                    setForm((current) => ({ ...current, questionAction: normalizeQuestionAction(value) }))
                                }
                                options={[
                                    { label: "Show answer", value: "show-answer" },
                                    { label: "Show reminder", value: "show-reminder" },
                                ]}
                            />
                            <SelectField
                                label="Answer action"
                                value={form.answerAction}
                                onChange={(value) =>
                                    setForm((current) => ({ ...current, answerAction: normalizeAnswerAction(value) }))
                                }
                                options={[
                                    { label: "Bury card", value: "bury-card" },
                                    { label: "Answer Again", value: "answer-again" },
                                    { label: "Answer Good", value: "answer-good" },
                                    { label: "Answer Hard", value: "answer-hard" },
                                    { label: "Show reminder", value: "show-reminder" },
                                ]}
                            />
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Easy days</h3>
                        <p className="text-xs text-slate-400">Set weekday workload multipliers from 0.0 (minimum) to 1.0 (normal).</p>
                        <div className="grid gap-3 sm:grid-cols-7">
                            {EASY_DAY_LABELS.map((label, index) => (
                                <NumberField
                                    key={label}
                                    label={label}
                                    value={form.easyDaysPercentages[index] ?? 1}
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    onChange={(value) =>
                                        setForm((current) => ({
                                            ...current,
                                            easyDaysPercentages: current.easyDaysPercentages.map((entry, entryIndex) =>
                                                entryIndex === index ? Math.min(1, Math.max(0, value)) : entry,
                                            ),
                                        }))
                                    }
                                />
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Burying and global limits</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.buryNew}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, buryNew: checked }));
                                    }}
                                />
                                Bury new siblings
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.buryReviews}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, buryReviews: checked }));
                                    }}
                                />
                                Bury review siblings
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.buryInterdayLearning}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, buryInterdayLearning: checked }));
                                    }}
                                />
                                Bury interday learning siblings
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.newCardsIgnoreReviewLimit}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, newCardsIgnoreReviewLimit: checked }));
                                    }}
                                />
                                New cards ignore review limit (global)
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.applyAllParentLimits}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, applyAllParentLimits: checked }));
                                    }}
                                />
                                Apply all parent limits (global)
                            </label>
                            <label className="inline-flex items-center gap-2 text-slate-200">
                                <input
                                    type="checkbox"
                                    checked={form.enableFuzz}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setForm((current) => ({ ...current, enableFuzz: checked }));
                                    }}
                                />
                                Interval fuzzing
                            </label>
                        </div>
                    </section>

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
                        <Info label="Target retention" value={optimization.requestRetention.toFixed(3)} />
                        <Info label="Target max interval" value={`${optimization.maximumInterval}d`} />
                        <Info label="Optimized weights" value={optimization.weights.length} />
                    </dl>
                </section>
            ) : null}
        </main>
    );
}

function resolveDeckOptionForm(
    config: Record<string, unknown> | null,
    globalConfig: Record<string, unknown> | null,
): DeckOptionForm {
    if (!config) {
        return {
            ...DEFAULT_FORM,
            newCardsIgnoreReviewLimit: firstBoolean(
                globalConfig?.newCardsIgnoreReviewLimit,
                globalConfig?.new_cards_ignore_review_limit,
                DEFAULT_FORM.newCardsIgnoreReviewLimit,
            ),
            applyAllParentLimits: firstBoolean(
                globalConfig?.applyAllParentLimits,
                globalConfig?.apply_all_parent_limits,
                DEFAULT_FORM.applyAllParentLimits,
            ),
        };
    }

    const explicitBury = firstBoolean(config.burySiblings, config.bury);
    const buryNew = firstBoolean(config.buryNew, getNestedBoolean(config.new, "bury"), explicitBury, DEFAULT_FORM.buryNew);
    const buryReviews = firstBoolean(
        config.buryReviews,
        getNestedBoolean(config.rev, "bury"),
        explicitBury,
        DEFAULT_FORM.buryReviews,
    );
    const buryInterdayLearning = firstBoolean(
        config.buryInterdayLearning,
        config.bury_interday_learning,
        explicitBury,
        DEFAULT_FORM.buryInterdayLearning,
    );

    const newReviewMix = normalizeReviewMix(
        firstKnown(config.newReviewMix, config.newMix, config.new_mix),
    );

    const newCardGatherPriority = normalizeNewCardGatherPriority(
        firstKnown(
            config.newCardGatherPriority,
            config.new_card_gather_priority,
            config.newGatherPriority,
            config.new_gather_priority,
        ),
    );

    const newCardSortOrder = coerceNewCardSortOrderForGather(
        normalizeNewCardSortOrder(
            firstKnown(
                config.newCardSortOrder,
                config.new_card_sort_order,
                config.newSortOrder,
                config.new_sort_order,
            ),
        ),
        newCardGatherPriority,
    );

    const interdayLearningMix = normalizeReviewMix(
        firstKnown(config.interdayLearningMix, config.interday_learning_mix, config.dayLearnMix),
    );

    const reviewSortOrder = normalizeReviewSortOrder(
        firstKnown(config.reviewSortOrder, config.reviewOrder, config.review_order),
    );

    const disableAutoplay = firstBoolean(
        config.disableAutoplay,
        config.disable_autoplay,
        invertBoolean(config.autoplay),
        DEFAULT_FORM.disableAutoplay,
    );

    const skipQuestionWhenReplayingAnswer = firstBoolean(
        config.skipQuestionWhenReplayingAnswer,
        config.skip_question_when_replaying_answer,
        invertBoolean(config.replayq),
        DEFAULT_FORM.skipQuestionWhenReplayingAnswer,
    );

    const capAnswerTimeToSecs = firstNumber(
        config.capAnswerTimeToSecs,
        config.cap_answer_time_to_secs,
        config.maxTaken,
        config.max_taken,
        DEFAULT_FORM.capAnswerTimeToSecs,
    );

    const showTimer = firstBoolean(
        config.showTimer,
        config.show_timer,
        numberToBoolean(config.timer),
        DEFAULT_FORM.showTimer,
    );

    const stopTimerOnAnswer = firstBoolean(
        config.stopTimerOnAnswer,
        config.stop_timer_on_answer,
        DEFAULT_FORM.stopTimerOnAnswer,
    );

    const secondsToShowQuestion = firstNumber(
        config.secondsToShowQuestion,
        config.seconds_to_show_question,
        DEFAULT_FORM.secondsToShowQuestion,
    );

    const secondsToShowAnswer = firstNumber(
        config.secondsToShowAnswer,
        config.seconds_to_show_answer,
        DEFAULT_FORM.secondsToShowAnswer,
    );

    const waitForAudio = firstBoolean(
        config.waitForAudio,
        config.wait_for_audio,
        DEFAULT_FORM.waitForAudio,
    );

    const questionAction = normalizeQuestionAction(
        firstKnown(config.questionAction, config.question_action),
    );

    const answerAction = normalizeAnswerAction(
        firstKnown(config.answerAction, config.answer_action),
    );

    const easyDaysPercentages = normalizeEasyDaysPercentages(
        firstKnown(config.easyDaysPercentages, config.easy_days_percentages),
    );

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
        requestRetention: normalizeRequestRetention(firstNumber(config.requestRetention, DEFAULT_FORM.requestRetention)),
        maximumInterval: firstNumber(
            config.maximumInterval,
            getNestedNumber(config.rev, "maxIvl"),
            DEFAULT_FORM.maximumInterval,
        ),
        fsrsWeights: firstNumericArray(config.fsrsWeights, DEFAULT_FORM.fsrsWeights),
        newCardGatherPriority,
        newCardSortOrder,
        newReviewMix,
        interdayLearningMix,
        reviewSortOrder,
        buryNew,
        buryReviews,
        buryInterdayLearning,
        leechAction: normalizeLeechAction(
            firstKnown(config.leechAction, getNestedValue(config.lapse, "leechAction")),
            DEFAULT_FORM.leechAction,
        ),
        disableAutoplay,
        skipQuestionWhenReplayingAnswer,
        capAnswerTimeToSecs,
        showTimer,
        stopTimerOnAnswer,
        secondsToShowQuestion,
        secondsToShowAnswer,
        waitForAudio,
        questionAction,
        answerAction,
        easyDaysPercentages,
        newCardsIgnoreReviewLimit: firstBoolean(
            globalConfig?.newCardsIgnoreReviewLimit,
            globalConfig?.new_cards_ignore_review_limit,
            DEFAULT_FORM.newCardsIgnoreReviewLimit,
        ),
        applyAllParentLimits: firstBoolean(
            globalConfig?.applyAllParentLimits,
            globalConfig?.apply_all_parent_limits,
            DEFAULT_FORM.applyAllParentLimits,
        ),
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

function normalizeNewCardGatherPriority(value: unknown): SchedulerNewCardGatherPriority {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 5:
                return "deck-then-random-notes";
            case 1:
                return "lowest-position";
            case 2:
                return "highest-position";
            case 3:
                return "random-notes";
            case 4:
                return "random-cards";
            default:
                return "deck";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["deck", "new_card_gather_priority_deck"].includes(normalized)) {
            return "deck";
        }
        if (
            [
                "deck-then-random-notes",
                "deck_then_random_notes",
                "new_card_gather_priority_deck_then_random_notes",
            ].includes(normalized)
        ) {
            return "deck-then-random-notes";
        }
        if (
            [
                "lowest-position",
                "lowest_position",
                "new_card_gather_priority_lowest_position",
            ].includes(normalized)
        ) {
            return "lowest-position";
        }
        if (
            [
                "highest-position",
                "highest_position",
                "new_card_gather_priority_highest_position",
            ].includes(normalized)
        ) {
            return "highest-position";
        }
        if (
            [
                "random-notes",
                "random_notes",
                "new_card_gather_priority_random_notes",
            ].includes(normalized)
        ) {
            return "random-notes";
        }
        if (
            [
                "random-cards",
                "random_cards",
                "new_card_gather_priority_random_cards",
            ].includes(normalized)
        ) {
            return "random-cards";
        }
    }

    return "deck";
}

function encodeNewCardGatherPriority(value: SchedulerNewCardGatherPriority): number {
    switch (value) {
        case "deck":
            return 0;
        case "lowest-position":
            return 1;
        case "highest-position":
            return 2;
        case "random-notes":
            return 3;
        case "random-cards":
            return 4;
        case "deck-then-random-notes":
            return 5;
        default:
            return 0;
    }
}

function normalizeNewCardSortOrder(value: unknown): SchedulerNewCardSortOrder {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "no-sort";
            case 2:
                return "template-then-random";
            case 3:
                return "random-note-then-template";
            case 4:
                return "random-card";
            default:
                return "template";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["template", "new_card_sort_order_template"].includes(normalized)) {
            return "template";
        }
        if (["no-sort", "no_sort", "new_card_sort_order_no_sort"].includes(normalized)) {
            return "no-sort";
        }
        if (
            [
                "template-then-random",
                "template_then_random",
                "new_card_sort_order_template_then_random",
            ].includes(normalized)
        ) {
            return "template-then-random";
        }
        if (
            [
                "random-note-then-template",
                "random_note_then_template",
                "new_card_sort_order_random_note_then_template",
            ].includes(normalized)
        ) {
            return "random-note-then-template";
        }
        if (["random-card", "random_card", "new_card_sort_order_random_card"].includes(normalized)) {
            return "random-card";
        }
    }

    return "template";
}

function encodeNewCardSortOrder(value: SchedulerNewCardSortOrder): number {
    switch (value) {
        case "template":
            return 0;
        case "no-sort":
            return 1;
        case "template-then-random":
            return 2;
        case "random-note-then-template":
            return 3;
        case "random-card":
            return 4;
        default:
            return 0;
    }
}

function disabledNewSortOrdersForGather(
    gatherPriority: SchedulerNewCardGatherPriority,
): SchedulerNewCardSortOrder[] {
    if (gatherPriority === "random-notes") {
        return ["template-then-random", "random-note-then-template"];
    }

    if (gatherPriority === "random-cards") {
        return ["template-then-random", "random-note-then-template", "random-card"];
    }

    return [];
}

function coerceNewCardSortOrderForGather(
    sortOrder: SchedulerNewCardSortOrder,
    gatherPriority: SchedulerNewCardGatherPriority,
): SchedulerNewCardSortOrder {
    return disabledNewSortOrdersForGather(gatherPriority).includes(sortOrder)
        ? "template"
        : sortOrder;
}

function normalizeReviewMix(value: unknown): SchedulerReviewMix {
    if (value === "after-reviews" || value === "before-reviews" || value === "mix-with-reviews") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.trunc(value);
        if (normalized === 1) {
            return "after-reviews";
        }
        if (normalized === 2) {
            return "before-reviews";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "after-reviews" || normalized === "after_reviews") {
            return "after-reviews";
        }
        if (normalized === "before-reviews" || normalized === "before_reviews") {
            return "before-reviews";
        }
    }

    return "mix-with-reviews";
}

function encodeReviewMix(value: SchedulerReviewMix): number {
    if (value === "after-reviews") {
        return 1;
    }
    if (value === "before-reviews") {
        return 2;
    }
    return 0;
}

function normalizeReviewSortOrder(value: unknown): SchedulerReviewSortOrder {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "due-then-deck";
            case 2:
                return "deck-then-due";
            case 3:
                return "interval-ascending";
            case 4:
                return "interval-descending";
            case 5:
                return "ease-ascending";
            case 6:
                return "ease-descending";
            case 7:
                return "retrievability-ascending";
            case 11:
                return "retrievability-descending";
            case 12:
                return "relative-overdueness";
            case 8:
                return "random";
            case 9:
                return "added";
            case 10:
                return "reverse-added";
            default:
                return "due";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["due", "day", "review_card_order_day"].includes(normalized)) {
            return "due";
        }
        if (["due-then-deck", "day_then_deck", "review_card_order_day_then_deck"].includes(normalized)) {
            return "due-then-deck";
        }
        if (["deck-then-due", "deck_then_day", "review_card_order_deck_then_day"].includes(normalized)) {
            return "deck-then-due";
        }
        if (["interval-ascending", "intervals_ascending", "review_card_order_intervals_ascending"].includes(normalized)) {
            return "interval-ascending";
        }
        if (["interval-descending", "intervals_descending", "review_card_order_intervals_descending"].includes(normalized)) {
            return "interval-descending";
        }
        if (["ease-ascending", "review_card_order_ease_ascending"].includes(normalized)) {
            return "ease-ascending";
        }
        if (["ease-descending", "review_card_order_ease_descending"].includes(normalized)) {
            return "ease-descending";
        }
        if (["retrievability-ascending", "retrievability_ascending", "review_card_order_retrievability_ascending"].includes(normalized)) {
            return "retrievability-ascending";
        }
        if (["retrievability-descending", "retrievability_descending", "review_card_order_retrievability_descending"].includes(normalized)) {
            return "retrievability-descending";
        }
        if (["relative-overdueness", "relative_overdueness", "review_card_order_relative_overdueness"].includes(normalized)) {
            return "relative-overdueness";
        }
        if (["random", "review_card_order_random"].includes(normalized)) {
            return "random";
        }
        if (["added", "review_card_order_added"].includes(normalized)) {
            return "added";
        }
        if (["reverse-added", "reverse_added", "review_card_order_reverse_added"].includes(normalized)) {
            return "reverse-added";
        }
    }

    return "due";
}

function encodeReviewSortOrder(value: SchedulerReviewSortOrder): number {
    switch (value) {
        case "due-then-deck":
            return 1;
        case "deck-then-due":
            return 2;
        case "interval-ascending":
            return 3;
        case "interval-descending":
            return 4;
        case "ease-ascending":
            return 5;
        case "ease-descending":
            return 6;
        case "retrievability-ascending":
            return 7;
        case "random":
            return 8;
        case "added":
            return 9;
        case "reverse-added":
            return 10;
        case "retrievability-descending":
            return 11;
        case "relative-overdueness":
            return 12;
        default:
            return 0;
    }
}

function normalizeQuestionAction(value: unknown): SchedulerQuestionAction {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value) === 1 ? "show-reminder" : "show-answer";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["show-reminder", "show_reminder", "question_action_show_reminder"].includes(normalized)) {
            return "show-reminder";
        }
    }

    return "show-answer";
}

function encodeQuestionAction(value: SchedulerQuestionAction): number {
    return value === "show-reminder" ? 1 : 0;
}

function normalizeAnswerAction(value: unknown): SchedulerAnswerAction {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "answer-again";
            case 2:
                return "answer-good";
            case 3:
                return "answer-hard";
            case 4:
                return "show-reminder";
            default:
                return "bury-card";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["answer-again", "answer_again", "answer_action_answer_again"].includes(normalized)) {
            return "answer-again";
        }
        if (["answer-good", "answer_good", "answer_action_answer_good"].includes(normalized)) {
            return "answer-good";
        }
        if (["answer-hard", "answer_hard", "answer_action_answer_hard"].includes(normalized)) {
            return "answer-hard";
        }
        if (["show-reminder", "show_reminder", "answer_action_show_reminder"].includes(normalized)) {
            return "show-reminder";
        }
    }

    return "bury-card";
}

function encodeAnswerAction(value: SchedulerAnswerAction): number {
    switch (value) {
        case "answer-again":
            return 1;
        case "answer-good":
            return 2;
        case "answer-hard":
            return 3;
        case "show-reminder":
            return 4;
        default:
            return 0;
    }
}

function normalizeEasyDaysPercentages(value: unknown): number[] {
    const fallback = [...DEFAULT_FORM.easyDaysPercentages];
    if (!Array.isArray(value) || value.length === 0) {
        return fallback;
    }

    return fallback.map((defaultValue, index) => {
        const candidate = value[index];
        if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
            return defaultValue;
        }
        return Math.min(1, Math.max(0, candidate));
    });
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

function firstNumericArray(...values: unknown[]): number[] {
    for (const value of values) {
        if (!Array.isArray(value)) {
            continue;
        }

        const normalized = value
            .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));

        if (normalized.length > 0) {
            return normalized;
        }
    }

    return [];
}

function invertBoolean(value: unknown): boolean | undefined {
    if (typeof value !== "boolean") {
        return undefined;
    }

    return !value;
}

function numberToBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value !== 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "0" || normalized === "false") {
            return false;
        }
        if (normalized === "1" || normalized === "true") {
            return true;
        }
    }

    return undefined;
}

function firstArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function firstKnown(...values: unknown[]): unknown {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return undefined;
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

function getNestedBoolean(value: unknown, key: string): boolean | undefined {
    const candidate = getNestedValue(value, key);
    return typeof candidate === "boolean" ? candidate : undefined;
}

function normalizeLeechAction(value: unknown, fallback: DeckOptionForm["leechAction"]): DeckOptionForm["leechAction"] {
    if (value === "suspend" || value === "tag-only") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value) === 0 ? "suspend" : "tag-only";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "0" || normalized === "suspend") {
            return "suspend";
        }
        if (normalized === "1" || normalized === "tag" || normalized === "tag-only" || normalized === "tag_only") {
            return "tag-only";
        }
    }

    return fallback;
}

function normalizeRequestRetention(value: number): number {
    const clamped = clampNumber(value, DESIRED_RETENTION_MIN, DESIRED_RETENTION_MAX);
    return roundToStep(clamped, DESIRED_RETENTION_STEP);
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

function roundToStep(value: number, step: number): number {
    if (!Number.isFinite(step) || step <= 0) {
        return value;
    }

    const rounded = Math.round(value / step) * step;
    const decimalPart = String(step).split(".")[1];
    const decimals = decimalPart ? decimalPart.length : 0;

    return Number.parseFloat(rounded.toFixed(decimals));
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

function SelectField({
    label,
    value,
    onChange,
    options,
    disabledValues,
}: {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly options: ReadonlyArray<{
        readonly label: string;
        readonly value: string;
    }>;
    readonly disabledValues?: readonly string[];
}) {
    return (
        <label className="space-y-1 text-sm">
            <span className="text-slate-300">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none"
            >
                {options.map((option) => (
                    <option
                        key={option.value}
                        value={option.value}
                        disabled={disabledValues?.includes(option.value) ?? false}
                    >
                        {option.label}
                    </option>
                ))}
            </select>
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
