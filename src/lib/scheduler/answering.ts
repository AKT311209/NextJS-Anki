import { SchedulerEngine } from "@/lib/scheduler/engine";
import { constrainedFuzzBounds, fuzzLearningIntervalSeconds } from "@/lib/scheduler/fuzz";
import { resolveSchedulerConfig } from "@/lib/scheduler/params";
import { fromDayNumber, readCardData, toDayNumber } from "@/lib/scheduler/states";
import { burySiblingCards, type SiblingBuryMode } from "@/lib/scheduler/burying";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { CardQueue, type Card } from "@/lib/types/card";
import { RevlogReviewKind } from "@/lib/types/revlog";
import type { AnswerCardInput, AnswerCardResult, ReviewRating, SchedulerConfig } from "@/lib/types/scheduler";

export interface PersistedAnswerCardResult extends AnswerCardResult {
    readonly buriedSiblingCardIds: readonly number[];
}

const MAX_LOAD_BALANCE_INTERVAL_DAYS = 90;
const SIBLING_PENALTY = 0.001;

export class SchedulerAnsweringService {
    private readonly cards: CardsRepository;
    private readonly revlog: RevlogRepository;

    public constructor(
        private readonly connection: CollectionDatabaseConnection,
        private readonly engine: SchedulerEngine = new SchedulerEngine(),
    ) {
        this.cards = new CardsRepository(connection);
        this.revlog = new RevlogRepository(connection);
    }

    public async answerCard(input: AnswerCardInput): Promise<PersistedAnswerCardResult> {
        const config = resolveSchedulerConfig(input.config);
        const cappedAnswerMillis = capAnswerMillis(input.answerMillis, config.capAnswerTimeToSecs);
        const rawResult = input.card.queue === CardQueue.Preview
            ? answerPreviewCard({
                ...input,
                config,
                answerMillis: cappedAnswerMillis,
            })
            : this.engine.answerCard({
                ...input,
                config,
                answerMillis: cappedAnswerMillis,
            });
        const restoredFilteredResult = restoreFilteredReschedulingCard(rawResult);
        const fuzzedResult = applyLearningDelayFuzz(restoredFilteredResult, input.now);
        const result = await applyEasyDaysScheduling(this.connection, fuzzedResult, config, input.now);
        await this.persistResult(result);

        let buriedSiblingCardIds: number[] = [];
        const requestedBuryMode = {
            buryNew: config.buryNew,
            buryReviews: config.buryReviews,
            buryInterdayLearning: config.buryInterdayLearning,
        };
        const effectiveBuryMode = excludeEarlierGatheredQueuesForBury(
            requestedBuryMode,
            result.previousCard.queue,
        );
        const shouldBurySiblings =
            config.burySiblings ||
            effectiveBuryMode.buryNew ||
            effectiveBuryMode.buryReviews ||
            effectiveBuryMode.buryInterdayLearning;

        if (shouldBurySiblings) {
            buriedSiblingCardIds = await burySiblingCards(this.connection, {
                card: result.nextCard,
                mode: "scheduler",
                buryMode: effectiveBuryMode,
            });
        }

        return {
            ...result,
            buriedSiblingCardIds,
        };
    }

    public async answerCardById(
        cardId: number,
        rating: ReviewRating,
        config: SchedulerConfig,
        now: Date,
        answerMillis = 0,
    ): Promise<PersistedAnswerCardResult> {
        const existingCard = await this.cards.getById(cardId);
        if (!existingCard) {
            throw new Error(`Card ${cardId} was not found`);
        }

        return this.answerCard({
            card: existingCard,
            rating,
            config,
            now,
            answerMillis,
        });
    }

    private async persistResult(result: AnswerCardResult): Promise<void> {
        const patch = toCardPatch(result.nextCard);
        await this.cards.update(result.nextCard.id, patch);

        await this.revlog.insert({
            ...result.revlog,
            usn: result.revlog.usn ?? result.nextCard.usn,
        });
    }
}

function capAnswerMillis(answerMillis: number, capSeconds: number): number {
    const normalizedCapSeconds = Math.min(7200, Math.max(1, Math.trunc(capSeconds)));
    const normalizedAnswerMillis = Math.max(0, Math.trunc(answerMillis));

    return Math.min(normalizedAnswerMillis, normalizedCapSeconds * 1000);
}

function applyLearningDelayFuzz(result: AnswerCardResult, now: Date): AnswerCardResult {
    if (result.nextCard.queue !== CardQueue.Learning) {
        return result;
    }

    const scheduledSeconds = Math.max(0, Math.trunc((result.nextCard.due - now.getTime()) / 1000));
    const fuzzedSeconds = fuzzLearningIntervalSeconds(scheduledSeconds, {
        cardId: result.previousCard.id,
        reps: result.previousCard.reps,
    });

    if (fuzzedSeconds === scheduledSeconds) {
        return result;
    }

    const dueMs = now.getTime() + fuzzedSeconds * 1000;

    return {
        ...result,
        due: new Date(dueMs),
        nextCard: {
            ...result.nextCard,
            due: dueMs,
        },
    };
}

function answerPreviewCard(input: AnswerCardInput): AnswerCardResult {
    const nowMs = input.now.getTime();
    const originalDeckId = input.card.odid !== 0 ? input.card.odid : input.card.did;
    const originalDue = input.card.odue !== 0 ? input.card.odue : input.card.due;
    const delaySeconds = previewDelaySeconds(input.rating, input.config);
    const shouldFinishPreview = input.rating === "easy" || delaySeconds <= 0;

    const nextQueue = shouldFinishPreview
        ? restoreQueueFromTypeAndDue(input.card.type, originalDue)
        : CardQueue.Preview;

    const restoredDue = shouldFinishPreview
        ? (nextQueue === CardQueue.Learning ? normalizeIntradayDueToMilliseconds(originalDue) : originalDue)
        : nowMs + delaySeconds * 1000;

    const nextCard: Card = {
        ...input.card,
        did: shouldFinishPreview ? originalDeckId : input.card.did,
        queue: nextQueue,
        due: restoredDue,
        odid: shouldFinishPreview ? 0 : input.card.odid,
        odue: shouldFinishPreview ? 0 : input.card.odue,
        mod: nowMs,
    };

    const due = shouldFinishPreview
        ? previewRestoreDueDate(nextCard, input.now, input.config.collectionDayOffset)
        : new Date(restoredDue);

    return {
        previousCard: input.card,
        nextCard,
        rating: input.rating,
        due,
        scheduledDays: nextCard.ivl,
        revlog: {
            id: buildPreviewRevlogId(input.now, input.card.id, input.rating),
            cid: input.card.id,
            usn: input.card.usn,
            ease: ratingToEase(input.rating),
            ivl: nextCard.ivl,
            lastIvl: input.card.ivl,
            factor: nextCard.factor,
            time: Math.max(0, Math.trunc(input.answerMillis)),
            type: RevlogReviewKind.Filtered,
        },
        leechDetected: false,
    };
}

function restoreFilteredReschedulingCard(result: AnswerCardResult): AnswerCardResult {
    if (result.previousCard.odid === 0 || result.previousCard.queue === CardQueue.Preview) {
        return result;
    }

    const nextCard = {
        ...result.nextCard,
        did: result.previousCard.odid,
        odid: 0,
        odue: 0,
    };

    return {
        ...result,
        nextCard,
    };
}

function previewDelaySeconds(rating: ReviewRating, config: SchedulerConfig): number {
    if (rating === "again") {
        return Math.max(0, Math.trunc(config.previewAgainSeconds));
    }
    if (rating === "hard") {
        return Math.max(0, Math.trunc(config.previewHardSeconds));
    }
    if (rating === "good") {
        return Math.max(0, Math.trunc(config.previewGoodSeconds));
    }

    return 0;
}

function restoreQueueFromTypeAndDue(type: number, due: number): CardQueue {
    if (type === 0) {
        return CardQueue.New;
    }

    if (type === 2) {
        return CardQueue.Review;
    }

    if (type === 1 || type === 3) {
        return due > 1_000_000_000 ? CardQueue.Learning : CardQueue.DayLearning;
    }

    return CardQueue.Review;
}

function normalizeIntradayDueToMilliseconds(due: number): number {
    const normalized = Math.trunc(due);
    if (normalized > 1_000_000_000 && normalized < 1_000_000_000_000) {
        return normalized * 1000;
    }

    return normalized;
}

function previewRestoreDueDate(nextCard: Card, now: Date, collectionDayOffset: number): Date {
    if (nextCard.queue === CardQueue.Learning) {
        return new Date(normalizeIntradayDueToMilliseconds(nextCard.due));
    }

    if (nextCard.queue === CardQueue.DayLearning || nextCard.queue === CardQueue.Review || nextCard.queue === CardQueue.New) {
        return fromDayNumber(nextCard.due, undefined, collectionDayOffset);
    }

    return now;
}

function buildPreviewRevlogId(now: Date, cardId: number, rating: ReviewRating): number {
    const base = now.getTime() * 10;
    const offset = rating === "again" ? 1 : rating === "hard" ? 2 : rating === "good" ? 3 : 4;
    const cardEntropy = Math.abs(cardId % 10);
    return base + ((offset + cardEntropy) % 10);
}

function ratingToEase(rating: ReviewRating): number {
    if (rating === "again") {
        return 1;
    }
    if (rating === "hard") {
        return 2;
    }
    if (rating === "good") {
        return 3;
    }
    return 4;
}

async function applyEasyDaysScheduling(
    connection: CollectionDatabaseConnection,
    result: AnswerCardResult,
    config: SchedulerConfig,
    now: Date,
): Promise<AnswerCardResult> {
    if (!config.useFsrs || !result.fsrs || result.nextCard.queue !== CardQueue.Review) {
        return result;
    }

    const today = toDayNumber(now, undefined, config.collectionDayOffset);
    const desiredDueDay = Math.max(today + 1, result.nextCard.due);
    const desiredIntervalDays = Math.max(1, desiredDueDay - today);

    if (desiredIntervalDays > MAX_LOAD_BALANCE_INTERVAL_DAYS) {
        return result;
    }

    const [lowerOffset, upperOffset] = constrainedFuzzBounds(
        desiredIntervalDays,
        Math.max(1, config.minimumInterval),
        config.maximumInterval,
    );

    if (upperOffset <= lowerOffset || lowerOffset > MAX_LOAD_BALANCE_INTERVAL_DAYS) {
        return result;
    }

    const lowerDay = today + lowerOffset;
    const upperDay = today + Math.min(upperOffset, MAX_LOAD_BALANCE_INTERVAL_DAYS);
    const loadRows = await connection.select<{ due: number; nid: number }>(
        `
        SELECT due, nid
        FROM cards
        WHERE did = ?
          AND queue IN (?, ?)
          AND due >= ?
          AND due <= ?
        `,
        [
            result.nextCard.did,
            CardQueue.Review,
            CardQueue.DayLearning,
            lowerDay,
            upperDay,
        ],
    );

    const loadByDay = new Map<number, number>();
    const notesByDay = new Map<number, Set<number>>();
    for (const row of loadRows) {
        const day = Math.trunc(row.due);
        loadByDay.set(day, (loadByDay.get(day) ?? 0) + 1);

        if (!notesByDay.has(day)) {
            notesByDay.set(day, new Set<number>());
        }
        notesByDay.get(day)?.add(Math.trunc(row.nid));
    }

    const candidateDays: number[] = [];
    const reviewCounts: number[] = [];
    const weekdays: number[] = [];

    for (let day = lowerDay; day <= upperDay; day += 1) {
        candidateDays.push(day);
        reviewCounts.push(loadByDay.get(day) ?? 0);
        weekdays.push(weekdayIndex(day, config.collectionDayOffset));
    }

    const easyDayModifiers = calculateEasyDayModifiers(config.easyDaysPercentages, weekdays, reviewCounts);
    const weights = candidateDays.map((day, index) => {
        const targetInterval = Math.max(1, day - today);
        const reviewCount = reviewCounts[index] ?? 0;
        const siblingModifier = notesByDay.get(day)?.has(result.nextCard.nid) ? SIBLING_PENALTY : 1;
        const easyModifier = easyDayModifiers[index] ?? 1;

        if (reviewCount === 0) {
            return 1;
        }

        const cardCountWeight = Math.pow(1 / reviewCount, 2.15);
        const cardIntervalWeight = Math.pow(1 / targetInterval, 3);
        return cardCountWeight * cardIntervalWeight * siblingModifier * easyModifier;
    });

    const seededRandom = mulberry32((Math.max(0, result.previousCard.id + result.previousCard.reps)) >>> 0);
    const bestDay = selectWeightedDay(candidateDays, weights, seededRandom) ?? desiredDueDay;

    if (bestDay === desiredDueDay) {
        return result;
    }

    const scheduledDays = Math.max(1, bestDay - today);
    const due = fromDayNumber(bestDay, undefined, config.collectionDayOffset);
    const cardData = readCardData(result.nextCard);
    const fsrs = cardData.fsrs;
    const nextData = fsrs && typeof fsrs === "object"
        ? JSON.stringify({
            ...cardData,
            fsrs: {
                ...fsrs,
                scheduledDays,
            },
        })
        : result.nextCard.data;

    return {
        ...result,
        due,
        scheduledDays,
        fsrs: {
            ...result.fsrs,
            scheduledDays,
        },
        nextCard: {
            ...result.nextCard,
            due: bestDay,
            ivl: scheduledDays,
            data: nextData,
        },
    };
}

function weekdayIndex(dayNumber: number, collectionDayOffset: number): number {
    const date = fromDayNumber(dayNumber, undefined, collectionDayOffset);
    const sundayFirst = date.getDay();
    return (sundayFirst + 6) % 7;
}

function easyDayLoadModifier(percentage: number): number {
    if (!Number.isFinite(percentage) || percentage >= 1) {
        return 1;
    }

    if (percentage <= 0) {
        return 0.0001;
    }

    return 0.5;
}

function calculateEasyDayModifiers(
    easyDaysPercentages: readonly number[],
    weekdays: readonly number[],
    reviewCounts: readonly number[],
): number[] {
    const totalReviewCount = reviewCounts.reduce((sum, count) => sum + count, 0);
    const totalPercent = weekdays.reduce(
        (sum, weekday) => sum + easyDayLoadModifier(easyDaysPercentages[weekday] ?? 1),
        0,
    );

    return weekdays.map((weekday, index) => {
        const dayModifier = easyDayLoadModifier(easyDaysPercentages[weekday] ?? 1);
        if (dayModifier !== 0.5) {
            return dayModifier;
        }

        const reviewCount = reviewCounts[index] ?? 0;
        const otherReviewTotal = totalReviewCount - reviewCount;
        const otherPercentTotal = Math.max(0.0001, totalPercent - 0.5);
        const normalizedCount = reviewCount / 0.5;
        const reducedDayThreshold = otherReviewTotal / otherPercentTotal;

        return normalizedCount > reducedDayThreshold ? 0.0001 : 1;
    });
}

function selectWeightedDay(days: readonly number[], weights: readonly number[], random: () => number): number | null {
    if (days.length === 0 || days.length !== weights.length) {
        return null;
    }

    const totalWeight = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return null;
    }

    const threshold = random() * totalWeight;
    let cumulative = 0;

    for (let index = 0; index < days.length; index += 1) {
        const weight = weights[index];
        if (!Number.isFinite(weight) || weight <= 0) {
            continue;
        }

        cumulative += weight;
        if (cumulative >= threshold) {
            return days[index] ?? null;
        }
    }

    return days[days.length - 1] ?? null;
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

function toCardPatch(card: Card): Omit<Card, "id"> {
    return {
        nid: card.nid,
        did: card.did,
        ord: card.ord,
        mod: card.mod,
        usn: card.usn,
        type: card.type,
        queue: card.queue,
        due: card.due,
        ivl: card.ivl,
        factor: card.factor,
        reps: card.reps,
        lapses: card.lapses,
        left: card.left,
        odue: card.odue,
        odid: card.odid,
        flags: card.flags,
        data: card.data,
    };
}

function excludeEarlierGatheredQueuesForBury(
    mode: SiblingBuryMode,
    answeredQueue: number,
): SiblingBuryMode {
    const answeredOrder = gatherOrder(answeredQueue);

    return {
        buryNew: mode.buryNew,
        buryReviews: mode.buryReviews && answeredOrder <= gatherOrder(CardQueue.Review),
        buryInterdayLearning:
            mode.buryInterdayLearning && answeredOrder <= gatherOrder(CardQueue.DayLearning),
    };
}

function gatherOrder(queue: number): number {
    if (queue === CardQueue.Learning || queue === CardQueue.Preview) {
        return 0;
    }
    if (queue === CardQueue.DayLearning) {
        return 1;
    }
    if (queue === CardQueue.Review) {
        return 2;
    }
    if (queue === CardQueue.New) {
        return 3;
    }

    return Number.MAX_SAFE_INTEGER;
}
