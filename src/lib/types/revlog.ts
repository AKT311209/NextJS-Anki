export enum RevlogReviewKind {
    Learning = 0,
    Review = 1,
    Relearning = 2,
    Filtered = 3,
    Manual = 4,
}

export interface RevlogEntry {
    readonly id: number;
    readonly cid: number;
    readonly usn: number;
    readonly ease: number;
    readonly ivl: number;
    readonly lastIvl: number;
    readonly factor: number;
    readonly time: number;
    readonly type: number;
}

export type CreateRevlogEntryInput = Omit<RevlogEntry, "usn"> & {
    readonly usn?: number;
};
