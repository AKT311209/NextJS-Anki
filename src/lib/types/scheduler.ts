import type { Card, FsrsMemoryState } from "@/lib/types/card";
import type { RevlogEntry } from "@/lib/types/revlog";

export type ReviewRating = "again" | "hard" | "good" | "easy";

export type SchedulerReviewMix = "mix-with-reviews" | "after-reviews" | "before-reviews";

export type SchedulerNewCardGatherPriority =
    | "deck"
    | "deck-then-random-notes"
    | "lowest-position"
    | "highest-position"
    | "random-notes"
    | "random-cards";

export type SchedulerNewCardSortOrder =
    | "template"
    | "no-sort"
    | "template-then-random"
    | "random-note-then-template"
    | "random-card";

export type SchedulerReviewSortOrder =
    | "due"
    | "due-then-deck"
    | "deck-then-due"
    | "interval-ascending"
    | "interval-descending"
    | "ease-ascending"
    | "ease-descending"
    | "retrievability-ascending"
    | "retrievability-descending"
    | "relative-overdueness"
    | "random"
    | "added"
    | "reverse-added";

export type SchedulerQuestionAction = "show-answer" | "show-reminder";

export type SchedulerAnswerAction =
    | "bury-card"
    | "answer-again"
    | "answer-good"
    | "answer-hard"
    | "show-reminder";

export type SchedulerLeechAction = "tag-only" | "suspend";

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
    readonly fsrsShortTermWithSteps: boolean;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly intervalModifier: number;
    readonly hardMultiplier: number;
    readonly easyBonus: number;
    readonly lapseMultiplier: number;
    readonly minimumInterval: number;
    readonly minimumLapseInterval: number;
    readonly graduatingInterval: number;
    readonly easyInterval: number;
    readonly startingEase: number;
    readonly leechThreshold: number;
    readonly leechAction: SchedulerLeechAction;
    readonly burySiblings: boolean;
    readonly buryNew: boolean;
    readonly buryReviews: boolean;
    readonly buryInterdayLearning: boolean;
    readonly newCardGatherPriority: SchedulerNewCardGatherPriority;
    readonly newCardSortOrder: SchedulerNewCardSortOrder;
    readonly newReviewMix: SchedulerReviewMix;
    readonly interdayLearningMix: SchedulerReviewMix;
    readonly reviewSortOrder: SchedulerReviewSortOrder;
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
    readonly previewAgainSeconds: number;
    readonly previewHardSeconds: number;
    readonly previewGoodSeconds: number;
    readonly easyDaysPercentages: readonly number[];
    readonly newCardsIgnoreReviewLimit: boolean;
    readonly applyAllParentLimits: boolean;
    readonly learnAheadSeconds: number;
    readonly collectionDayOffset: number;
    readonly limits: SchedulerLimits;
    readonly fsrsWeights?: readonly number[];
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    useFsrs: true,
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    fsrsShortTermWithSteps: false,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    intervalModifier: 1,
    hardMultiplier: 1.2,
    easyBonus: 1.3,
    lapseMultiplier: 0.5,
    minimumInterval: 1,
    minimumLapseInterval: 1,
    graduatingInterval: 1,
    easyInterval: 4,
    startingEase: 2500,
    leechThreshold: 8,
    leechAction: "tag-only",
    burySiblings: false,
    buryNew: false,
    buryReviews: false,
    buryInterdayLearning: false,
    newCardGatherPriority: "deck",
    newCardSortOrder: "template",
    newReviewMix: "mix-with-reviews",
    interdayLearningMix: "mix-with-reviews",
    reviewSortOrder: "due",
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
    previewAgainSeconds: 60,
    previewHardSeconds: 600,
    previewGoodSeconds: 0,
    easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
    newCardsIgnoreReviewLimit: false,
    applyAllParentLimits: false,
    learnAheadSeconds: 1200,
    collectionDayOffset: 0,
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
    readonly allowedNewCardIds?: ReadonlySet<number>;
    readonly avoidImmediateLearningRepeatCardId?: number;
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
