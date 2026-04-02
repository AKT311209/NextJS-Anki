import { computeNextFsrsStates, createFsrsScheduler, type FsrsStateSnapshot } from "@/lib/scheduler/fsrs-browser";
import { CardQueue, CardType, type Card, type FsrsMemoryState } from "@/lib/types/card";
import { RevlogReviewKind } from "@/lib/types/revlog";
import {
    type AnswerCardInput,
    type AnswerCardResult,
    type ReviewRating,
    type SchedulerConfig,
    type SchedulerPreview,
    type SchedulerTransition,
} from "@/lib/types/scheduler";
import { fuzzInterval } from "@/lib/scheduler/fuzz";
import { buildFsrsParameters, firstStepMinutes, resolveSchedulerConfig } from "@/lib/scheduler/params";
import {
    elapsedSchedulerDays,
    extractFsrsMemory,
    type FsrsCardState,
    mapFsrsStateToCardType,
    mapReviewRatingToGrade,
    mergeCardData,
    queueForState,
    readCardData,
    toDayNumber,
} from "@/lib/scheduler/states";

const DAY_MS = 24 * 60 * 60 * 1000;

export class SchedulerEngine {
    private readonly baseConfig: SchedulerConfig;

    public constructor(config: Partial<SchedulerConfig> = {}) {
        this.baseConfig = resolveSchedulerConfig(config);
    }

    public previewCard(
        card: Card,
        overrides: Partial<SchedulerConfig> = {},
        now: Date = overrides.now ?? new Date(),
    ): SchedulerPreview {
        const config = this.resolveConfig(overrides, now);
        if (shouldUseSm2Fallback(card, config)) {
            return this.previewWithSm2(card, config, now);
        }
        return this.previewWithFsrs(card, config, now);
    }

    public answerCard(input: AnswerCardInput): AnswerCardResult {
        const config = this.resolveConfig(input.config, input.now);
        const preview = this.previewCard(input.card, config, input.now);
        const selectedTransition = preview[input.rating];
        const leechDetected = selectedTransition.nextCard.lapses >= config.leechThreshold;

        let nextCard = selectedTransition.nextCard;
        if (leechDetected) {
            nextCard = {
                ...nextCard,
                queue: config.leechAction === "suspend" ? CardQueue.Suspended : nextCard.queue,
                flags: nextCard.flags | 0x80,
                data: mergeCardData(nextCard, { leech: true }),
            };
        }

        return {
            previousCard: input.card,
            nextCard,
            rating: input.rating,
            due: selectedTransition.due,
            scheduledDays: selectedTransition.scheduledDays,
            fsrs: selectedTransition.fsrs,
            revlog: {
                id: buildRevlogId(input.now, input.card.id, input.rating),
                cid: input.card.id,
                usn: input.card.usn,
                ease: ratingToEase(input.rating),
                ivl: nextCard.ivl,
                lastIvl: input.card.ivl,
                factor: nextCard.factor,
                time: Math.max(0, Math.trunc(input.answerMillis)),
                type: selectedTransition.reviewKind,
            },
            leechDetected,
        };
    }

    private previewWithFsrs(card: Card, config: SchedulerConfig, now: Date): SchedulerPreview {
        const fsrsParameters = buildFsrsParameters(config);
        const scheduler = createFsrsScheduler(fsrsParameters.weights);
        const input = resolveFsrsInput(card, now);

        try {
            const preview = computeNextFsrsStates(scheduler, {
                desiredRetention: fsrsParameters.requestRetention,
                daysElapsed: input.daysElapsed,
                stability: input.stability,
                difficulty: input.difficulty,
            });

            const again = this.buildTransitionFromFsrs(card, preview.again, "again", config, now, input.daysElapsed);
            const hard = this.buildTransitionFromFsrs(card, preview.hard, "hard", config, now, input.daysElapsed);
            const good = this.buildTransitionFromFsrs(card, preview.good, "good", config, now, input.daysElapsed);
            const easy = this.buildTransitionFromFsrs(card, preview.easy, "easy", config, now, input.daysElapsed);

            return { again, hard, good, easy };
        } finally {
            scheduler.free();
        }
    }

    private buildTransitionFromFsrs(
        previousCard: Card,
        item: FsrsStateSnapshot,
        rating: ReviewRating,
        config: SchedulerConfig,
        now: Date,
        elapsedDays: number,
    ): SchedulerTransition {
        const intervalDays = Math.max(0, item.intervalDays);
        let scheduledDays = Math.max(0, Math.trunc(intervalDays));
        let due = new Date(now.getTime() + intervalDays * DAY_MS);

        const nextState = inferNextFsrsState(previousCard, rating, intervalDays);
        const nextType = mapFsrsStateToCardType(nextState);
        let nextQueue = queueForState(nextState, intervalDays);

        const useStepDelay = rating === "again" && (nextType === CardType.Learning || nextType === CardType.Relearning);

        if (useStepDelay) {
            const relearning = nextType === CardType.Relearning;
            const minutes = firstStepMinutes(config, relearning);
            due = new Date(now.getTime() + minutes * 60 * 1000);
            scheduledDays = Math.max(0, Math.floor(minutes / (60 * 24)));

            if (minutes >= 24 * 60) {
                nextQueue = CardQueue.DayLearning;
            } else {
                nextQueue = CardQueue.Learning;
            }
        }

        // Enforce minimum interval for cards graduating to Review.
        // FSRS can return scheduled_days < 1 (e.g. 0.3),
        // causing ivl=0 Review cards that never escape and appear immediately
        // due each queue rebuild.
        if (nextQueue === CardQueue.Review && scheduledDays < 1) {
            scheduledDays = Math.max(config.minimumInterval, config.graduatingInterval);
            due = new Date(now.getTime() + scheduledDays * DAY_MS);
        }

        if (nextQueue === CardQueue.DayLearning && scheduledDays < 1) {
            scheduledDays = 1;
        }

        if (config.enableFuzz && scheduledDays > 1 && nextQueue === CardQueue.Review) {
            scheduledDays = fuzzInterval(scheduledDays, {
                cardId: previousCard.id,
                now,
                maximumInterval: config.maximumInterval,
            });
            due = new Date(now.getTime() + scheduledDays * DAY_MS);
            nextQueue = CardQueue.Review;
        }

        const fsrsMemory: FsrsMemoryState = {
            stability: item.stability,
            difficulty: item.difficulty,
            lastReview: now.getTime(),
            elapsedDays,
            scheduledDays,
        };

        const reps = previousCard.reps + 1;
        const lapses = previousCard.lapses + (rating === "again" && isLapseCandidate(previousCard.type) ? 1 : 0);

        const learningLeft = nextQueue === CardQueue.Learning || nextQueue === CardQueue.DayLearning
            ? Math.max(1, previousCard.left || 1)
            : 0;

        const nextCard: Card = {
            ...previousCard,
            mod: now.getTime(),
            type: nextType,
            queue: nextQueue,
            due: nextQueue === CardQueue.Learning ? due.getTime() : toDayNumber(due),
            ivl: scheduledDays,
            factor: difficultyToEase(item.difficulty, previousCard.factor),
            reps,
            lapses,
            left: learningLeft,
            data: mergeCardData(previousCard, {
                scheduler: "fsrs",
                fsrs: fsrsMemory,
            }),
        };

        return {
            rating,
            nextCard,
            due,
            scheduledDays,
            fsrs: fsrsMemory,
            reviewKind: inferRevlogType(previousCard.type, nextType),
        };
    }

    private previewWithSm2(card: Card, config: SchedulerConfig, now: Date): SchedulerPreview {
        return {
            again: this.buildTransitionWithSm2(card, "again", config, now),
            hard: this.buildTransitionWithSm2(card, "hard", config, now),
            good: this.buildTransitionWithSm2(card, "good", config, now),
            easy: this.buildTransitionWithSm2(card, "easy", config, now),
        };
    }

    private buildTransitionWithSm2(
        previousCard: Card,
        rating: ReviewRating,
        config: SchedulerConfig,
        now: Date,
    ): SchedulerTransition {
        const previousInterval = Math.max(0, previousCard.ivl);
        let easeFactor = Math.max(1300, previousCard.factor || config.startingEase);
        const reps = previousCard.reps + 1;
        let lapses = previousCard.lapses;
        let scheduledDays = 0;
        let due = now;
        let nextType: CardType = previousCard.type === CardType.New ? CardType.Learning : previousCard.type;
        let nextQueue: CardQueue = CardQueue.Learning;

        if (rating === "again") {
            lapses += 1;
            easeFactor = Math.max(1300, easeFactor - 200);
            const relearning = previousCard.type === CardType.Review || previousCard.type === CardType.Relearning;
            const minutes = firstStepMinutes(config, relearning);
            scheduledDays = Math.max(0, Math.floor(minutes / (60 * 24)));
            due = new Date(now.getTime() + minutes * 60 * 1000);
            nextType = relearning ? CardType.Relearning : CardType.Learning;
            nextQueue = minutes >= 24 * 60 ? CardQueue.DayLearning : CardQueue.Learning;
        } else {
            if (rating === "hard") {
                easeFactor = Math.max(1300, easeFactor - 150);
            }
            if (rating === "easy") {
                easeFactor = Math.min(3000, easeFactor + 150);
            }

            if (previousInterval <= 0) {
                if (rating === "hard") {
                    scheduledDays = config.graduatingInterval;
                } else if (rating === "good") {
                    scheduledDays = config.graduatingInterval;
                } else {
                    scheduledDays = config.easyInterval;
                }
            } else {
                if (rating === "hard") {
                    scheduledDays = Math.round(previousInterval * config.hardMultiplier * config.intervalModifier);
                } else if (rating === "good") {
                    scheduledDays = Math.round(previousInterval * (easeFactor / 1000) * config.intervalModifier);
                } else {
                    scheduledDays = Math.round(
                        previousInterval * (easeFactor / 1000) * config.easyBonus * config.intervalModifier,
                    );
                }
            }

            scheduledDays = Math.max(config.minimumInterval, scheduledDays);
            if (config.enableFuzz && scheduledDays > 1) {
                scheduledDays = fuzzInterval(scheduledDays, {
                    cardId: previousCard.id,
                    now,
                    maximumInterval: config.maximumInterval,
                });
            }

            due = new Date(now.getTime() + scheduledDays * DAY_MS);
            nextType = CardType.Review;
            nextQueue = CardQueue.Review;
        }

        const nextCard: Card = {
            ...previousCard,
            mod: now.getTime(),
            type: nextType,
            queue: nextQueue,
            due: nextQueue === CardQueue.Learning ? due.getTime() : toDayNumber(due),
            ivl: scheduledDays,
            factor: easeFactor,
            reps,
            lapses,
            left: nextQueue === CardQueue.Learning ? 1 : 0,
            data: mergeCardData(previousCard, {
                scheduler: "sm2",
                legacy: {
                    easeFactor,
                    lapses,
                    reps,
                    intervalDays: scheduledDays,
                },
            }),
        };

        return {
            rating,
            nextCard,
            due,
            scheduledDays,
            reviewKind: inferRevlogType(previousCard.type, nextType),
        };
    }

    private resolveConfig(overrides: Partial<SchedulerConfig>, now: Date): SchedulerConfig {
        return resolveSchedulerConfig({
            ...this.baseConfig,
            ...overrides,
            now,
            limits: {
                ...this.baseConfig.limits,
                ...(overrides.limits ?? {}),
            },
        });
    }
}
interface FsrsInputState {
    readonly stability?: number;
    readonly difficulty?: number;
    readonly daysElapsed: number;
}

function resolveFsrsInput(card: Card, now: Date): FsrsInputState {
    const memory = extractFsrsMemory(card);

    if (memory) {
        const lastReview = new Date(memory.lastReview);
        const elapsedFromMemory = elapsedSchedulerDays(lastReview, now);

        return {
            stability: memory.stability,
            difficulty: memory.difficulty,
            daysElapsed: elapsedFromMemory,
        };
    }

    const inferredLastReview = inferLastReview(card, now);

    return {
        stability: card.ivl > 0 ? Math.max(0.1, card.ivl) : undefined,
        difficulty: card.ivl > 0 ? easeToDifficulty(card.factor) : undefined,
        daysElapsed: inferredLastReview
            ? elapsedSchedulerDays(inferredLastReview, now)
            : Math.max(0, Math.trunc(card.ivl)),
    };
}

function inferLastReview(card: Card, now: Date): Date | undefined {
    const payload = readCardData(card);
    if (payload.fsrs && typeof payload.fsrs.lastReview === "number") {
        return new Date(payload.fsrs.lastReview);
    }

    if (card.ivl > 0) {
        return new Date(now.getTime() - card.ivl * DAY_MS);
    }

    return undefined;
}

function shouldUseSm2Fallback(card: Card, config: SchedulerConfig): boolean {
    if (!config.useFsrs) {
        return true;
    }

    const payload = readCardData(card);
    if (typeof payload.scheduler === "string" && payload.scheduler.toLowerCase() === "sm2") {
        return true;
    }

    if (payload.legacy && typeof payload.legacy === "object") {
        return true;
    }

    return false;
}

function inferNextFsrsState(previousCard: Card, rating: ReviewRating, intervalDays: number): FsrsCardState {
    if (rating === "again") {
        if (previousCard.type === CardType.Review || previousCard.type === CardType.Relearning) {
            return "relearning";
        }
        return "learning";
    }

    if (previousCard.type === CardType.Review) {
        return "review";
    }

    if (previousCard.type === CardType.Relearning) {
        return intervalDays >= 1 ? "review" : "relearning";
    }

    if (previousCard.type === CardType.New || previousCard.type === CardType.Learning) {
        return intervalDays >= 1 ? "review" : "learning";
    }

    return "review";
}

function isLapseCandidate(cardType: number): boolean {
    return cardType === CardType.Review || cardType === CardType.Relearning;
}

function inferRevlogType(previousType: number, nextType: CardType): number {
    if (nextType === CardType.Relearning || previousType === CardType.Relearning) {
        return RevlogReviewKind.Relearning;
    }
    if (nextType === CardType.Review && previousType === CardType.Review) {
        return RevlogReviewKind.Review;
    }
    return RevlogReviewKind.Learning;
}

function ratingToEase(rating: ReviewRating): number {
    return mapReviewRatingToGrade(rating);
}

function buildRevlogId(now: Date, cardId: number, rating: ReviewRating): number {
    const base = now.getTime() * 10;
    const offset = rating === "again" ? 1 : rating === "hard" ? 2 : rating === "good" ? 3 : 4;
    const cardEntropy = Math.abs(cardId % 10);
    return base + ((offset + cardEntropy) % 10);
}

function easeToDifficulty(easeFactor: number): number {
    const normalizedEase = easeFactor > 0 ? easeFactor : 2500;
    return clamp(11 - normalizedEase / 300, 1, 10);
}

function difficultyToEase(difficulty: number, fallbackEase: number): number {
    const fromDifficulty = Math.round((11 - clamp(difficulty, 1, 10)) * 300);
    if (fromDifficulty < 1300 || fromDifficulty > 3000) {
        return clamp(fallbackEase || 2500, 1300, 3000);
    }
    return fromDifficulty;
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
