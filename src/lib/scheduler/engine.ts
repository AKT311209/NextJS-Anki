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
import { buildFsrsParameters, firstStepMinutes, parseStepToMinutes, resolveSchedulerConfig } from "@/lib/scheduler/params";
import {
    elapsedSchedulerDays,
    extractFsrsMemory,
    fromDayNumber,
    type FsrsCardState,
    mapFsrsStateToCardType,
    mapReviewRatingToGrade,
    mergeCardData,
    queueForState,
    readCardData,
    toDayNumber,
} from "@/lib/scheduler/states";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

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
        const input = resolveFsrsInput(card, now, config.collectionDayOffset);

        try {
            const preview = computeNextFsrsStates(scheduler, {
                desiredRetention: fsrsParameters.requestRetention,
                daysElapsed: input.daysElapsed,
                stability: input.stability,
                difficulty: input.difficulty,
            });

            const again = this.buildTransitionFromFsrs(card, preview.again, "again", config, now, input.daysElapsed);
            let hard = this.buildTransitionFromFsrs(card, preview.hard, "hard", config, now, input.daysElapsed);
            let good = this.buildTransitionFromFsrs(card, preview.good, "good", config, now, input.daysElapsed);
            let easy = this.buildTransitionFromFsrs(card, preview.easy, "easy", config, now, input.daysElapsed);

            if (card.type === CardType.Review) {
                ({ hard, good, easy } = enforceFsrsReviewPassingOrder(
                    card,
                    { hard, good, easy },
                    config,
                    now,
                    config.collectionDayOffset,
                ));
            }

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
        const transition = this.resolveFsrsTransitionDecision(previousCard, rating, intervalDays, config, now);

        let scheduledDays = transition.scheduledDays;
        let due = transition.due;
        let nextQueue = transition.nextQueue;
        const nextType = transition.nextType;
        let persistedIntervalDays = transition.persistedIntervalDays ?? scheduledDays;

        // Enforce minimum interval for cards graduating to Review.
        // FSRS can return scheduled_days < 1 (e.g. 0.3),
        // causing ivl=0 Review cards that never escape and appear immediately
        // due each queue rebuild.
        if (nextQueue === CardQueue.Review && scheduledDays < 1) {
            scheduledDays = Math.max(config.minimumInterval, config.graduatingInterval);
            due = new Date(now.getTime() + scheduledDays * DAY_MS);
            persistedIntervalDays = scheduledDays;
        }

        if (nextQueue === CardQueue.DayLearning && scheduledDays < 1) {
            scheduledDays = 1;
            due = fromDayNumber(
                toDayNumber(now, undefined, config.collectionDayOffset) + scheduledDays,
                undefined,
                config.collectionDayOffset,
            );
            if (persistedIntervalDays < 1) {
                persistedIntervalDays = scheduledDays;
            }
        }

        if (config.enableFuzz && scheduledDays > 1 && nextQueue === CardQueue.Review) {
            scheduledDays = fuzzInterval(intervalDays, {
                cardId: previousCard.id,
                reps: previousCard.reps,
                minimum: Math.max(1, config.minimumInterval),
                maximum: config.maximumInterval,
            });
            due = new Date(now.getTime() + scheduledDays * DAY_MS);
            nextQueue = CardQueue.Review;
            persistedIntervalDays = scheduledDays;
        }

        if (persistedIntervalDays < 0) {
            persistedIntervalDays = 0;
        }

        const fsrsMemory: FsrsMemoryState = {
            stability: item.stability,
            difficulty: item.difficulty,
            lastReview: now.getTime(),
            elapsedDays,
            scheduledDays: persistedIntervalDays,
        };

        const reps = previousCard.reps + 1;
        const lapses = previousCard.lapses + (rating === "again" && isLapseCandidate(previousCard.type) ? 1 : 0);

        const learningLeft = nextQueue === CardQueue.Learning || nextQueue === CardQueue.DayLearning
            ? Math.max(0, transition.remainingSteps)
            : 0;

        const nextCard: Card = {
            ...previousCard,
            mod: now.getTime(),
            type: nextType,
            queue: nextQueue,
            due: nextQueue === CardQueue.Learning
                ? due.getTime()
                : toDayNumber(due, undefined, config.collectionDayOffset),
            ivl: persistedIntervalDays,
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

    private resolveFsrsTransitionDecision(
        previousCard: Card,
        rating: ReviewRating,
        intervalDays: number,
        config: SchedulerConfig,
        now: Date,
    ): ResolvedFsrsTransition {
        if (previousCard.type === CardType.New || previousCard.type === CardType.Learning) {
            return this.resolveLearningFsrsTransition(previousCard, rating, intervalDays, config, now);
        }

        if (previousCard.type === CardType.Relearning) {
            return this.resolveRelearningFsrsTransition(previousCard, rating, intervalDays, config, now);
        }

        if (previousCard.type === CardType.Review && rating === "again") {
            return this.resolveReviewAgainFsrsTransition(intervalDays, config, now);
        }

        return this.resolveFsrsDefaultTransition(previousCard, rating, intervalDays, now);
    }

    private resolveLearningFsrsTransition(
        previousCard: Card,
        rating: ReviewRating,
        intervalDays: number,
        config: SchedulerConfig,
        now: Date,
    ): ResolvedFsrsTransition {
        const learningStepDelays = toStepDelaysSeconds(config.learningSteps);
        const failedRemainingSteps = learningStepDelays.length;
        const remainingSteps = previousCard.type === CardType.New
            ? failedRemainingSteps
            : normalizeRemainingSteps(previousCard.left, failedRemainingSteps);

        if (rating === "again") {
            const againDelay = learningStepDelays[0];
            if (againDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, againDelay, config);
                return {
                    nextType: CardType.Learning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps: failedRemainingSteps,
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: learningStepDelays.length,
                shortTermType: CardType.Learning,
                shortTermRemainingSteps: failedRemainingSteps,
            });
        }

        if (rating === "hard") {
            const hardDelay = hardDelaySeconds(learningStepDelays, remainingSteps);
            if (hardDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, hardDelay, config);
                return {
                    nextType: CardType.Learning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps,
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: learningStepDelays.length,
                shortTermType: CardType.Learning,
                shortTermRemainingSteps: remainingSteps,
            });
        }

        if (rating === "good") {
            const goodDelay = goodDelaySeconds(learningStepDelays, remainingSteps);
            if (goodDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, goodDelay, config);
                return {
                    nextType: CardType.Learning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps: remainingStepsForGood(learningStepDelays, remainingSteps),
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: learningStepDelays.length,
                shortTermType: CardType.Learning,
                shortTermRemainingSteps: remainingSteps,
            });
        }

        if (rating === "easy") {
            const scheduledDays = Math.max(1, Math.round(intervalDays));
            return {
                nextType: CardType.Review,
                nextQueue: CardQueue.Review,
                due: new Date(now.getTime() + scheduledDays * DAY_MS),
                scheduledDays,
                remainingSteps: 0,
            };
        }

        return this.resolveFsrsDefaultTransition(previousCard, rating, intervalDays, now);
    }

    private resolveRelearningFsrsTransition(
        previousCard: Card,
        rating: ReviewRating,
        intervalDays: number,
        config: SchedulerConfig,
        now: Date,
    ): ResolvedFsrsTransition {
        const relearningStepDelays = toStepDelaysSeconds(config.relearningSteps);
        const failedRemainingSteps = relearningStepDelays.length;
        const remainingSteps = normalizeRemainingSteps(previousCard.left, failedRemainingSteps);
        const persistedReviewIntervalDays = resolveRelearningReviewIntervalDays(intervalDays, config);

        if (rating === "again") {
            const againDelay = relearningStepDelays[0];
            if (againDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, againDelay, config);
                return {
                    nextType: CardType.Relearning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps: failedRemainingSteps,
                    persistedIntervalDays: persistedReviewIntervalDays,
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: relearningStepDelays.length,
                shortTermType: CardType.Relearning,
                shortTermRemainingSteps: failedRemainingSteps,
                persistedIntervalDays: persistedReviewIntervalDays,
            });
        }

        if (rating === "hard") {
            const hardDelay = hardDelaySeconds(relearningStepDelays, remainingSteps);
            if (hardDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, hardDelay, config);
                return {
                    nextType: CardType.Relearning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps,
                    persistedIntervalDays: persistedReviewIntervalDays,
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: relearningStepDelays.length,
                shortTermType: CardType.Relearning,
                shortTermRemainingSteps: remainingSteps,
                persistedIntervalDays: persistedReviewIntervalDays,
            });
        }

        if (rating === "good") {
            const goodRemainingSteps = remainingStepsForGood(relearningStepDelays, remainingSteps);
            const goodDelay = goodDelaySeconds(relearningStepDelays, remainingSteps);
            if (goodDelay !== undefined) {
                const schedule = this.scheduleLearningSeconds(now, goodDelay, config);
                return {
                    nextType: CardType.Relearning,
                    nextQueue: schedule.nextQueue,
                    due: schedule.due,
                    scheduledDays: schedule.scheduledDays,
                    remainingSteps: goodRemainingSteps,
                    persistedIntervalDays: persistedReviewIntervalDays,
                };
            }

            return this.resolveFsrsStepFallback({
                now,
                intervalDays,
                config,
                stepCount: relearningStepDelays.length,
                shortTermType: CardType.Relearning,
                shortTermRemainingSteps: goodRemainingSteps,
                persistedIntervalDays: persistedReviewIntervalDays,
            });
        }

        if (rating === "easy") {
            const scheduledDays = Math.max(1, Math.round(intervalDays));
            return {
                nextType: CardType.Review,
                nextQueue: CardQueue.Review,
                due: new Date(now.getTime() + scheduledDays * DAY_MS),
                scheduledDays,
                remainingSteps: 0,
            };
        }

        return this.resolveFsrsDefaultTransition(previousCard, rating, intervalDays, now);
    }

    private resolveReviewAgainFsrsTransition(
        intervalDays: number,
        config: SchedulerConfig,
        now: Date,
    ): ResolvedFsrsTransition {
        const relearningStepDelays = toStepDelaysSeconds(config.relearningSteps);
        const failedRemainingSteps = relearningStepDelays.length;
        const againDelay = relearningStepDelays[0];
        const persistedReviewIntervalDays = resolveRelearningReviewIntervalDays(intervalDays, config);

        if (againDelay !== undefined) {
            const schedule = this.scheduleLearningSeconds(now, againDelay, config);
            return {
                nextType: CardType.Relearning,
                nextQueue: schedule.nextQueue,
                due: schedule.due,
                scheduledDays: schedule.scheduledDays,
                remainingSteps: failedRemainingSteps,
                persistedIntervalDays: persistedReviewIntervalDays,
            };
        }

        return this.resolveFsrsStepFallback({
            now,
            intervalDays,
            config,
            stepCount: relearningStepDelays.length,
            shortTermType: CardType.Relearning,
            shortTermRemainingSteps: failedRemainingSteps,
            persistedIntervalDays: persistedReviewIntervalDays,
        });
    }

    private resolveFsrsStepFallback(options: FsrsStepFallbackOptions): ResolvedFsrsTransition {
        if (shouldUseFsrsShortTerm(options.config, options.intervalDays, options.stepCount > 0)) {
            const schedule = this.scheduleLearningSeconds(
                options.now,
                Math.max(0, Math.trunc(options.intervalDays * DAY_SECONDS)),
                options.config,
            );

            return {
                nextType: options.shortTermType,
                nextQueue: schedule.nextQueue,
                due: schedule.due,
                scheduledDays: schedule.scheduledDays,
                remainingSteps: options.shortTermRemainingSteps,
                persistedIntervalDays: options.persistedIntervalDays,
            };
        }

        const scheduledDays = Math.max(
            1,
            Math.round(options.persistedIntervalDays ?? options.intervalDays),
        );
        return {
            nextType: CardType.Review,
            nextQueue: CardQueue.Review,
            due: new Date(options.now.getTime() + scheduledDays * DAY_MS),
            scheduledDays,
            remainingSteps: 0,
            persistedIntervalDays: scheduledDays,
        };
    }

    private resolveFsrsDefaultTransition(
        previousCard: Card,
        rating: ReviewRating,
        intervalDays: number,
        now: Date,
    ): ResolvedFsrsTransition {
        const nextState = inferNextFsrsState(previousCard, rating, intervalDays);
        const nextType = mapFsrsStateToCardType(nextState);
        const nextQueue = queueForState(nextState, intervalDays);

        return {
            nextType,
            nextQueue,
            due: new Date(now.getTime() + intervalDays * DAY_MS),
            scheduledDays: Math.max(0, Math.trunc(intervalDays)),
            remainingSteps: 0,
        };
    }

    private scheduleLearningSeconds(
        now: Date,
        intervalSeconds: number,
        config: SchedulerConfig,
    ): LearningSchedule {
        const safeSeconds = Math.max(0, Math.trunc(intervalSeconds));
        const secondsUntilRollover = secondsUntilNextRollover(now, config.collectionDayOffset);

        if (safeSeconds >= secondsUntilRollover) {
            const days = Math.floor((safeSeconds - secondsUntilRollover) / DAY_SECONDS) + 1;
            const dueDay = toDayNumber(now, undefined, config.collectionDayOffset) + days;

            return {
                nextQueue: CardQueue.DayLearning,
                due: fromDayNumber(dueDay, undefined, config.collectionDayOffset),
                scheduledDays: days,
            };
        }

        return {
            nextQueue: CardQueue.Learning,
            due: new Date(now.getTime() + safeSeconds * 1000),
            scheduledDays: 0,
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
            scheduledDays = relearning
                ? clamp(
                    Math.round(Math.max(1, previousInterval) * config.lapseMultiplier),
                    config.minimumLapseInterval,
                    config.maximumInterval,
                )
                : Math.max(0, Math.floor(minutes / (60 * 24)));
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
                    reps: previousCard.reps,
                    minimum: Math.max(1, config.minimumInterval),
                    maximum: config.maximumInterval,
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
            due: nextQueue === CardQueue.Learning
                ? due.getTime()
                : toDayNumber(due, undefined, config.collectionDayOffset),
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

interface ResolvedFsrsTransition {
    readonly nextType: CardType;
    readonly nextQueue: CardQueue;
    readonly due: Date;
    readonly scheduledDays: number;
    readonly remainingSteps: number;
    readonly persistedIntervalDays?: number;
}

interface FsrsStepFallbackOptions {
    readonly now: Date;
    readonly intervalDays: number;
    readonly config: SchedulerConfig;
    readonly stepCount: number;
    readonly shortTermType: CardType;
    readonly shortTermRemainingSteps: number;
    readonly persistedIntervalDays?: number;
}

interface LearningSchedule {
    readonly nextQueue: CardQueue;
    readonly due: Date;
    readonly scheduledDays: number;
}

function resolveFsrsInput(
    card: Card,
    now: Date,
    collectionDayOffset = 0,
): FsrsInputState {
    const memory = extractFsrsMemory(card);

    if (memory) {
        const lastReview = new Date(memory.lastReview);
        const elapsedFromMemory = elapsedSchedulerDays(lastReview, now, undefined, collectionDayOffset);

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
            ? elapsedSchedulerDays(inferredLastReview, now, undefined, collectionDayOffset)
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
    return cardType === CardType.Review;
}

function toStepDelaysSeconds(steps: readonly string[]): number[] {
    return steps.map((step) => Math.max(0, Math.trunc(parseStepToMinutes(step) * 60)));
}

function normalizeRemainingSteps(currentLeft: number, totalSteps: number): number {
    if (totalSteps <= 0) {
        return 0;
    }

    const normalized = Number.isFinite(currentLeft) ? Math.trunc(currentLeft) : 0;
    return normalized > 0 ? normalized : totalSteps;
}

function stepIndexForRemaining(stepDelays: readonly number[], remainingSteps: number): number {
    const total = stepDelays.length;
    if (total === 0) {
        return 0;
    }

    const normalizedRemaining = Math.max(0, Math.trunc(remainingSteps));
    return Math.min(Math.max(total - (normalizedRemaining % 1000), 0), total - 1);
}

function hardDelaySeconds(stepDelays: readonly number[], remainingSteps: number): number | undefined {
    if (stepDelays.length === 0) {
        return undefined;
    }

    const index = stepIndexForRemaining(stepDelays, remainingSteps);
    const current = stepDelays[index] ?? stepDelays[0];

    if (current === undefined) {
        return undefined;
    }

    if (index === 0) {
        return hardDelayForFirstStep(stepDelays, current);
    }

    return current;
}

function hardDelayForFirstStep(stepDelays: readonly number[], againSeconds: number): number {
    const nextDelay = stepDelays[1];
    if (nextDelay !== undefined) {
        return maybeRoundInDays(Math.trunc((againSeconds + nextDelay) / 2));
    }

    const increased = Math.trunc((againSeconds * 3) / 2);
    const bounded = Math.min(increased, againSeconds + DAY_SECONDS);
    return maybeRoundInDays(bounded);
}

function goodDelaySeconds(stepDelays: readonly number[], remainingSteps: number): number | undefined {
    if (stepDelays.length === 0) {
        return undefined;
    }

    const index = stepIndexForRemaining(stepDelays, remainingSteps);
    return stepDelays[index + 1];
}

function remainingStepsForGood(stepDelays: readonly number[], remainingSteps: number): number {
    if (stepDelays.length === 0) {
        return 0;
    }

    const index = stepIndexForRemaining(stepDelays, remainingSteps);
    return Math.max(0, stepDelays.length - (index + 1));
}

function resolveRelearningReviewIntervalDays(intervalDays: number, config: SchedulerConfig): number {
    return clamp(
        Math.max(config.minimumLapseInterval, Math.round(intervalDays)),
        1,
        config.maximumInterval,
    );
}

function maybeRoundInDays(seconds: number): number {
    if (seconds > DAY_SECONDS) {
        return Math.max(1, Math.round(seconds / DAY_SECONDS)) * DAY_SECONDS;
    }

    return seconds;
}

function shouldUseFsrsShortTerm(config: SchedulerConfig, intervalDays: number, hasConfiguredSteps: boolean): boolean {
    if (!config.enableShortTerm) {
        return false;
    }

    if (!fsrsSupportsShortTermByParameters(config)) {
        return false;
    }

    if (intervalDays >= 0.5) {
        return false;
    }

    return config.fsrsShortTermWithSteps || !hasConfiguredSteps;
}

function fsrsSupportsShortTermByParameters(config: SchedulerConfig): boolean {
    const weights = buildFsrsParameters(config).weights;
    if (weights.length < 19) {
        return false;
    }

    return weights[17] > 0 && weights[18] > 0;
}

function enforceFsrsReviewPassingOrder(
    previousCard: Card,
    transitions: {
        hard: SchedulerTransition;
        good: SchedulerTransition;
        easy: SchedulerTransition;
    },
    config: SchedulerConfig,
    now: Date,
    collectionDayOffset = 0,
): {
    hard: SchedulerTransition;
    good: SchedulerTransition;
    easy: SchedulerTransition;
} {
    const previousInterval = Math.max(0, Math.trunc(previousCard.ivl));
    const greaterThanLast = (interval: number): number => {
        if (interval > previousInterval) {
            return previousInterval + 1;
        }

        return 0;
    };

    const hardMinimum = Math.max(1, greaterThanLast(transitions.hard.scheduledDays));
    const hard = applyReviewIntervalMinimum(
        transitions.hard,
        hardMinimum,
        config.maximumInterval,
        now,
        collectionDayOffset,
    );

    const goodMinimum = Math.max(
        greaterThanLast(transitions.good.scheduledDays),
        (hard.nextCard.queue === CardQueue.Review ? hard.scheduledDays + 1 : 1),
    );
    const good = applyReviewIntervalMinimum(
        transitions.good,
        goodMinimum,
        config.maximumInterval,
        now,
        collectionDayOffset,
    );

    const easyMinimum = Math.max(
        greaterThanLast(transitions.easy.scheduledDays),
        (good.nextCard.queue === CardQueue.Review ? good.scheduledDays + 1 : 1),
    );
    const easy = applyReviewIntervalMinimum(
        transitions.easy,
        easyMinimum,
        config.maximumInterval,
        now,
        collectionDayOffset,
    );

    return { hard, good, easy };
}

function applyReviewIntervalMinimum(
    transition: SchedulerTransition,
    minimum: number,
    maximum: number,
    now: Date,
    collectionDayOffset = 0,
): SchedulerTransition {
    if (transition.nextCard.queue !== CardQueue.Review) {
        return transition;
    }

    const clampedMaximum = Math.max(1, Math.trunc(maximum));
    const targetDays = clamp(Math.max(1, minimum, Math.trunc(transition.scheduledDays)), 1, clampedMaximum);

    if (targetDays === transition.scheduledDays) {
        return transition;
    }

    const due = new Date(now.getTime() + targetDays * DAY_MS);
    const nextCard = {
        ...transition.nextCard,
        due: toDayNumber(due, undefined, collectionDayOffset),
        ivl: targetDays,
        data: transition.fsrs
            ? mergeCardData(transition.nextCard, {
                fsrs: {
                    ...transition.fsrs,
                    scheduledDays: targetDays,
                },
            })
            : transition.nextCard.data,
    };

    return {
        ...transition,
        due,
        scheduledDays: targetDays,
        fsrs: transition.fsrs
            ? {
                ...transition.fsrs,
                scheduledDays: targetDays,
            }
            : transition.fsrs,
        nextCard,
    };
}

function secondsUntilNextRollover(now: Date, collectionDayOffset = 0): number {
    const nextRollover = fromDayNumber(
        toDayNumber(now, undefined, collectionDayOffset) + 1,
        undefined,
        collectionDayOffset,
    );
    return Math.max(0, Math.trunc((nextRollover.getTime() - now.getTime()) / 1000));
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
