export enum CardType {
    New = 0,
    Learning = 1,
    Review = 2,
    Relearning = 3,
}

export enum CardQueue {
    SchedBuried = -3,
    UserBuried = -2,
    Suspended = -1,
    New = 0,
    Learning = 1,
    Review = 2,
    DayLearning = 3,
    Preview = 4,
}

export interface FsrsMemoryState {
    readonly stability: number;
    readonly difficulty: number;
    readonly lastReview: number;
    readonly elapsedDays?: number;
    readonly scheduledDays?: number;
}

export interface LegacySchedulingState {
    readonly easeFactor?: number;
    readonly lapses?: number;
    readonly reps?: number;
    readonly intervalDays?: number;
}

export interface CardDataPayload {
    readonly fsrs?: FsrsMemoryState;
    readonly legacy?: LegacySchedulingState;
    readonly [key: string]: unknown;
}

export interface Card {
    readonly id: number;
    readonly nid: number;
    readonly did: number;
    readonly ord: number;
    readonly mod: number;
    readonly usn: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
    readonly ivl: number;
    readonly factor: number;
    readonly reps: number;
    readonly lapses: number;
    readonly left: number;
    readonly odue: number;
    readonly odid: number;
    readonly flags: number;
    readonly data: string;
}

export type CardPatch = Partial<Omit<Card, "id">>;
