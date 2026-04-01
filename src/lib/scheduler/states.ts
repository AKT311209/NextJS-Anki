import { Rating, State, type Grade } from "ts-fsrs";
import {
    CardQueue,
    CardType,
    type Card,
    type CardDataPayload,
    type FsrsMemoryState,
} from "@/lib/types/card";
import type { ReviewRating } from "@/lib/types/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StateContext {
    readonly now: Date;
}

export function toDayNumber(value: Date): number {
    return Math.floor(value.getTime() / DAY_MS);
}

export function fromDayNumber(dayNumber: number): Date {
    return new Date(dayNumber * DAY_MS);
}

export function dueDateFromCard(card: Card, now: Date): Date {
    if (card.queue === CardQueue.Learning) {
        return new Date(card.due);
    }

    if (card.queue === CardQueue.DayLearning || card.queue === CardQueue.Review) {
        return fromDayNumber(card.due);
    }

    if (card.queue === CardQueue.New && card.due > 0) {
        return fromDayNumber(card.due);
    }

    return now;
}

export function isCardDue(card: Card, now: Date): boolean {
    if (card.queue === CardQueue.Suspended || card.queue === CardQueue.SchedBuried || card.queue === CardQueue.UserBuried) {
        return false;
    }

    if (card.queue === CardQueue.Learning) {
        return card.due <= now.getTime();
    }

    if (card.queue === CardQueue.DayLearning || card.queue === CardQueue.Review) {
        return card.due <= toDayNumber(now);
    }

    if (card.queue === CardQueue.New) {
        return true;
    }

    return false;
}

export function mapReviewRatingToGrade(rating: ReviewRating): Grade {
    if (rating === "again") {
        return Rating.Again;
    }
    if (rating === "hard") {
        return Rating.Hard;
    }
    if (rating === "good") {
        return Rating.Good;
    }
    return Rating.Easy;
}

export function mapCardTypeToFsrsState(type: number): State {
    if (type === CardType.Learning) {
        return State.Learning;
    }
    if (type === CardType.Review) {
        return State.Review;
    }
    if (type === CardType.Relearning) {
        return State.Relearning;
    }
    return State.New;
}

export function mapFsrsStateToCardType(state: State): CardType {
    if (state === State.Learning) {
        return CardType.Learning;
    }
    if (state === State.Review) {
        return CardType.Review;
    }
    if (state === State.Relearning) {
        return CardType.Relearning;
    }
    return CardType.New;
}

export function queueForState(state: State, scheduledDays: number): CardQueue {
    if (state === State.Review) {
        return CardQueue.Review;
    }
    if (state === State.New) {
        return CardQueue.New;
    }

    if (scheduledDays >= 1) {
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
