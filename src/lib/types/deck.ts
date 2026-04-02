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
    readonly leechAction?: "tag-only" | "suspend";
    readonly newCardsIgnoreReviewLimit?: boolean;
    readonly applyAllParentLimits?: boolean;
    readonly leechThreshold?: number;
    readonly fsrsWeights?: readonly number[];
}
