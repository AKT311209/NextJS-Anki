export interface Deck {
    readonly id: number;
    readonly name: string;
    readonly collapsed?: boolean;
    readonly browserCollapsed?: boolean;
    readonly conf?: number;
    readonly desc?: string;
    readonly dyn?: number;
    readonly extendNew?: number;
    readonly extendRev?: number;
    readonly mod?: number;
    readonly usn?: number;
}

export interface DeckDailyLimits {
    readonly newPerDay: number;
    readonly reviewsPerDay: number;
    readonly learningPerDay?: number;
}

export interface DeckSchedulingConfig {
    readonly id: number;
    readonly name?: string;
    readonly newPerDay: number;
    readonly reviewsPerDay: number;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly desiredRetention?: number;
    readonly maximumInterval?: number;
    readonly burySiblings?: boolean;
    readonly buryNew?: boolean;
    readonly buryReviews?: boolean;
    readonly buryInterdayLearning?: boolean;
    readonly newCardGatherPriority?:
    | "deck"
    | "deck-then-random-notes"
    | "lowest-position"
    | "highest-position"
    | "random-notes"
    | "random-cards";
    readonly newCardSortOrder?:
    | "template"
    | "no-sort"
    | "template-then-random"
    | "random-note-then-template"
    | "random-card";
    readonly reviewSortOrder?:
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
    readonly disableAutoplay?: boolean;
    readonly skipQuestionWhenReplayingAnswer?: boolean;
    readonly capAnswerTimeToSecs?: number;
    readonly showTimer?: boolean;
    readonly stopTimerOnAnswer?: boolean;
    readonly secondsToShowQuestion?: number;
    readonly secondsToShowAnswer?: number;
    readonly waitForAudio?: boolean;
    readonly questionAction?: "show-answer" | "show-reminder";
    readonly answerAction?: "bury-card" | "answer-again" | "answer-good" | "answer-hard" | "show-reminder";
    readonly easyDaysPercentages?: readonly number[];
    readonly leechAction?: "tag-only" | "suspend";
    readonly newCardsIgnoreReviewLimit?: boolean;
    readonly applyAllParentLimits?: boolean;
    readonly leechThreshold?: number;
    readonly fsrsWeights?: readonly number[];
}
