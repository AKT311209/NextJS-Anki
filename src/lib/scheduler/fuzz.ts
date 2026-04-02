import { toDayNumber } from "@/lib/scheduler/states";

export interface FuzzOptions {
    readonly cardId: number;
    readonly now: Date;
    readonly maximumInterval: number;
}

export function fuzzInterval(intervalDays: number, options: FuzzOptions): number {
    const rounded = Math.max(1, Math.trunc(intervalDays));

    if (rounded <= 2) {
        return rounded;
    }

    const spread = computeFuzzSpread(rounded);
    const daySeed = toDayNumber(options.now);
    const seed = hash32(`${options.cardId}:${daySeed}`);
    const random = mulberry32(seed)();

    const min = Math.max(1, rounded - spread);
    const max = Math.max(min, rounded + spread);
    const fuzzed = Math.floor(min + random * (max - min + 1));

    return Math.min(Math.max(1, fuzzed), Math.max(1, Math.trunc(options.maximumInterval)));
}

function computeFuzzSpread(intervalDays: number): number {
    if (intervalDays < 7) {
        return 1;
    }
    if (intervalDays < 30) {
        return Math.max(1, Math.round(intervalDays * 0.15));
    }
    return Math.max(1, Math.round(intervalDays * 0.05));
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state += 0x6D2B79F5;
        let result = Math.imul(state ^ (state >>> 15), 1 | state);
        result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}

function hash32(text: string): number {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
