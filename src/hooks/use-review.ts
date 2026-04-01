"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCollection } from "@/hooks/use-collection";
import { renderCardTemplatesAsync } from "@/lib/rendering/template-renderer";
import { SchedulerAnsweringService } from "@/lib/scheduler/answering";
import { SchedulerEngine } from "@/lib/scheduler/engine";
import { resolveSchedulerConfig } from "@/lib/scheduler/params";
import { SchedulerQueueBuilder } from "@/lib/scheduler/queue";
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
    readonly canUndo: boolean;
    readonly revealAnswer: () => void;
    readonly answer: (rating: ReviewRating) => Promise<void>;
    readonly undo: () => Promise<void>;
    readonly reload: () => Promise<void>;
}

const SOUND_TAG_PATTERN = /\[sound:([^\]]+)\]/g;

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

    const initializeSession = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        startLoading(options.deckId);
        const now = nowProvider();

        try {
            const config = await loadSchedulerConfig(collection.connection, options.deckId);
            const queueBuilder = new SchedulerQueueBuilder(collection.connection);
            const queueResult = await queueBuilder.buildQueue({
                now,
                deckId: options.deckId ?? undefined,
                config,
            });

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
                });

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
            });

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

        void initializeSession();

        return () => {
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

    const preview = engine.previewCard(card, config, now);
    const intervalLabels = buildIntervalLabels(preview, now);

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

function buildIntervalLabels(preview: SchedulerPreview, now: Date): Record<ReviewRating, string> {
    return {
        again: formatTransitionInterval(preview.again, now),
        hard: formatTransitionInterval(preview.hard, now),
        good: formatTransitionInterval(preview.good, now),
        easy: formatTransitionInterval(preview.easy, now),
    };
}

function formatTransitionInterval(
    transition: SchedulerPreview[ReviewRating],
    now: Date,
): string {
    if (
        transition.nextCard.queue === CardQueue.Learning ||
        transition.nextCard.queue === CardQueue.DayLearning
    ) {
        const minutes = Math.max(0, Math.ceil((transition.due.getTime() - now.getTime()) / 60_000));
        if (minutes < 1) {
            return "<1m";
        }
        if (minutes < 60) {
            return `<${minutes}m`;
        }

        const hours = Math.ceil(minutes / 60);
        if (hours < 24) {
            return `<${hours}h`;
        }

        const days = Math.ceil(hours / 24);
        return `<${days}d`;
    }

    if (transition.scheduledDays <= 1) {
        return "<1d";
    }

    if (transition.scheduledDays < 30) {
        return `${transition.scheduledDays}d`;
    }

    if (transition.scheduledDays < 365) {
        return `${Math.round(transition.scheduledDays / 30)}mo`;
    }

    return `${Math.round(transition.scheduledDays / 365)}y`;
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

    const learningSteps = normalizeStepArray(
        firstArray(record.learningSteps, getNestedArray(record.new, "delays")),
    );
    const relearningSteps = normalizeStepArray(
        firstArray(record.relearningSteps, getNestedArray(record.lapse, "delays")),
    );

    const fsrsWeights = normalizeNumericArray(record.fsrsWeights);

    return {
        requestRetention: firstNumber(record.requestRetention, record.desiredRetention),
        maximumInterval: firstNumber(record.maximumInterval, record.maxInterval, getNestedNumber(record.rev, "maxIvl")),
        burySiblings: firstBoolean(record.burySiblings, record.bury),
        leechThreshold: firstNumber(record.leechThreshold, record.leechFails),
        fsrsWeights,
        limits: {
            newPerDay: newPerDay ?? 20,
            reviewsPerDay: reviewsPerDay ?? 200,
            learningPerDay: learningPerDay ?? (reviewsPerDay ?? 200),
        },
        ...(learningSteps ? { learningSteps } : {}),
        ...(relearningSteps ? { relearningSteps } : {}),
    };
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

function getNestedNumber(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function getNestedArray(value: unknown, key: string): unknown[] | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    const candidate = (value as Record<string, unknown>)[key];
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
