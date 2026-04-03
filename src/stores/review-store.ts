import { create } from "zustand";
import type { Card } from "@/lib/types/card";
import {
    DEFAULT_SCHEDULER_CONFIG,
    type QueueBuildResult,
    type ReviewRating,
    type SchedulerConfig,
    type SchedulerPreview,
} from "@/lib/types/scheduler";

export type ReviewSessionStage = "idle" | "loading" | "question" | "answer" | "completed" | "error";

export interface ReviewQueueCounts {
    readonly learning: number;
    readonly review: number;
    readonly new: number;
}

export interface ActiveReviewCard {
    readonly card: Card;
    readonly questionHtml: string;
    readonly answerHtml: string;
    readonly css: string;
    readonly templateName: string;
    readonly preview: SchedulerPreview;
    readonly intervalLabels: Record<ReviewRating, string>;
    readonly audioTags: {
        readonly question: readonly string[];
        readonly answer: readonly string[];
    };
}

export interface UndoStateEntry {
    readonly revlogId: number;
    readonly previousCard: Card;
    readonly previousSiblingCards: readonly Card[];
    readonly rating: ReviewRating;
    readonly answeredAt: number;
}

export interface StartReviewSessionPayload {
    readonly deckId: number | null;
    readonly config: SchedulerConfig;
    readonly queueResult: QueueBuildResult;
    readonly currentCard: ActiveReviewCard | null;
}

export interface RecordAnswerPayload {
    readonly queueResult: QueueBuildResult;
    readonly nextCard: ActiveReviewCard | null;
    readonly undoEntry: UndoStateEntry;
}

export interface UndoAppliedPayload {
    readonly queueResult: QueueBuildResult;
    readonly currentCard: ActiveReviewCard | null;
}

export interface SyncQueuePayload {
    readonly queueResult: QueueBuildResult;
    readonly currentCard: ActiveReviewCard | null;
}

interface ReviewStore {
    readonly deckId: number | null;
    readonly stage: ReviewSessionStage;
    readonly config: SchedulerConfig;
    readonly queue: readonly Card[];
    readonly counts: ReviewQueueCounts;
    readonly currentCard: ActiveReviewCard | null;
    readonly answered: number;
    readonly error: string | null;
    readonly history: readonly UndoStateEntry[];

    readonly startLoading: (deckId: number | null) => void;
    readonly startSession: (payload: StartReviewSessionPayload) => void;
    readonly revealAnswer: () => void;
    readonly recordAnswer: (payload: RecordAnswerPayload) => void;
    readonly applyUndo: (payload: UndoAppliedPayload) => void;
    readonly syncQueue: (payload: SyncQueuePayload) => void;
    readonly setError: (message: string) => void;
    readonly reset: () => void;
}

const EMPTY_COUNTS: ReviewQueueCounts = {
    learning: 0,
    review: 0,
    new: 0,
};

const INITIAL_STATE: Omit<
    ReviewStore,
    "startLoading" | "startSession" | "revealAnswer" | "recordAnswer" | "applyUndo" | "syncQueue" | "setError" | "reset"
> = {
    deckId: null,
    stage: "idle",
    config: DEFAULT_SCHEDULER_CONFIG,
    queue: [],
    counts: EMPTY_COUNTS,
    currentCard: null,
    answered: 0,
    error: null,
    history: [],
};

export const useReviewStore = create<ReviewStore>((set) => ({
    ...INITIAL_STATE,

    startLoading: (deckId) => {
        set((state) => ({
            ...state,
            deckId,
            stage: "loading",
            queue: [],
            counts: EMPTY_COUNTS,
            currentCard: null,
            answered: 0,
            error: null,
            history: [],
        }));
    },

    startSession: ({ deckId, config, queueResult, currentCard }) => {
        set({
            deckId,
            config,
            queue: queueResult.cards,
            counts: queueResult.counts,
            currentCard,
            answered: 0,
            stage: currentCard ? "question" : "completed",
            error: null,
            history: [],
        });
    },

    revealAnswer: () => {
        set((state) => {
            if (!state.currentCard || state.stage !== "question") {
                return state;
            }
            return {
                ...state,
                stage: "answer",
            };
        });
    },

    recordAnswer: ({ queueResult, nextCard, undoEntry }) => {
        set((state) => ({
            ...state,
            queue: queueResult.cards,
            counts: queueResult.counts,
            currentCard: nextCard,
            answered: state.answered + 1,
            stage: nextCard ? "question" : "completed",
            error: null,
            history: [...state.history, undoEntry],
        }));
    },

    applyUndo: ({ queueResult, currentCard }) => {
        set((state) => ({
            ...state,
            queue: queueResult.cards,
            counts: queueResult.counts,
            currentCard,
            answered: Math.max(0, state.answered - 1),
            stage: currentCard ? "question" : "completed",
            error: null,
            history: state.history.slice(0, -1),
        }));
    },

    syncQueue: ({ queueResult, currentCard }) => {
        set((state) => ({
            ...state,
            queue: queueResult.cards,
            counts: queueResult.counts,
            currentCard,
            stage: currentCard ? "question" : "completed",
            error: null,
        }));
    },

    setError: (message) => {
        set((state) => ({
            ...state,
            stage: "error",
            error: message,
        }));
    },

    reset: () => {
        set(INITIAL_STATE);
    },
}));
