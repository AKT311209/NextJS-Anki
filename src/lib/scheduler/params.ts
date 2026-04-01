import { default_w, generatorParameters, type FSRSParameters, type StepUnit } from "ts-fsrs";
import { DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from "@/lib/types/scheduler";

export function resolveSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
    const base = DEFAULT_SCHEDULER_CONFIG;
    const mergedLimits = {
        ...base.limits,
        ...(overrides.limits ?? {}),
    };

    return {
        ...base,
        ...overrides,
        requestRetention: clamp(overrides.requestRetention ?? base.requestRetention, 0.01, 0.9999),
        maximumInterval: Math.max(1, Math.trunc(overrides.maximumInterval ?? base.maximumInterval)),
        learningSteps: normalizeSteps(overrides.learningSteps ?? base.learningSteps),
        relearningSteps: normalizeSteps(overrides.relearningSteps ?? base.relearningSteps),
        intervalModifier: clamp(overrides.intervalModifier ?? base.intervalModifier, 0.1, 10),
        hardMultiplier: clamp(overrides.hardMultiplier ?? base.hardMultiplier, 1, 10),
        easyBonus: clamp(overrides.easyBonus ?? base.easyBonus, 1, 10),
        lapseMultiplier: clamp(overrides.lapseMultiplier ?? base.lapseMultiplier, 0.01, 1),
        minimumInterval: Math.max(1, Math.trunc(overrides.minimumInterval ?? base.minimumInterval)),
        graduatingInterval: Math.max(1, Math.trunc(overrides.graduatingInterval ?? base.graduatingInterval)),
        easyInterval: Math.max(1, Math.trunc(overrides.easyInterval ?? base.easyInterval)),
        startingEase: Math.max(1300, Math.trunc(overrides.startingEase ?? base.startingEase)),
        leechThreshold: Math.max(1, Math.trunc(overrides.leechThreshold ?? base.leechThreshold)),
        limits: {
            newPerDay: Math.max(0, Math.trunc(mergedLimits.newPerDay)),
            reviewsPerDay: Math.max(0, Math.trunc(mergedLimits.reviewsPerDay)),
            learningPerDay: Math.max(0, Math.trunc(mergedLimits.learningPerDay)),
        },
        fsrsWeights: normalizeFsrsWeights(overrides.fsrsWeights),
    };
}

export function buildFsrsParameters(config: SchedulerConfig): FSRSParameters {
    const normalized = resolveSchedulerConfig(config);
    return generatorParameters({
        request_retention: normalized.requestRetention,
        maximum_interval: normalized.maximumInterval,
        enable_fuzz: normalized.enableFuzz,
        enable_short_term: normalized.enableShortTerm,
        learning_steps: normalized.learningSteps as StepUnit[],
        relearning_steps: normalized.relearningSteps as StepUnit[],
        w: normalizeFsrsWeights(normalized.fsrsWeights),
    });
}

export function normalizeFsrsWeights(weights: readonly number[] | undefined): number[] {
    const defaultWeights = [...default_w];
    if (!weights || weights.length === 0) {
        return defaultWeights;
    }

    const normalized = [...defaultWeights];
    for (let index = 0; index < normalized.length; index += 1) {
        const value = weights[index];
        if (typeof value === "number" && Number.isFinite(value)) {
            normalized[index] = value;
        }
    }

    return normalized;
}

export function normalizeSteps(steps: readonly string[]): string[] {
    const normalized = steps
        .map((step) => step.trim().toLowerCase())
        .filter((step) => /^\d+(m|h|d)$/.test(step));

    if (normalized.length > 0) {
        return normalized;
    }

    return ["1m", "10m"];
}

export function parseStepToMinutes(step: string): number {
    const normalized = step.trim().toLowerCase();
    const match = normalized.match(/^(\d+)(m|h|d)$/);
    if (!match) {
        return 1;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    if (!Number.isFinite(value) || value <= 0) {
        return 1;
    }

    if (unit === "m") {
        return value;
    }
    if (unit === "h") {
        return value * 60;
    }
    return value * 60 * 24;
}

export function firstStepMinutes(config: SchedulerConfig, relearning = false): number {
    const source = relearning ? config.relearningSteps : config.learningSteps;
    if (source.length === 0) {
        return 1;
    }
    return parseStepToMinutes(source[0]);
}

export interface RevlogOptimizationSample {
    readonly ease: number;
    readonly ivl?: number;
    readonly lastIvl?: number;
}

export interface SchedulerOptimizationResult {
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly recallRate: number;
    readonly reviewCount: number;
    readonly weights: readonly number[];
}

export function optimizeSchedulerParameters(
    reviews: readonly RevlogOptimizationSample[],
    configOverrides: Partial<SchedulerConfig> = {},
): SchedulerOptimizationResult {
    const config = resolveSchedulerConfig(configOverrides);
    if (reviews.length === 0) {
        return {
            requestRetention: config.requestRetention,
            maximumInterval: config.maximumInterval,
            recallRate: config.requestRetention,
            reviewCount: 0,
            weights: normalizeFsrsWeights(config.fsrsWeights),
        };
    }

    const recallRate =
        reviews.reduce((accumulator, review) => accumulator + (review.ease >= 3 ? 1 : 0), 0) /
        reviews.length;

    const tunedRequestRetention = clamp(
        config.requestRetention + (recallRate - config.requestRetention) * 0.25,
        0.8,
        0.97,
    );

    const intervalCandidates = reviews
        .map((review) => Math.max(0, Math.trunc(review.ivl ?? 0)))
        .filter((value) => value > 0)
        .sort((left, right) => left - right);

    const p90Interval = intervalCandidates.length > 0
        ? intervalCandidates[Math.floor((intervalCandidates.length - 1) * 0.9)]
        : config.maximumInterval;

    const tunedMaximumInterval = Math.max(config.maximumInterval, Math.max(1, Math.trunc(p90Interval * 2)));

    return {
        requestRetention: tunedRequestRetention,
        maximumInterval: tunedMaximumInterval,
        recallRate,
        reviewCount: reviews.length,
        weights: normalizeFsrsWeights(config.fsrsWeights),
    };
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
