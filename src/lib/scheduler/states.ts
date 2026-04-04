import {
    CardQueue,
    CardType,
    type Card,
    type CardDataPayload,
    type FsrsMemoryState,
} from "@/lib/types/card";
import type { ReviewRating } from "@/lib/types/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_SCHEDULER_ROLLOVER_HOUR = 4;

export const FSRS_RATING = {
    Again: 1,
    Hard: 2,
    Good: 3,
    Easy: 4,
} as const;

export type FsrsGrade = (typeof FSRS_RATING)[keyof typeof FSRS_RATING];
export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export interface StateContext {
    readonly now: Date;
}

export function toDayNumber(
    value: Date,
    rolloverHour = DEFAULT_SCHEDULER_ROLLOVER_HOUR,
    originDayOffset = 0,
): number {
    const schedulerAligned = schedulerDayTimestamp(value, rolloverHour);
    return Math.floor(schedulerAligned / DAY_MS) - Math.trunc(originDayOffset);
}

export function fromDayNumber(
    dayNumber: number,
    rolloverHour = DEFAULT_SCHEDULER_ROLLOVER_HOUR,
    originDayOffset = 0,
): Date {
    const normalizedDay = Math.trunc(dayNumber) + Math.trunc(originDayOffset);
    const rolloverMs = normalizeRolloverHour(rolloverHour) * HOUR_MS;

    // Convert scheduler day number back into a wall-clock Date in local time.
    // We resolve the UTC offset iteratively to keep DST transitions stable.
    let utcMillis = normalizedDay * DAY_MS + rolloverMs;
    for (let attempts = 0; attempts < 3; attempts += 1) {
        const offsetMillis = new Date(utcMillis).getTimezoneOffset() * MINUTE_MS;
        const resolved = normalizedDay * DAY_MS + rolloverMs + offsetMillis;
        if (resolved === utcMillis) {
            break;
        }
        utcMillis = resolved;
    }

    return new Date(utcMillis);
}

export function elapsedSchedulerDays(
    lastReview: Date,
    now: Date,
    rolloverHour = DEFAULT_SCHEDULER_ROLLOVER_HOUR,
    originDayOffset = 0,
): number {
    return Math.max(
        0,
        toDayNumber(now, rolloverHour, originDayOffset) - toDayNumber(lastReview, rolloverHour, originDayOffset),
    );
}

export function dueDateFromCard(
    card: Card,
    now: Date,
    rolloverHour = DEFAULT_SCHEDULER_ROLLOVER_HOUR,
    originDayOffset = 0,
): Date {
    if (card.queue === CardQueue.Learning) {
        return new Date(card.due);
    }

    if (card.queue === CardQueue.DayLearning || card.queue === CardQueue.Review) {
        return fromDayNumber(card.due, rolloverHour, originDayOffset);
    }

    if (card.queue === CardQueue.New && card.due > 0) {
        return fromDayNumber(card.due, rolloverHour, originDayOffset);
    }

    return now;
}

export function isCardDue(
    card: Card,
    now: Date,
    rolloverHour = DEFAULT_SCHEDULER_ROLLOVER_HOUR,
    originDayOffset = 0,
): boolean {
    if (card.queue === CardQueue.Suspended || card.queue === CardQueue.SchedBuried || card.queue === CardQueue.UserBuried) {
        return false;
    }

    if (card.queue === CardQueue.Learning) {
        return card.due <= now.getTime();
    }

    if (card.queue === CardQueue.DayLearning || card.queue === CardQueue.Review) {
        return card.due <= toDayNumber(now, rolloverHour, originDayOffset);
    }

    if (card.queue === CardQueue.New) {
        return true;
    }

    return false;
}

export function mapReviewRatingToGrade(rating: ReviewRating): FsrsGrade {
    if (rating === "again") {
        return FSRS_RATING.Again;
    }
    if (rating === "hard") {
        return FSRS_RATING.Hard;
    }
    if (rating === "good") {
        return FSRS_RATING.Good;
    }
    return FSRS_RATING.Easy;
}

export function mapCardTypeToFsrsState(type: number): FsrsCardState {
    if (type === CardType.Learning) {
        return "learning";
    }
    if (type === CardType.Review) {
        return "review";
    }
    if (type === CardType.Relearning) {
        return "relearning";
    }
    return "new";
}

export function mapFsrsStateToCardType(state: FsrsCardState): CardType {
    if (state === "learning") {
        return CardType.Learning;
    }
    if (state === "review") {
        return CardType.Review;
    }
    if (state === "relearning") {
        return CardType.Relearning;
    }
    return CardType.New;
}

export function queueForState(state: FsrsCardState, intervalDays: number): CardQueue {
    if (state === "review") {
        return CardQueue.Review;
    }
    if (state === "new") {
        return CardQueue.New;
    }

    if (intervalDays >= 1) {
        return CardQueue.DayLearning;
    }

    return CardQueue.Learning;
}

export function readCardData(card: Card): CardDataPayload {
    if (!card.data || card.data.trim().length === 0) {
        return {};
    }

    try {
        const parsed = JSON.parse(card.data) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        return parsed as CardDataPayload;
    } catch {
        return {};
    }
}

export function mergeCardData(card: Card, patch: Partial<CardDataPayload>): string {
    const current = readCardData(card) as Record<string, unknown>;
    const next = {
        ...current,
        ...patch,
    };
    return JSON.stringify(next);
}

export function extractFsrsMemory(card: Card): FsrsMemoryState | undefined {
    const payload = readCardData(card);
    const fsrs = payload.fsrs;
    if (!fsrs || typeof fsrs !== "object") {
        return undefined;
    }

    if (
        typeof fsrs.stability !== "number" ||
        !Number.isFinite(fsrs.stability) ||
        typeof fsrs.difficulty !== "number" ||
        !Number.isFinite(fsrs.difficulty) ||
        typeof fsrs.lastReview !== "number" ||
        !Number.isFinite(fsrs.lastReview)
    ) {
        return undefined;
    }

    return fsrs;
}

function schedulerDayTimestamp(value: Date, rolloverHour: number): number {
    const normalizedRollover = normalizeRolloverHour(rolloverHour);
    const localMillis = value.getTime() - value.getTimezoneOffset() * MINUTE_MS;
    return localMillis - normalizedRollover * HOUR_MS;
}

function normalizeRolloverHour(rolloverHour: number): number {
    if (!Number.isFinite(rolloverHour)) {
        return DEFAULT_SCHEDULER_ROLLOVER_HOUR;
    }

    const normalized = Math.trunc(rolloverHour) % 24;
    return normalized >= 0 ? normalized : normalized + 24;
}
