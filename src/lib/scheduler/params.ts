import {
    computeFsrsParametersAnki,
    normalizeFsrsWeights as normalizeFsrsWeightsFromBrowser,
    type FsrsAnkiOptimizationSample,
} from "@/lib/scheduler/fsrs-browser";
import {
    DEFAULT_SCHEDULER_CONFIG,
    type SchedulerAnswerAction,
    type SchedulerConfig,
    type SchedulerNewCardGatherPriority,
    type SchedulerNewCardSortOrder,
    type SchedulerQuestionAction,
    type SchedulerLeechAction,
    type SchedulerReviewMix,
    type SchedulerReviewSortOrder,
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
        minimumLapseInterval: Math.max(
            1,
            Math.trunc(overrides.minimumLapseInterval ?? base.minimumLapseInterval),
        ),
        graduatingInterval: Math.max(1, Math.trunc(overrides.graduatingInterval ?? base.graduatingInterval)),
        easyInterval: Math.max(1, Math.trunc(overrides.easyInterval ?? base.easyInterval)),
        startingEase: Math.max(1300, Math.trunc(overrides.startingEase ?? base.startingEase)),
        leechThreshold: Math.max(1, Math.trunc(overrides.leechThreshold ?? base.leechThreshold)),
        leechAction: normalizeLeechAction(overrides.leechAction ?? base.leechAction),
        burySiblings: overrides.burySiblings ?? (buryNew || buryReviews || buryInterdayLearning),
        buryNew,
        buryReviews,
        buryInterdayLearning,
        newCardGatherPriority: normalizeNewCardGatherPriority(
            overrides.newCardGatherPriority ?? base.newCardGatherPriority,
        ),
        newCardSortOrder: normalizeNewCardSortOrder(overrides.newCardSortOrder ?? base.newCardSortOrder),
        newReviewMix: normalizeReviewMix(overrides.newReviewMix ?? base.newReviewMix),
        interdayLearningMix: normalizeReviewMix(overrides.interdayLearningMix ?? base.interdayLearningMix),
        reviewSortOrder: normalizeReviewSortOrder(overrides.reviewSortOrder ?? base.reviewSortOrder),
        disableAutoplay: overrides.disableAutoplay ?? base.disableAutoplay,
        skipQuestionWhenReplayingAnswer:
            overrides.skipQuestionWhenReplayingAnswer ?? base.skipQuestionWhenReplayingAnswer,
        capAnswerTimeToSecs: clamp(Math.trunc(overrides.capAnswerTimeToSecs ?? base.capAnswerTimeToSecs), 1, 7200),
        showTimer: overrides.showTimer ?? base.showTimer,
        stopTimerOnAnswer: overrides.stopTimerOnAnswer ?? base.stopTimerOnAnswer,
        secondsToShowQuestion: Math.max(0, overrides.secondsToShowQuestion ?? base.secondsToShowQuestion),
        secondsToShowAnswer: Math.max(0, overrides.secondsToShowAnswer ?? base.secondsToShowAnswer),
        waitForAudio: overrides.waitForAudio ?? base.waitForAudio,
        questionAction: normalizeQuestionAction(overrides.questionAction ?? base.questionAction),
        answerAction: normalizeAnswerAction(overrides.answerAction ?? base.answerAction),
        previewAgainSeconds: Math.max(0, Math.trunc(overrides.previewAgainSeconds ?? base.previewAgainSeconds)),
        previewHardSeconds: Math.max(0, Math.trunc(overrides.previewHardSeconds ?? base.previewHardSeconds)),
        previewGoodSeconds: Math.max(0, Math.trunc(overrides.previewGoodSeconds ?? base.previewGoodSeconds)),
        easyDaysPercentages: normalizeEasyDaysPercentages(overrides.easyDaysPercentages),
        newCardsIgnoreReviewLimit: overrides.newCardsIgnoreReviewLimit ?? base.newCardsIgnoreReviewLimit,
        applyAllParentLimits: overrides.applyAllParentLimits ?? base.applyAllParentLimits,
        learnAheadSeconds: Math.max(0, Math.trunc(overrides.learnAheadSeconds ?? base.learnAheadSeconds)),
        collectionDayOffset: Math.trunc(overrides.collectionDayOffset ?? base.collectionDayOffset),
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

    const newCardGatherPriority = normalizeNewCardGatherPriorityUnknown(
        firstKnown(
            record.newCardGatherPriority,
            record.new_card_gather_priority,
            record.newGatherPriority,
            record.new_gather_priority,
        ),
    );

    const newCardSortOrder = normalizeNewCardSortOrderUnknown(
        firstKnown(
            record.newCardSortOrder,
            record.new_card_sort_order,
            record.newSortOrder,
            record.new_sort_order,
        ),
    );

    const reviewSortOrder = normalizeReviewSortOrderUnknown(
        firstKnown(
            record.reviewSortOrder,
            record.review_order,
            record.reviewOrder,
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

    const disableAutoplay = firstBoolean(
        record.disableAutoplay,
        record.disable_autoplay,
        invertBoolean(record.autoplay),
    );

    const skipQuestionWhenReplayingAnswer = firstBoolean(
        record.skipQuestionWhenReplayingAnswer,
        record.skip_question_when_replaying_answer,
        invertBoolean(record.replayq),
    );

    const capAnswerTimeToSecs = firstNumber(
        record.capAnswerTimeToSecs,
        record.cap_answer_time_to_secs,
        record.maxTaken,
        record.max_taken,
    );

    const showTimer = firstBoolean(
        record.showTimer,
        record.show_timer,
        numberToBoolean(record.timer),
    );

    const stopTimerOnAnswer = firstBoolean(
        record.stopTimerOnAnswer,
        record.stop_timer_on_answer,
    );

    const secondsToShowQuestion = firstNumber(
        record.secondsToShowQuestion,
        record.seconds_to_show_question,
    );

    const secondsToShowAnswer = firstNumber(
        record.secondsToShowAnswer,
        record.seconds_to_show_answer,
    );

    const waitForAudio = firstBoolean(
        record.waitForAudio,
        record.wait_for_audio,
    );

    const questionAction = normalizeQuestionActionUnknown(
        firstKnown(record.questionAction, record.question_action),
    );

    const answerAction = normalizeAnswerActionUnknown(
        firstKnown(record.answerAction, record.answer_action),
    );

    const previewAgainSeconds = firstNumber(
        record.previewAgainSeconds,
        record.preview_again_seconds,
        record.previewAgainSecs,
        record.preview_again_secs,
    );
    const previewHardSeconds = firstNumber(
        record.previewHardSeconds,
        record.preview_hard_seconds,
        record.previewHardSecs,
        record.preview_hard_secs,
    );
    const previewGoodSeconds = firstNumber(
        record.previewGoodSeconds,
        record.preview_good_seconds,
        record.previewGoodSecs,
        record.preview_good_secs,
    );

    const easyDaysPercentages = normalizeEasyDaysPercentagesUnknown(
        firstKnown(record.easyDaysPercentages, record.easy_days_percentages),
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
        minimumLapseInterval: firstNumber(
            record.minimumLapseInterval,
            record.minimum_lapse_interval,
            getNestedNumber(record.lapse, "minInt"),
            getNestedNumber(record.lapse, "minimumInterval"),
        ),
        leechThreshold: firstNumber(record.leechThreshold, record.leechFails, getNestedNumber(record.lapse, "leechFails")),
        leechAction: normalizeLeechActionUnknown(
            firstKnown(record.leechAction, getNestedValue(record.lapse, "leechAction")),
        ),
        burySiblings: inferredBurySiblings,
        buryNew,
        buryReviews,
        buryInterdayLearning,
        ...(newCardGatherPriority !== undefined ? { newCardGatherPriority } : {}),
        ...(newCardSortOrder !== undefined ? { newCardSortOrder } : {}),
        ...(reviewSortOrder !== undefined ? { reviewSortOrder } : {}),
        ...(disableAutoplay !== undefined ? { disableAutoplay } : {}),
        ...(skipQuestionWhenReplayingAnswer !== undefined ? { skipQuestionWhenReplayingAnswer } : {}),
        ...(capAnswerTimeToSecs !== undefined ? { capAnswerTimeToSecs } : {}),
        ...(showTimer !== undefined ? { showTimer } : {}),
        ...(stopTimerOnAnswer !== undefined ? { stopTimerOnAnswer } : {}),
        ...(secondsToShowQuestion !== undefined ? { secondsToShowQuestion } : {}),
        ...(secondsToShowAnswer !== undefined ? { secondsToShowAnswer } : {}),
        ...(waitForAudio !== undefined ? { waitForAudio } : {}),
        ...(questionAction !== undefined ? { questionAction } : {}),
        ...(answerAction !== undefined ? { answerAction } : {}),
        ...(previewAgainSeconds !== undefined ? { previewAgainSeconds } : {}),
        ...(previewHardSeconds !== undefined ? { previewHardSeconds } : {}),
        ...(previewGoodSeconds !== undefined ? { previewGoodSeconds } : {}),
        ...(easyDaysPercentages ? { easyDaysPercentages } : {}),
        newCardsIgnoreReviewLimit: firstBoolean(
            record.newCardsIgnoreReviewLimit,
            record.new_cards_ignore_review_limit,
        ),
        applyAllParentLimits: firstBoolean(record.applyAllParentLimits, record.apply_all_parent_limits),
        collectionDayOffset: firstNumber(record.collectionDayOffset, record.collection_day_offset),
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

function normalizeNewCardGatherPriority(
    mode: SchedulerNewCardGatherPriority,
): SchedulerNewCardGatherPriority {
    switch (mode) {
        case "deck":
        case "deck-then-random-notes":
        case "lowest-position":
        case "highest-position":
        case "random-notes":
        case "random-cards":
            return mode;
        default:
            return "deck";
    }
}

function normalizeNewCardSortOrder(mode: SchedulerNewCardSortOrder): SchedulerNewCardSortOrder {
    switch (mode) {
        case "template":
        case "no-sort":
        case "template-then-random":
        case "random-note-then-template":
        case "random-card":
            return mode;
        default:
            return "template";
    }
}

function normalizeNewCardGatherPriorityUnknown(
    value: unknown,
): SchedulerNewCardGatherPriority | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 5:
                return "deck-then-random-notes";
            case 1:
                return "lowest-position";
            case 2:
                return "highest-position";
            case 3:
                return "random-notes";
            case 4:
                return "random-cards";
            default:
                return "deck";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized.length === 0) {
            return undefined;
        }

        if (["deck", "new_card_gather_priority_deck"].includes(normalized)) {
            return "deck";
        }
        if (
            [
                "deck-then-random-notes",
                "deck_then_random_notes",
                "new_card_gather_priority_deck_then_random_notes",
            ].includes(normalized)
        ) {
            return "deck-then-random-notes";
        }
        if (
            [
                "lowest-position",
                "lowest_position",
                "new_card_gather_priority_lowest_position",
            ].includes(normalized)
        ) {
            return "lowest-position";
        }
        if (
            [
                "highest-position",
                "highest_position",
                "new_card_gather_priority_highest_position",
            ].includes(normalized)
        ) {
            return "highest-position";
        }
        if (
            [
                "random-notes",
                "random_notes",
                "new_card_gather_priority_random_notes",
            ].includes(normalized)
        ) {
            return "random-notes";
        }
        if (
            [
                "random-cards",
                "random_cards",
                "new_card_gather_priority_random_cards",
            ].includes(normalized)
        ) {
            return "random-cards";
        }
    }

    return undefined;
}

function normalizeNewCardSortOrderUnknown(value: unknown): SchedulerNewCardSortOrder | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "no-sort";
            case 2:
                return "template-then-random";
            case 3:
                return "random-note-then-template";
            case 4:
                return "random-card";
            default:
                return "template";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized.length === 0) {
            return undefined;
        }

        if (["template", "new_card_sort_order_template"].includes(normalized)) {
            return "template";
        }
        if (["no-sort", "no_sort", "new_card_sort_order_no_sort"].includes(normalized)) {
            return "no-sort";
        }
        if (
            [
                "template-then-random",
                "template_then_random",
                "new_card_sort_order_template_then_random",
            ].includes(normalized)
        ) {
            return "template-then-random";
        }
        if (
            [
                "random-note-then-template",
                "random_note_then_template",
                "new_card_sort_order_random_note_then_template",
            ].includes(normalized)
        ) {
            return "random-note-then-template";
        }
        if (["random-card", "random_card", "new_card_sort_order_random_card"].includes(normalized)) {
            return "random-card";
        }
    }

    return undefined;
}

function normalizeReviewSortOrder(mode: SchedulerReviewSortOrder): SchedulerReviewSortOrder {
    switch (mode) {
        case "due-then-deck":
        case "deck-then-due":
        case "interval-ascending":
        case "interval-descending":
        case "ease-ascending":
        case "ease-descending":
        case "retrievability-ascending":
        case "retrievability-descending":
        case "relative-overdueness":
        case "random":
        case "added":
        case "reverse-added":
            return mode;
        default:
            return "due";
    }
}

function normalizeReviewSortOrderUnknown(value: unknown): SchedulerReviewSortOrder | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "due-then-deck";
            case 2:
                return "deck-then-due";
            case 3:
                return "interval-ascending";
            case 4:
                return "interval-descending";
            case 5:
                return "ease-ascending";
            case 6:
                return "ease-descending";
            case 7:
                return "retrievability-ascending";
            case 11:
                return "retrievability-descending";
            case 12:
                return "relative-overdueness";
            case 8:
                return "random";
            case 9:
                return "added";
            case 10:
                return "reverse-added";
            default:
                return "due";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized.length === 0) {
            return undefined;
        }

        if (["due", "day", "review_card_order_day"].includes(normalized)) {
            return "due";
        }
        if (["due-then-deck", "day_then_deck", "review_card_order_day_then_deck"].includes(normalized)) {
            return "due-then-deck";
        }
        if (["deck-then-due", "deck_then_day", "review_card_order_deck_then_day"].includes(normalized)) {
            return "deck-then-due";
        }
        if (["interval-ascending", "intervals_ascending", "review_card_order_intervals_ascending"].includes(normalized)) {
            return "interval-ascending";
        }
        if (["interval-descending", "intervals_descending", "review_card_order_intervals_descending"].includes(normalized)) {
            return "interval-descending";
        }
        if (["ease-ascending", "review_card_order_ease_ascending"].includes(normalized)) {
            return "ease-ascending";
        }
        if (["ease-descending", "review_card_order_ease_descending"].includes(normalized)) {
            return "ease-descending";
        }
        if (["retrievability-ascending", "retrievability_ascending", "review_card_order_retrievability_ascending"].includes(normalized)) {
            return "retrievability-ascending";
        }
        if (["retrievability-descending", "retrievability_descending", "review_card_order_retrievability_descending"].includes(normalized)) {
            return "retrievability-descending";
        }
        if (["relative-overdueness", "relative_overdueness", "review_card_order_relative_overdueness"].includes(normalized)) {
            return "relative-overdueness";
        }
        if (["random", "review_card_order_random"].includes(normalized)) {
            return "random";
        }
        if (["added", "review_card_order_added"].includes(normalized)) {
            return "added";
        }
        if (["reverse-added", "reverse_added", "review_card_order_reverse_added"].includes(normalized)) {
            return "reverse-added";
        }
    }

    return undefined;
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

function normalizeQuestionAction(action: SchedulerQuestionAction): SchedulerQuestionAction {
    return action === "show-reminder" ? "show-reminder" : "show-answer";
}

function normalizeQuestionActionUnknown(value: unknown): SchedulerQuestionAction | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value) === 1 ? "show-reminder" : "show-answer";
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (
            normalized === "show-reminder" ||
            normalized === "show_reminder" ||
            normalized === "question_action_show_reminder"
        ) {
            return "show-reminder";
        }
        if (
            normalized === "show-answer" ||
            normalized === "show_answer" ||
            normalized === "question_action_show_answer"
        ) {
            return "show-answer";
        }
    }

    return undefined;
}

function normalizeAnswerAction(action: SchedulerAnswerAction): SchedulerAnswerAction {
    switch (action) {
        case "answer-again":
        case "answer-good":
        case "answer-hard":
        case "show-reminder":
            return action;
        default:
            return "bury-card";
    }
}

function normalizeAnswerActionUnknown(value: unknown): SchedulerAnswerAction | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        switch (Math.trunc(value)) {
            case 1:
                return "answer-again";
            case 2:
                return "answer-good";
            case 3:
                return "answer-hard";
            case 4:
                return "show-reminder";
            default:
                return "bury-card";
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["answer-again", "answer_again", "answer_action_answer_again"].includes(normalized)) {
            return "answer-again";
        }
        if (["answer-good", "answer_good", "answer_action_answer_good"].includes(normalized)) {
            return "answer-good";
        }
        if (["answer-hard", "answer_hard", "answer_action_answer_hard"].includes(normalized)) {
            return "answer-hard";
        }
        if (["show-reminder", "show_reminder", "answer_action_show_reminder"].includes(normalized)) {
            return "show-reminder";
        }
        if (["bury-card", "bury_card", "answer_action_bury_card"].includes(normalized)) {
            return "bury-card";
        }
    }

    return undefined;
}

function normalizeEasyDaysPercentages(values: readonly number[] | undefined): number[] {
    const fallback = [...DEFAULT_SCHEDULER_CONFIG.easyDaysPercentages];
    if (!values || values.length === 0) {
        return fallback;
    }

    const normalized = fallback.map((defaultValue, index) => {
        const candidate = values[index];
        if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
            return defaultValue;
        }
        return clamp(candidate, 0, 1);
    });

    return normalized;
}

function normalizeEasyDaysPercentagesUnknown(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const numeric = value
        .map((entry) => {
            if (typeof entry !== "number" || !Number.isFinite(entry)) {
                return null;
            }

            return clamp(entry, 0, 1);
        })
        .filter((entry): entry is number => entry !== null);

    if (numeric.length === 0) {
        return undefined;
    }

    return normalizeEasyDaysPercentages(numeric);
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

function invertBoolean(value: unknown): boolean | undefined {
    if (typeof value !== "boolean") {
        return undefined;
    }

    return !value;
}

function numberToBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value !== 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "0" || normalized === "false") {
            return false;
        }
        if (normalized === "1" || normalized === "true") {
            return true;
        }
    }

    return undefined;
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
