import { Rating, fsrs, type Card as FsrsCard } from "ts-fsrs";
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
    dueDateFromCard,
    extractFsrsMemory,
    mapCardTypeToFsrsState,
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
        const scheduler = fsrs(buildFsrsParameters(config));
        const fsrsCard = toFsrsCard(card, now);
        const preview = scheduler.repeat(fsrsCard, now);

        const again = this.buildTransitionFromFsrs(card, preview[Rating.Again], "again", config, now);
        const hard = this.buildTransitionFromFsrs(card, preview[Rating.Hard], "hard", config, now);
        const good = this.buildTransitionFromFsrs(card, preview[Rating.Good], "good", config, now);
        const easy = this.buildTransitionFromFsrs(card, preview[Rating.Easy], "easy", config, now);

        return { again, hard, good, easy };
    }

    private buildTransitionFromFsrs(
        previousCard: Card,
        item: { card: FsrsCard; log: { scheduled_days: number; review: Date; elapsed_days: number } },
        rating: ReviewRating,
        config: SchedulerConfig,
        now: Date,
    ): SchedulerTransition {
        let scheduledDays = Math.max(0, Math.trunc(item.log.scheduled_days));
        let due = item.card.due;

        const nextType = mapFsrsStateToCardType(item.card.state);
        let nextQueue = queueForState(item.card.state, scheduledDays);

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
            stability: item.card.stability,
            difficulty: item.card.difficulty,
            lastReview: item.log.review.getTime(),
            elapsedDays: item.log.elapsed_days,
            scheduledDays,
        };

        const nextCard: Card = {
            ...previousCard,
            mod: now.getTime(),
            type: nextType,
            queue: nextQueue,
            due: nextQueue === CardQueue.Learning ? due.getTime() : toDayNumber(due),
            ivl: scheduledDays,
            factor: difficultyToEase(item.card.difficulty, previousCard.factor),
            reps: item.card.reps,
            lapses: item.card.lapses,
            left: item.card.learning_steps,
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

function toFsrsCard(card: Card, now: Date): FsrsCard {
    const memory = extractFsrsMemory(card);
    const defaultStability = Math.max(0.1, card.ivl || 0.1);
    const defaultDifficulty = easeToDifficulty(card.factor);

    return {
        due: dueDateFromCard(card, now),
        stability: memory?.stability ?? defaultStability,
        difficulty: memory?.difficulty ?? defaultDifficulty,
        elapsed_days: Math.max(0, Math.trunc(card.ivl)),
        scheduled_days: Math.max(0, Math.trunc(card.ivl)),
        learning_steps: Math.max(0, Math.trunc(card.left)),
        reps: Math.max(0, Math.trunc(card.reps)),
        lapses: Math.max(0, Math.trunc(card.lapses)),
        state: mapCardTypeToFsrsState(card.type),
        last_review: memory ? new Date(memory.lastReview) : inferLastReview(card, now),
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
