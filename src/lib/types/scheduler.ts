import type { Card, FsrsMemoryState } from "@/lib/types/card";
import type { RevlogEntry } from "@/lib/types/revlog";

export type ReviewRating = "again" | "hard" | "good" | "easy";

export const REVIEW_RATINGS: readonly ReviewRating[] = ["again", "hard", "good", "easy"] as const;

export interface SchedulerLimits {
    readonly newPerDay: number;
    readonly reviewsPerDay: number;
    readonly learningPerDay: number;
}

export interface SchedulerFsrsParameters {
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly enableFuzz: boolean;
    readonly enableShortTerm: boolean;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly weights: readonly number[];
}

export interface SchedulerConfig {
    readonly now?: Date;
    readonly useFsrs: boolean;
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly enableFuzz: boolean;
    readonly enableShortTerm: boolean;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly intervalModifier: number;
    readonly hardMultiplier: number;
    readonly easyBonus: number;
    readonly lapseMultiplier: number;
    readonly minimumInterval: number;
    readonly graduatingInterval: number;
    readonly easyInterval: number;
    readonly startingEase: number;
    readonly leechThreshold: number;
    readonly burySiblings: boolean;
    readonly limits: SchedulerLimits;
    readonly fsrsWeights?: readonly number[];
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    useFsrs: true,
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    intervalModifier: 1,
    hardMultiplier: 1.2,
    easyBonus: 1.3,
    lapseMultiplier: 0.5,
    minimumInterval: 1,
    graduatingInterval: 1,
    easyInterval: 4,
    startingEase: 2500,
    leechThreshold: 8,
    burySiblings: true,
    limits: {
        newPerDay: 20,
        reviewsPerDay: 200,
        learningPerDay: 200,
    },
};

export interface SchedulerTransition {
    readonly rating: ReviewRating;
    readonly nextCard: Card;
    readonly due: Date;
    readonly scheduledDays: number;
    readonly fsrs?: FsrsMemoryState;
    readonly reviewKind: number;
}

export type SchedulerPreview = Record<ReviewRating, SchedulerTransition>;

export interface QueueBuildRequest {
    readonly now: Date;
    readonly deckId?: number;
    readonly config: SchedulerConfig;
    readonly buriedCardIds?: ReadonlySet<number>;
}

export interface QueueBuildResult {
    readonly now: Date;
    readonly cards: Card[];
    readonly counts: {
        readonly learning: number;
        readonly review: number;
        readonly new: number;
    };
}

export interface AnswerCardInput {
    readonly card: Card;
    readonly rating: ReviewRating;
    readonly config: SchedulerConfig;
    readonly now: Date;
    readonly answerMillis: number;
}

export interface AnswerCardResult {
    readonly previousCard: Card;
    readonly nextCard: Card;
    readonly rating: ReviewRating;
    readonly due: Date;
    readonly scheduledDays: number;
    readonly fsrs?: FsrsMemoryState;
    readonly revlog: Omit<RevlogEntry, "usn"> & { usn?: number };
    readonly leechDetected: boolean;
}
