interface FuzzRange {
    readonly start: number;
    readonly end: number;
    readonly factor: number;
}

const REVIEW_FUZZ_RANGES: readonly FuzzRange[] = [
    {
        start: 2.5,
        end: 7,
        factor: 0.15,
    },
    {
        start: 7,
        end: 20,
        factor: 0.1,
    },
    {
        start: 20,
        end: Number.POSITIVE_INFINITY,
        factor: 0.05,
    },
];

export interface ReviewFuzzOptions {
    readonly cardId: number;
    readonly reps: number;
    readonly minimum?: number;
    readonly maximum: number;
    readonly enabled?: boolean;
}

export interface LearningDelayFuzzOptions {
    readonly cardId: number;
    readonly reps: number;
}

export function fuzzInterval(intervalDays: number, options: ReviewFuzzOptions): number {
    const maximum = Math.max(1, Math.trunc(options.maximum));
    const minimum = clamp(Math.trunc(options.minimum ?? 1), 1, maximum);
    const clampedInterval = clamp(intervalDays, minimum, maximum);

    if (options.enabled === false) {
        return clamp(Math.round(clampedInterval), minimum, maximum);
    }

    const [lower, upper] = constrainedFuzzBounds(clampedInterval, minimum, maximum);
    const fuzzFactor = fuzzFactorForCard(options.cardId, options.reps);

    return Math.floor(lower + fuzzFactor * (1 + upper - lower));
}

export function fuzzLearningIntervalSeconds(
    intervalSeconds: number,
    options: LearningDelayFuzzOptions,
): number {
    const seconds = Math.max(0, Math.trunc(intervalSeconds));
    const upperExclusive = seconds + Math.floor(Math.min(seconds * 0.25, 300));

    if (seconds >= upperExclusive) {
        return seconds;
    }

    const fuzzFactor = fuzzFactorForCard(options.cardId, options.reps);
    return seconds + Math.floor(fuzzFactor * (upperExclusive - seconds));
}

export function constrainedFuzzBounds(intervalDays: number, minimum: number, maximum: number): [number, number] {
    const boundedMaximum = Math.max(1, Math.trunc(maximum));
    const boundedMinimum = clamp(Math.trunc(minimum), 1, boundedMaximum);
    const boundedInterval = clamp(intervalDays, boundedMinimum, boundedMaximum);
    let [lower, upper] = fuzzBounds(boundedInterval);

    lower = clamp(lower, boundedMinimum, boundedMaximum);
    upper = clamp(upper, boundedMinimum, boundedMaximum);

    if (upper === lower && upper > 2 && upper < boundedMaximum) {
        upper = lower + 1;
    }

    return [lower, upper];
}

function fuzzBounds(intervalDays: number): [number, number] {
    const delta = fuzzDelta(intervalDays);
    return [Math.round(intervalDays - delta), Math.round(intervalDays + delta)];
}

function fuzzDelta(intervalDays: number): number {
    if (intervalDays < 2.5) {
        return 0;
    }

    return REVIEW_FUZZ_RANGES.reduce(
        (delta, range) => delta + range.factor * Math.max(0, Math.min(intervalDays, range.end) - range.start),
        1,
    );
}

function fuzzFactorForCard(cardId: number, reps: number): number {
    const normalizedCardId = BigInt(Math.max(0, Math.trunc(cardId)));
    const normalizedReps = BigInt(Math.max(0, Math.trunc(reps)));
    const seed = Number((normalizedCardId + normalizedReps) & BigInt(0xffff_ffff));
    return mulberry32(seed)();
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

function clamp(value: number, minimum: number, maximum: number): number {
    if (value < minimum) {
        return minimum;
    }
    if (value > maximum) {
        return maximum;
    }
    return value;
}
