"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { renderCardTemplatesAsync } from "@/lib/rendering/template-renderer";
import { SchedulerAnsweringService } from "@/lib/scheduler/answering";
import { SchedulerEngine } from "@/lib/scheduler/engine";
import { resolveSchedulerConfig } from "@/lib/scheduler/params";
import { SchedulerQueueBuilder } from "@/lib/scheduler/queue";
import { fromDayNumber, toDayNumber } from "@/lib/scheduler/states";
import { formatAnkiAnswerButtonInterval } from "@/lib/scheduler/timespan";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository, type CardRecord } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository } from "@/lib/storage/repositories/notetypes";
import { CardQueue, type Card } from "@/lib/types/card";
import { splitFields } from "@/lib/types/note";
import {
    REVIEW_RATINGS,
    type QueueBuildResult,
    type ReviewRating,
    type SchedulerConfig,
    type SchedulerPreview,
    type SchedulerReviewMix,
} from "@/lib/types/scheduler";
import { useReviewStore, type ActiveReviewCard } from "@/stores/review-store";

export interface UseReviewOptions {
    readonly deckId: number | null;
    readonly nowProvider?: () => Date;
}

export interface UseReviewResult {
    readonly ready: boolean;
    readonly loading: boolean;
    readonly error: string | null;
    readonly stage: "idle" | "loading" | "question" | "answer" | "completed" | "error";
    readonly hasCard: boolean;
    readonly currentCard: ActiveReviewCard | null;
    readonly answered: number;
    readonly remaining: number;
    readonly total: number;
    readonly counts: {
        readonly learning: number;
        readonly review: number;
        readonly new: number;
    };
    readonly dueLaterToday: number;
    readonly nextCardDueInMinutes: number | null;
    readonly canUndo: boolean;
    readonly revealAnswer: () => void;
    readonly answer: (rating: ReviewRating) => Promise<void>;
    readonly undo: () => Promise<void>;
    readonly reload: () => Promise<void>;
}

interface ReviewCompletionState {
    readonly dueLaterToday: number;
    readonly nextCardDueInMinutes: number | null;
}

interface ReviewCompletionRow {
    readonly dueLaterToday: number;
    readonly nextDueAtMs: number | null;
}

const EMPTY_REVIEW_COMPLETION_STATE: ReviewCompletionState = {
    dueLaterToday: 0,
    nextCardDueInMinutes: null,
};

const SOUND_TAG_PATTERN = /\[sound:([^\]]+)\]/g;
const REVIEW_NEW_SCOPE_STORAGE_PREFIX = "nextjs-anki:review:new-scope:v1";

type NotetypeFieldShape = {
    readonly name?: unknown;
    readonly ord?: unknown;
};

type NotetypeTemplateShape = {
    readonly name?: unknown;
    readonly ord?: unknown;
    readonly qfmt?: unknown;
    readonly afmt?: unknown;
};

export function useReview(options: UseReviewOptions): UseReviewResult {
    const nowProvider = useMemo(() => options.nowProvider ?? (() => new Date()), [options.nowProvider]);
    const engineRef = useRef(new SchedulerEngine());
    const shownAtMsRef = useRef<number>(0);
    const sessionNewCardIdsRef = useRef<Set<number> | null>(null);
    const sessionScopeKeyRef = useRef<string | null>(null);

    const collection = useCollection();

    const stage = useReviewStore((state) => state.stage);
    const currentCard = useReviewStore((state) => state.currentCard);
    const queue = useReviewStore((state) => state.queue);
    const counts = useReviewStore((state) => state.counts);
    const answered = useReviewStore((state) => state.answered);
    const history = useReviewStore((state) => state.history);
    const reviewError = useReviewStore((state) => state.error);

    const startLoading = useReviewStore((state) => state.startLoading);
    const startSession = useReviewStore((state) => state.startSession);
    const revealAnswer = useReviewStore((state) => state.revealAnswer);
    const recordAnswer = useReviewStore((state) => state.recordAnswer);
    const applyUndo = useReviewStore((state) => state.applyUndo);
    const setError = useReviewStore((state) => state.setError);
    const reset = useReviewStore((state) => state.reset);
    const [completionState, setCompletionState] = useState<ReviewCompletionState>(EMPTY_REVIEW_COMPLETION_STATE);

    const initializeSession = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        startLoading(options.deckId);
        setCompletionState(EMPTY_REVIEW_COMPLETION_STATE);
        const now = nowProvider();
        const scopeKey = buildReviewScopeKey(options.deckId, toDayNumber(now));

        if (sessionScopeKeyRef.current !== scopeKey) {
            sessionScopeKeyRef.current = scopeKey;
            sessionNewCardIdsRef.current = loadScopedNewCardIds(scopeKey);
        }

        try {
            const config = await loadSchedulerConfig(collection.connection, options.deckId);
            const queueBuilder = new SchedulerQueueBuilder(collection.connection);
            const queueResult = await queueBuilder.buildQueue({
                now,
                deckId: options.deckId ?? undefined,
                config,
                allowedNewCardIds: sessionNewCardIdsRef.current ?? undefined,
            });
            const latestCompletion = await loadReviewCompletionState(collection.connection, options.deckId, now);

            if (sessionNewCardIdsRef.current === null) {
                const scopedNewIds = new Set(
                    queueResult.cards
                        .filter((card) => card.queue === CardQueue.New)
                        .map((card) => card.id),
                );

                if (scopedNewIds.size > 0) {
                    sessionNewCardIdsRef.current = scopedNewIds;
                    persistScopedNewCardIds(scopeKey, scopedNewIds);
                } else {
                    clearScopedNewCardIds(scopeKey);
                }
            }

            const nextCard = await buildActiveReviewCard(
                collection.connection,
                queueResult.cards[0],
                config,
                now,
                engineRef.current,
            );

            startSession({
                deckId: options.deckId,
                config,
                queueResult,
                currentCard: nextCard,
            });
            setCompletionState(latestCompletion);

            shownAtMsRef.current = now.getTime();
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to start review session.";
            setError(message);
        }
    }, [collection.connection, collection.ready, nowProvider, options.deckId, setError, startLoading, startSession]);

    const answer = useCallback(
        async (rating: ReviewRating) => {
            const connection = collection.connection;
            if (!connection) {
                return;
            }

            const state = useReviewStore.getState();
            if (!state.currentCard || state.stage !== "answer") {
                return;
            }

            const now = nowProvider();
            const answerMillis = Math.max(0, now.getTime() - shownAtMsRef.current);

            try {
                const current = state.currentCard.card;
                const cards = new CardsRepository(connection);
                const siblingCards = (await cards.listByNoteId(current.nid))
                    .filter((card) => card.id !== current.id)
                    .map(toCard);

                const service = new SchedulerAnsweringService(connection, engineRef.current);
                const result = await service.answerCard({
                    card: current,
                    rating,
                    config: state.config,
                    now,
                    answerMillis,
                });

                const queueBuilder = new SchedulerQueueBuilder(connection);
                const queueResult = await queueBuilder.buildQueue({
                    now,
                    deckId: state.deckId ?? undefined,
                    config: state.config,
                    allowedNewCardIds: sessionNewCardIdsRef.current ?? undefined,
                });
                const latestCompletion = await loadReviewCompletionState(connection, state.deckId, now);

                const nextCard = await buildActiveReviewCard(
                    connection,
                    queueResult.cards[0],
                    state.config,
                    now,
                    engineRef.current,
                );

                const siblingSnapshot = siblingCards.filter((card) => result.buriedSiblingCardIds.includes(card.id));

                recordAnswer({
                    queueResult,
                    nextCard,
                    undoEntry: {
                        revlogId: result.revlog.id,
                        previousCard: result.previousCard,
                        previousSiblingCards: siblingSnapshot,
                        rating,
                        answeredAt: now.getTime(),
                    },
                });
                setCompletionState(latestCompletion);

                shownAtMsRef.current = now.getTime();
            } catch (cause) {
                const message = cause instanceof Error ? cause.message : "Failed to answer card.";
                setError(message);
            }
        },
        [collection.connection, nowProvider, recordAnswer, setError],
    );

    const undo = useCallback(async () => {
        const connection = collection.connection;
        if (!connection) {
            return;
        }

        const state = useReviewStore.getState();
        const entry = state.history[state.history.length - 1];
        if (!entry) {
            return;
        }

        try {
            await restoreCardStatesForUndo(connection, entry);

            const now = nowProvider();
            const queueBuilder = new SchedulerQueueBuilder(connection);
            const queueResult = await queueBuilder.buildQueue({
                now,
                deckId: state.deckId ?? undefined,
                config: state.config,
                allowedNewCardIds: sessionNewCardIdsRef.current ?? undefined,
            });
            const latestCompletion = await loadReviewCompletionState(connection, state.deckId, now);

            const restoredCurrent = await buildActiveReviewCard(
                connection,
                queueResult.cards[0],
                state.config,
                now,
                engineRef.current,
            );

            applyUndo({
                queueResult,
                currentCard: restoredCurrent,
            });
            setCompletionState(latestCompletion);

            shownAtMsRef.current = now.getTime();
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to undo last answer.";
            setError(message);
        }
    }, [applyUndo, collection.connection, nowProvider, setError]);

    useEffect(() => {
        if (collection.error) {
            setError(collection.error);
        }
    }, [collection.error, setError]);

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }

        let disposed = false;

        queueMicrotask(() => {
            if (disposed) {
                return;
            }

            void initializeSession();
        });

        return () => {
            disposed = true;
            reset();
        };
    }, [collection.connection, collection.ready, initializeSession, reset]);

    useEffect(() => {
        if (!currentCard || stage !== "question") {
            return;
        }

        shownAtMsRef.current = nowProvider().getTime();
    }, [currentCard, stage, nowProvider]);

    return useMemo(
        () => ({
            ready: collection.ready,
            loading: collection.loading || stage === "loading",
            error: reviewError ?? collection.error,
            stage,
            hasCard: Boolean(currentCard),
            currentCard,
            answered,
            remaining: queue.length,
            total: answered + queue.length,
            counts,
            dueLaterToday: completionState.dueLaterToday,
            nextCardDueInMinutes: completionState.nextCardDueInMinutes,
            canUndo: history.length > 0,
            revealAnswer,
            answer,
            undo,
            reload: initializeSession,
        }),
        [
            answer,
            answered,
            collection.error,
            collection.loading,
            collection.ready,
            counts,
            completionState.dueLaterToday,
            completionState.nextCardDueInMinutes,
            currentCard,
            history.length,
            initializeSession,
            queue.length,
            revealAnswer,
            reviewError,
            stage,
            undo,
        ],
    );
}

async function loadReviewCompletionState(
    connection: CollectionDatabaseConnection,
    deckId: number | null,
    now: Date,
): Promise<ReviewCompletionState> {
    const nowMs = now.getTime();
    const nextDayStartMs = fromDayNumber(toDayNumber(now) + 1).getTime();

    const row = deckId === null
        ? await connection.get<ReviewCompletionRow>(
            `
            SELECT
                COUNT(*) AS dueLaterToday,
                MIN(due) AS nextDueAtMs
            FROM cards
            WHERE queue = ?
              AND due > ?
              AND due < ?
            `,
            [CardQueue.Learning, nowMs, nextDayStartMs],
        )
        : await connection.get<ReviewCompletionRow>(
            `
            SELECT
                COUNT(*) AS dueLaterToday,
                MIN(due) AS nextDueAtMs
            FROM cards
            WHERE queue = ?
              AND did = ?
              AND due > ?
              AND due < ?
            `,
            [CardQueue.Learning, deckId, nowMs, nextDayStartMs],
        );

    const dueLaterToday = Math.max(0, Math.trunc(firstNumber(row?.dueLaterToday) ?? 0));
    const nextDueAtMs = firstNumber(row?.nextDueAtMs);

    if (dueLaterToday <= 0 || nextDueAtMs === undefined) {
        return EMPTY_REVIEW_COMPLETION_STATE;
    }

    const nextCardDueInMinutes = Math.max(1, Math.ceil(Math.max(0, nextDueAtMs - nowMs) / 60_000));

    return {
        dueLaterToday,
        nextCardDueInMinutes,
    };
}

async function loadSchedulerConfig(
    connection: CollectionDatabaseConnection,
    deckId: number | null,
): Promise<SchedulerConfig> {
    const decks = new DecksRepository(connection);
    const config = new ConfigRepository(connection);

    const global = await config.getGlobalConfig();
    const deck = deckId === null ? null : await decks.getById(deckId);
    const deckConfig = deck?.conf !== undefined ? await config.getDeckConfig(deck.conf) : null;

    return resolveSchedulerConfig({
        ...schedulerOverridesFromUnknown(global),
        ...schedulerOverridesFromUnknown(deckConfig),
    });
}

async function buildActiveReviewCard(
    connection: CollectionDatabaseConnection,
    card: Card | undefined,
    config: SchedulerConfig,
    now: Date,
    engine: SchedulerEngine,
): Promise<ActiveReviewCard | null> {
    if (!card) {
        return null;
    }

    const notes = new NotesRepository(connection);
    const notetypes = new NotetypesRepository(connection);

    const note = await notes.getById(card.nid);
    const model = note ? await notetypes.getById(note.mid) : null;

    const fieldValues = splitFields(note?.flds ?? "");
    const fieldNames = extractNotetypeFieldNames(model?.flds);
    const fields = buildFieldMap(fieldNames, fieldValues);

    const template = resolveTemplate(model?.tmpls, card.ord);
    const questionTemplate = template?.qfmt ?? "{{Front}}";
    const answerTemplate = template?.afmt ?? "{{FrontSide}}<hr id='answer'>{{Back}}";

    const rendered = await renderCardTemplatesAsync({
        questionTemplate,
        answerTemplate,
        fields,
        clozeOrdinal: card.ord + 1,
        sanitize: true,
        preserveComments: true,
        renderMath: true,
    });

    const preview = await engine.previewCard(card, config, now);
    const intervalLabels = buildIntervalLabels(preview, now, config);

    return {
        card,
        questionHtml: rendered.question.html,
        answerHtml: rendered.answer.html,
        css: typeof model?.css === "string" ? model.css : "",
        templateName: template?.name ?? `Card ${card.ord + 1}`,
        preview,
        intervalLabels,
        audioTags: {
            question: extractSoundTags(rendered.question.html),
            answer: extractSoundTags(rendered.answer.html),
        },
    };
}

async function restoreCardStatesForUndo(
    connection: CollectionDatabaseConnection,
    entry: {
        readonly revlogId: number;
        readonly previousCard: Card;
        readonly previousSiblingCards: readonly Card[];
    },
): Promise<void> {
    await connection.transaction(async (tx) => {
        const cards = new CardsRepository(tx);

        await cards.update(entry.previousCard.id, toPatch(entry.previousCard));

        for (const sibling of entry.previousSiblingCards) {
            await cards.update(sibling.id, toPatch(sibling));
        }

        await tx.run("DELETE FROM revlog WHERE id = ?", [entry.revlogId]);
    });
}

function buildIntervalLabels(
    preview: SchedulerPreview,
    now: Date,
    config: SchedulerConfig,
): Record<ReviewRating, string> {
    return {
        again: formatTransitionInterval(preview.again, now, config),
        hard: formatTransitionInterval(preview.hard, now, config),
        good: formatTransitionInterval(preview.good, now, config),
        easy: formatTransitionInterval(preview.easy, now, config),
    };
}

function formatTransitionInterval(
    transition: SchedulerPreview[ReviewRating],
    now: Date,
    config: SchedulerConfig,
): string {
    const seconds =
        transition.nextCard.queue === CardQueue.Learning ||
            transition.nextCard.queue === CardQueue.DayLearning
            ? (transition.due.getTime() - now.getTime()) / 1000
            : transition.scheduledDays * 24 * 60 * 60;

    return formatAnkiAnswerButtonInterval(seconds, config.learnAheadSeconds);
}

function extractNotetypeFieldNames(rawFields: unknown[] | undefined): string[] {
    if (!Array.isArray(rawFields)) {
        return [];
    }

    return rawFields
        .map((item, index) => {
            if (!item || typeof item !== "object") {
                return {
                    ord: index,
                    name: `Field ${index + 1}`,
                };
            }

            const typed = item as NotetypeFieldShape;
            return {
                ord: typeof typed.ord === "number" ? typed.ord : index,
                name: typeof typed.name === "string" && typed.name.trim().length > 0
                    ? typed.name
                    : `Field ${index + 1}`,
            };
        })
        .sort((left, right) => left.ord - right.ord)
        .map((field) => field.name);
}

function buildFieldMap(fieldNames: readonly string[], fieldValues: readonly string[]): Record<string, string> {
    const map: Record<string, string> = {};

    for (let index = 0; index < fieldValues.length; index += 1) {
        const name = fieldNames[index] ?? `Field ${index + 1}`;
        map[name] = fieldValues[index] ?? "";
    }

    return map;
}

function resolveTemplate(
    rawTemplates: unknown[] | undefined,
    cardOrd: number,
): {
    readonly name: string;
    readonly qfmt: string;
    readonly afmt: string;
} | null {
    if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
        return null;
    }

    const normalized = rawTemplates
        .map((template, index) => normalizeTemplate(template, index))
        .filter((template): template is NonNullable<typeof template> => template !== null)
        .sort((left, right) => left.ord - right.ord);

    if (normalized.length === 0) {
        return null;
    }

    const byOrd = normalized.find((template) => template.ord === cardOrd);
    const selected = byOrd ?? normalized[Math.min(cardOrd, normalized.length - 1)] ?? normalized[0];

    return {
        name: selected.name,
        qfmt: selected.qfmt,
        afmt: selected.afmt,
    };
}

function normalizeTemplate(template: unknown, fallbackOrd: number): {
    readonly name: string;
    readonly ord: number;
    readonly qfmt: string;
    readonly afmt: string;
} | null {
    if (!template || typeof template !== "object") {
        return null;
    }

    const typed = template as NotetypeTemplateShape;
    if (typeof typed.qfmt !== "string" || typeof typed.afmt !== "string") {
        return null;
    }

    return {
        name: typeof typed.name === "string" && typed.name.trim().length > 0
            ? typed.name
            : `Card ${fallbackOrd + 1}`,
        ord: typeof typed.ord === "number" ? typed.ord : fallbackOrd,
        qfmt: typed.qfmt,
        afmt: typed.afmt,
    };
}

function schedulerOverridesFromUnknown(config: unknown): Partial<SchedulerConfig> {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        return {};
    }

    const record = config as Record<string, unknown>;

    const newPerDay = firstNumber(
        record.newPerDay,
        record.new_per_day,
        getNestedNumber(record.new, "perDay"),
    );
    const reviewsPerDay = firstNumber(
        record.reviewsPerDay,
        record.reviews_per_day,
        getNestedNumber(record.rev, "perDay"),
    );
    const learningPerDay = firstNumber(
        record.learningPerDay,
        record.learning_per_day,
        getNestedNumber(record.new, "perDay"),
    );

    const learnAheadSeconds = firstNumber(
        record.learnAheadSeconds,
        record.learn_ahead_secs,
        record.learnAheadSecs,
        record.collapseTime,
    );

    const newReviewMix = normalizeReviewMix(
        firstKnown(
            record.newReviewMix,
            record.new_review_mix,
            record.newMix,
            record.new_mix,
            record.newSpread,
            record.new_spread,
        ),
    );

    const interdayLearningMix = normalizeReviewMix(
        firstKnown(
            record.interdayLearningMix,
            record.interday_learning_mix,
            record.dayLearnMix,
            record.day_learn_mix,
        ),
    );

    const learningSteps = normalizeStepArray(
        firstArray(record.learningSteps, getNestedArray(record.new, "delays")),
    );
    const relearningSteps = normalizeStepArray(
        firstArray(record.relearningSteps, getNestedArray(record.lapse, "delays")),
    );

    const fsrsWeights = normalizeNumericArray(record.fsrsWeights);

    const bury = resolveBuryOptions(record);
    const leechAction = normalizeLeechAction(
        firstKnown(record.leechAction, getNestedValue(record.lapse, "leechAction")),
    );
    const newCardsIgnoreReviewLimit = firstBoolean(
        record.newCardsIgnoreReviewLimit,
        record.new_cards_ignore_review_limit,
    );
    const applyAllParentLimits = firstBoolean(
        record.applyAllParentLimits,
        record.apply_all_parent_limits,
    );

    return {
        requestRetention: firstNumber(record.requestRetention, record.desiredRetention),
        maximumInterval: firstNumber(record.maximumInterval, record.maxInterval, getNestedNumber(record.rev, "maxIvl")),
        ...(leechAction !== undefined ? { leechAction } : {}),
        ...(bury.burySiblings !== undefined ? { burySiblings: bury.burySiblings } : {}),
        ...(bury.buryNew !== undefined ? { buryNew: bury.buryNew } : {}),
        ...(bury.buryReviews !== undefined ? { buryReviews: bury.buryReviews } : {}),
        ...(bury.buryInterdayLearning !== undefined ? { buryInterdayLearning: bury.buryInterdayLearning } : {}),
        ...(newCardsIgnoreReviewLimit !== undefined ? { newCardsIgnoreReviewLimit } : {}),
        ...(applyAllParentLimits !== undefined ? { applyAllParentLimits } : {}),
        leechThreshold: firstNumber(record.leechThreshold, record.leechFails),
        fsrsWeights,
        limits: {
            newPerDay: newPerDay ?? 20,
            reviewsPerDay: reviewsPerDay ?? 200,
            learningPerDay: learningPerDay ?? (reviewsPerDay ?? 200),
        },
        ...(learnAheadSeconds !== undefined ? { learnAheadSeconds } : {}),
        ...(newReviewMix !== undefined ? { newReviewMix } : {}),
        ...(interdayLearningMix !== undefined ? { interdayLearningMix } : {}),
        ...(learningSteps ? { learningSteps } : {}),
        ...(relearningSteps ? { relearningSteps } : {}),
    };
}

function resolveBuryOptions(record: Record<string, unknown>): {
    readonly burySiblings?: boolean;
    readonly buryNew?: boolean;
    readonly buryReviews?: boolean;
    readonly buryInterdayLearning?: boolean;
} {
    const explicit = firstBoolean(record.burySiblings, record.bury);
    const buryNew = firstBoolean(record.buryNew, getNestedBoolean(record.new, "bury"), explicit);
    const buryReviews = firstBoolean(record.buryReviews, getNestedBoolean(record.rev, "bury"), explicit);
    const buryInterdayLearning = firstBoolean(
        record.buryInterdayLearning,
        record.bury_interday_learning,
        explicit,
    );

    const inferredBurySiblings =
        explicit ??
        ([buryNew, buryReviews, buryInterdayLearning].some((value) => value === true)
            ? true
            : [buryNew, buryReviews, buryInterdayLearning].some((value) => value === false)
                ? false
                : undefined);

    return {
        burySiblings: inferredBurySiblings,
        buryNew,
        buryReviews,
        buryInterdayLearning,
    };
}

function normalizeLeechAction(value: unknown): SchedulerConfig["leechAction"] | undefined {
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

    return undefined;
}

function normalizeReviewMix(value: unknown): SchedulerReviewMix | undefined {
    if (value === "mix-with-reviews" || value === "after-reviews" || value === "before-reviews") {
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
        return "mix-with-reviews";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (
            normalized === "mix" ||
            normalized === "distribute" ||
            normalized === "mix_with_reviews" ||
            normalized === "mixwithreviews"
        ) {
            return "mix-with-reviews";
        }
        if (
            normalized === "afterreviews" ||
            normalized === "reviewsfirst" ||
            normalized === "reviews_first"
        ) {
            return "after-reviews";
        }
        if (
            normalized === "beforereviews" ||
            normalized === "newfirst" ||
            normalized === "new_first"
        ) {
            return "before-reviews";
        }
    }

    return undefined;
}

function normalizeStepArray(raw: unknown[] | undefined): string[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const steps = raw
        .map((value) => {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                return `${Math.max(1, Math.trunc(value))}m`;
            }
            if (typeof value === "string" && value.trim().length > 0) {
                const normalized = value.trim().toLowerCase();
                if (/^\d+(m|h|d)$/.test(normalized)) {
                    return normalized;
                }
                if (/^\d+$/.test(normalized)) {
                    return `${normalized}m`;
                }
            }
            return null;
        })
        .filter((value): value is string => value !== null);

    return steps.length > 0 ? steps : undefined;
}

function normalizeNumericArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const numeric = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
    return numeric.length > 0 ? numeric : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return undefined;
}

function firstArray(...values: unknown[]): unknown[] | undefined {
    for (const value of values) {
        if (Array.isArray(value)) {
            return value;
        }
    }
    return undefined;
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

function getNestedArray(value: unknown, key: string): unknown[] | undefined {
    const candidate = getNestedValue(value, key);
    return Array.isArray(candidate) ? candidate : undefined;
}

function toPatch(card: Card): Omit<Card, "id"> {
    return {
        nid: card.nid,
        did: card.did,
        ord: card.ord,
        mod: card.mod,
        usn: card.usn,
        type: card.type,
        queue: card.queue,
        due: card.due,
        ivl: card.ivl,
        factor: card.factor,
        reps: card.reps,
        lapses: card.lapses,
        left: card.left,
        odue: card.odue,
        odid: card.odid,
        flags: card.flags,
        data: card.data,
    };
}

function toCard(record: CardRecord): Card {
    return {
        id: record.id,
        nid: record.nid,
        did: record.did,
        ord: record.ord,
        mod: record.mod,
        usn: record.usn,
        type: record.type,
        queue: record.queue,
        due: record.due,
        ivl: record.ivl,
        factor: record.factor,
        reps: record.reps,
        lapses: record.lapses,
        left: record.left,
        odue: record.odue,
        odid: record.odid,
        flags: record.flags,
        data: record.data,
    };
}

function extractSoundTags(html: string): string[] {
    const tags: string[] = [];
    for (const match of html.matchAll(SOUND_TAG_PATTERN)) {
        const source = match[1]?.trim();
        if (!source) {
            continue;
        }
        tags.push(source);
    }
    return tags;
}

function buildReviewScopeKey(deckId: number | null, today: number): string {
    return `${deckId === null ? "all" : deckId}:${today}`;
}

function scopedNewCardsStorageKey(scopeKey: string): string {
    return `${REVIEW_NEW_SCOPE_STORAGE_PREFIX}:${scopeKey}`;
}

function loadScopedNewCardIds(scopeKey: string): Set<number> | null {
    if (typeof window === "undefined") {
        return null;
    }

    const storageKey = scopedNewCardsStorageKey(scopeKey);
    const raw = window.localStorage.getItem(storageKey);

    if (raw === null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            window.localStorage.removeItem(storageKey);
            return null;
        }

        const ids = parsed
            .map((value) => {
                if (typeof value !== "number" || !Number.isFinite(value)) {
                    return null;
                }

                const id = Math.trunc(value);
                return id > 0 ? id : null;
            })
            .filter((value): value is number => value !== null);

        return new Set(ids);
    } catch {
        window.localStorage.removeItem(storageKey);
        return null;
    }
}

function persistScopedNewCardIds(scopeKey: string, ids: ReadonlySet<number>): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(scopedNewCardsStorageKey(scopeKey), JSON.stringify([...ids]));
    } catch {
        // Ignore quota/privacy errors and keep session-local behavior.
    }
}

function clearScopedNewCardIds(scopeKey: string): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.removeItem(scopedNewCardsStorageKey(scopeKey));
    } catch {
        // Ignore quota/privacy errors and keep session-local behavior.
    }
}

export const __reviewNewScope = {
    buildReviewScopeKey,
    scopedNewCardsStorageKey,
    loadScopedNewCardIds,
    persistScopedNewCardIds,
    clearScopedNewCardIds,
};

export const __reviewCompletion = {
    loadReviewCompletionState,
};

export function ratingShortcutToValue(shortcut: string): ReviewRating | null {
    if (shortcut === "1") {
        return REVIEW_RATINGS[0];
    }
    if (shortcut === "2") {
        return REVIEW_RATINGS[1];
    }
    if (shortcut === "3") {
        return REVIEW_RATINGS[2];
    }
    if (shortcut === "4") {
        return REVIEW_RATINGS[3];
    }
    return null;
}

export function hasQueueCards(queueResult: QueueBuildResult): boolean {
    return queueResult.cards.length > 0;
}
