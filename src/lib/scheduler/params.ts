import {
    computeFsrsParametersAnki,
    normalizeFsrsWeights as normalizeFsrsWeightsFromBrowser,
    type FsrsAnkiOptimizationSample,
} from "@/lib/scheduler/fsrs-browser";
import {
    DEFAULT_SCHEDULER_CONFIG,
    type SchedulerConfig,
    type SchedulerLeechAction,
    type SchedulerReviewMix,
} from "@/lib/types/scheduler";

export interface FsrsParameters {
    readonly requestRetention: number;
    readonly maximumInterval: number;
    readonly enableFuzz: boolean;
    readonly enableShortTerm: boolean;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly weights: readonly number[];
}

export function resolveSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
    const base = DEFAULT_SCHEDULER_CONFIG;
    const mergedLimits = {
        ...base.limits,
        ...(overrides.limits ?? {}),
    };

    const legacyBurySiblings = overrides.burySiblings;
    const forceLegacyBury = legacyBurySiblings === true;
    const buryNew = forceLegacyBury ? true : overrides.buryNew ?? base.buryNew;
    const buryReviews = forceLegacyBury ? true : overrides.buryReviews ?? base.buryReviews;
    const buryInterdayLearning =
        forceLegacyBury ? true : overrides.buryInterdayLearning ?? base.buryInterdayLearning;

    return {
        ...base,
        ...overrides,
        requestRetention: clamp(overrides.requestRetention ?? base.requestRetention, 0.01, 0.9999),
        maximumInterval: Math.max(1, Math.trunc(overrides.maximumInterval ?? base.maximumInterval)),
        fsrsShortTermWithSteps: overrides.fsrsShortTermWithSteps ?? base.fsrsShortTermWithSteps,
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
        leechAction: normalizeLeechAction(overrides.leechAction ?? base.leechAction),
        burySiblings: overrides.burySiblings ?? (buryNew || buryReviews || buryInterdayLearning),
        buryNew,
        buryReviews,
        buryInterdayLearning,
        newReviewMix: normalizeReviewMix(overrides.newReviewMix ?? base.newReviewMix),
        interdayLearningMix: normalizeReviewMix(overrides.interdayLearningMix ?? base.interdayLearningMix),
        newCardsIgnoreReviewLimit: overrides.newCardsIgnoreReviewLimit ?? base.newCardsIgnoreReviewLimit,
        applyAllParentLimits: overrides.applyAllParentLimits ?? base.applyAllParentLimits,
        learnAheadSeconds: Math.max(0, Math.trunc(overrides.learnAheadSeconds ?? base.learnAheadSeconds)),
        limits: {
            newPerDay: Math.max(0, Math.trunc(mergedLimits.newPerDay)),
            reviewsPerDay: Math.max(0, Math.trunc(mergedLimits.reviewsPerDay)),
            learningPerDay: Math.max(0, Math.trunc(mergedLimits.learningPerDay)),
        },
        fsrsWeights: normalizeFsrsWeights(overrides.fsrsWeights),
    };
}

export function buildFsrsParameters(config: SchedulerConfig): FsrsParameters {
    const normalized = resolveSchedulerConfig(config);
    return {
        requestRetention: normalized.requestRetention,
        maximumInterval: normalized.maximumInterval,
        enableFuzz: normalized.enableFuzz,
        enableShortTerm: normalized.enableShortTerm,
        learningSteps: normalized.learningSteps,
        relearningSteps: normalized.relearningSteps,
        weights: normalizeFsrsWeights(normalized.fsrsWeights),
    };
}

export function normalizeFsrsWeights(weights: readonly number[] | undefined): number[] {
    return normalizeFsrsWeightsFromBrowser(weights);
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
    readonly id?: number;
    readonly cid?: number;
    readonly type?: number;
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

    const optimizationReviews = normalizeOptimizationSamples(reviews);

    const weights = optimizationReviews.length > 0
        ? normalizeFsrsWeights(computeFsrsParametersAnki(optimizationReviews, config.enableShortTerm))
        : normalizeFsrsWeights(config.fsrsWeights);

    return {
        requestRetention: config.requestRetention,
        maximumInterval: config.maximumInterval,
        recallRate,
        reviewCount: reviews.length,
        weights,
    };
}

export function schedulerOverridesFromUnknown(config: unknown): Partial<SchedulerConfig> {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        return {};
    }

    const record = config as Record<string, unknown>;

    const newPerDay = firstNumber(
        record.newPerDay,
        record.new_per_day,
        getNestedNumber(record.new, "perDay"),
    );
    const reviewsPerDay = firstNumber(
        record.reviewsPerDay,
        record.reviews_per_day,
        getNestedNumber(record.rev, "perDay"),
    );
    const learningPerDay = firstNumber(
        record.learningPerDay,
        record.learning_per_day,
        getNestedNumber(record.new, "perDay"),
    );

    const learnAheadSeconds = firstNumber(
        record.learnAheadSeconds,
        record.learn_ahead_secs,
        record.learnAheadSecs,
        record.collapseTime,
    );

    const newReviewMix = normalizeReviewMixUnknown(
        firstKnown(
            record.newReviewMix,
            record.new_review_mix,
            record.newMix,
            record.new_mix,
            record.newSpread,
            record.new_spread,
        ),
    );

    const interdayLearningMix = normalizeReviewMixUnknown(
        firstKnown(
            record.interdayLearningMix,
            record.interday_learning_mix,
            record.dayLearnMix,
            record.day_learn_mix,
        ),
    );

    const learningSteps = normalizeStepArray(
        firstArray(record.learningSteps, getNestedArray(record.new, "delays")),
    );
    const relearningSteps = normalizeStepArray(
        firstArray(record.relearningSteps, getNestedArray(record.lapse, "delays")),
    );

    const fsrsWeights = normalizeNumericArray(
        firstKnown(record.fsrsWeights, record.fsrs_params_6, record.fsrs_params_5, record.fsrs_params_4),
    );

    const fsrsShortTermWithSteps = firstBoolean(
        record.fsrsShortTermWithSteps,
        record.fsrs_short_term_with_steps,
        record.fsrsShortTermWithStepsEnabled,
        record.fsrs_short_term_with_steps_enabled,
    );

    const explicitBurySiblings = firstBoolean(record.burySiblings, record.bury);
    const buryNew = firstBoolean(record.buryNew, getNestedBoolean(record.new, "bury"), explicitBurySiblings);
    const buryReviews = firstBoolean(
        record.buryReviews,
        getNestedBoolean(record.rev, "bury"),
        explicitBurySiblings,
    );
    const buryInterdayLearning = firstBoolean(
        record.buryInterdayLearning,
        record.bury_interday_learning,
        explicitBurySiblings,
    );

    const inferredBurySiblings =
        explicitBurySiblings ??
        ([buryNew, buryReviews, buryInterdayLearning].some((value) => value === true)
            ? true
            : [buryNew, buryReviews, buryInterdayLearning].some((value) => value === false)
                ? false
                : undefined);

    return {
        requestRetention: firstNumber(record.requestRetention, record.desiredRetention),
        maximumInterval: firstNumber(record.maximumInterval, record.maxInterval, getNestedNumber(record.rev, "maxIvl")),
        enableFuzz: firstBoolean(record.enableFuzz),
        leechThreshold: firstNumber(record.leechThreshold, record.leechFails, getNestedNumber(record.lapse, "leechFails")),
        leechAction: normalizeLeechActionUnknown(
            firstKnown(record.leechAction, getNestedValue(record.lapse, "leechAction")),
        ),
        burySiblings: inferredBurySiblings,
        buryNew,
        buryReviews,
        buryInterdayLearning,
        newCardsIgnoreReviewLimit: firstBoolean(
            record.newCardsIgnoreReviewLimit,
            record.new_cards_ignore_review_limit,
        ),
        applyAllParentLimits: firstBoolean(record.applyAllParentLimits, record.apply_all_parent_limits),
        fsrsShortTermWithSteps,
        fsrsWeights,
        limits: {
            newPerDay: newPerDay ?? 20,
            reviewsPerDay: reviewsPerDay ?? 200,
            learningPerDay: learningPerDay ?? (reviewsPerDay ?? 200),
        },
        ...(learnAheadSeconds !== undefined ? { learnAheadSeconds } : {}),
        ...(newReviewMix !== undefined ? { newReviewMix } : {}),
        ...(interdayLearningMix !== undefined ? { interdayLearningMix } : {}),
        ...(learningSteps ? { learningSteps } : {}),
        ...(relearningSteps ? { relearningSteps } : {}),
    };
}

function normalizeOptimizationSamples(reviews: readonly RevlogOptimizationSample[]): FsrsAnkiOptimizationSample[] {
    return reviews
        .map((review, index) => {
            const id = normalizeIdentifier(review.id, Date.now() + index);
            const cid = normalizeIdentifier(review.cid, index + 1);
            const ease = normalizeEase(review.ease);
            const type = normalizeReviewType(review.type);

            return {
                id,
                cid,
                ease,
                type,
            };
        })
        .sort((left, right) => {
            if (left.cid === right.cid) {
                return left.id - right.id;
            }
            return left.cid - right.cid;
        });
}

function normalizeIdentifier(value: number | undefined, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.trunc(value);
        if (normalized > 0) {
            return normalized;
        }
    }

    return Math.max(1, Math.trunc(fallback));
}

function normalizeEase(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return clamp(Math.trunc(value), 0, 4);
}

function normalizeReviewType(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }

    return clamp(Math.trunc(value), 0, 255);
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

function normalizeReviewMix(mode: SchedulerReviewMix): SchedulerReviewMix {
    if (mode === "after-reviews" || mode === "before-reviews") {
        return mode;
    }
    return "mix-with-reviews";
}

function normalizeReviewMixUnknown(value: unknown): SchedulerReviewMix | undefined {
    if (value === "mix-with-reviews" || value === "after-reviews" || value === "before-reviews") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.trunc(value);
        if (normalized === 1) {
            return "after-reviews";
        }
        if (normalized === 2) {
            return "before-reviews";
        }
        return "mix-with-reviews";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (
            normalized === "mix" ||
            normalized === "distribute" ||
            normalized === "mix_with_reviews" ||
            normalized === "mixwithreviews"
        ) {
            return "mix-with-reviews";
        }
        if (
            normalized === "afterreviews" ||
            normalized === "reviewsfirst" ||
            normalized === "reviews_first"
        ) {
            return "after-reviews";
        }
        if (
            normalized === "beforereviews" ||
            normalized === "newfirst" ||
            normalized === "new_first"
        ) {
            return "before-reviews";
        }
    }

    return undefined;
}

function normalizeLeechAction(action: SchedulerLeechAction): SchedulerLeechAction {
    return action === "suspend" ? "suspend" : "tag-only";
}

function normalizeLeechActionUnknown(value: unknown): SchedulerLeechAction | undefined {
    if (value === "suspend" || value === "tag-only") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value) === 0 ? "suspend" : "tag-only";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "0" || normalized === "suspend") {
            return "suspend";
        }
        if (normalized === "1" || normalized === "tag" || normalized === "tag-only" || normalized === "tag_only") {
            return "tag-only";
        }
    }

    return undefined;
}

function normalizeStepArray(raw: unknown[] | undefined): string[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const steps = raw
        .map((value) => {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                return `${Math.max(1, Math.trunc(value))}m`;
            }
            if (typeof value === "string" && value.trim().length > 0) {
                const normalized = value.trim().toLowerCase();
                if (/^\d+(m|h|d)$/.test(normalized)) {
                    return normalized;
                }
                if (/^\d+$/.test(normalized)) {
                    return `${normalized}m`;
                }
            }
            return null;
        })
        .filter((value): value is string => value !== null);

    return steps.length > 0 ? steps : undefined;
}

function normalizeNumericArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const numeric = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
    return numeric.length > 0 ? numeric : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return undefined;
}

function firstArray(...values: unknown[]): unknown[] | undefined {
    for (const value of values) {
        if (Array.isArray(value)) {
            return value;
        }
    }
    return undefined;
}

function firstKnown(...values: unknown[]): unknown {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}

function getNestedNumber(value: unknown, key: string): number | undefined {
    const nested = getNestedValue(value, key);
    return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
}

function getNestedBoolean(value: unknown, key: string): boolean | undefined {
    const nested = getNestedValue(value, key);
    return typeof nested === "boolean" ? nested : undefined;
}

function getNestedArray(value: unknown, key: string): unknown[] | undefined {
    const nested = getNestedValue(value, key);
    return Array.isArray(nested) ? nested : undefined;
}

function getNestedValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    return (value as Record<string, unknown>)[key];
}
