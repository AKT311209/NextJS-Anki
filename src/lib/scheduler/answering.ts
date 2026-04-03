import { SchedulerEngine } from "@/lib/scheduler/engine";
import { constrainedFuzzBounds, fuzzLearningIntervalSeconds } from "@/lib/scheduler/fuzz";
import { resolveSchedulerConfig } from "@/lib/scheduler/params";
import { fromDayNumber, readCardData, toDayNumber } from "@/lib/scheduler/states";
import { burySiblingCards } from "@/lib/scheduler/burying";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { CardQueue, type Card } from "@/lib/types/card";
import type { AnswerCardInput, AnswerCardResult, ReviewRating, SchedulerConfig } from "@/lib/types/scheduler";

export interface PersistedAnswerCardResult extends AnswerCardResult {
    readonly buriedSiblingCardIds: readonly number[];
}

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
        const rawResult = await this.engine.answerCard({
            ...input,
            config,
            answerMillis: cappedAnswerMillis,
        });
        const fuzzedResult = applyLearningDelayFuzz(rawResult, input.now);
        const result = await applyEasyDaysScheduling(this.connection, fuzzedResult, config, input.now);
        await this.persistResult(result);

        let buriedSiblingCardIds: number[] = [];
        const shouldBurySiblings =
            config.burySiblings ||
            config.buryNew ||
            config.buryReviews ||
            config.buryInterdayLearning;

        if (shouldBurySiblings) {
            buriedSiblingCardIds = await burySiblingCards(this.connection, {
                card: result.nextCard,
                mode: "scheduler",
                restrictToDeckId: result.nextCard.did,
                buryMode: {
                    buryNew: config.buryNew,
                    buryReviews: config.buryReviews,
                    buryInterdayLearning: config.buryInterdayLearning,
                },
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

async function applyEasyDaysScheduling(
    connection: CollectionDatabaseConnection,
    result: AnswerCardResult,
    config: SchedulerConfig,
    now: Date,
): Promise<AnswerCardResult> {
    if (!config.useFsrs || !result.fsrs || result.nextCard.queue !== CardQueue.Review) {
        return result;
    }

    if (!hasCustomizedEasyDays(config.easyDaysPercentages)) {
        return result;
    }

    const today = toDayNumber(now);
    const desiredDueDay = Math.max(today + 1, result.nextCard.due);
    const desiredIntervalDays = Math.max(1, desiredDueDay - today);
    const [lowerOffset, upperOffset] = constrainedFuzzBounds(
        desiredIntervalDays,
        Math.max(1, config.minimumInterval),
        config.maximumInterval,
    );

    if (upperOffset <= lowerOffset) {
        return result;
    }

    const lowerDay = today + lowerOffset;
    const upperDay = today + upperOffset;
    const loadRows = await connection.select<{ due: number; count: number }>(
        `
        SELECT due, COUNT(*) as count
        FROM cards
        WHERE did = ?
          AND queue IN (?, ?)
          AND due >= ?
          AND due <= ?
        GROUP BY due
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
    for (const row of loadRows) {
        loadByDay.set(Math.trunc(row.due), Math.max(0, Math.trunc(row.count)));
    }

    let bestDay = desiredDueDay;
    let bestWeight = Number.NEGATIVE_INFINITY;

    for (let day = lowerDay; day <= upperDay; day += 1) {
        const dayLoad = (loadByDay.get(day) ?? 0) + 1;
        const intervalDays = Math.max(1, day - today);
        const easyModifier = easyDayModifier(config.easyDaysPercentages[weekdayIndex(day)] ?? 1);
        const loadWeight = 1 / Math.pow(dayLoad, 2.15);
        const intervalWeight = 1 / Math.pow(intervalDays, 3);
        const distanceWeight = 1 / (1 + Math.abs(day - desiredDueDay));
        const weight = easyModifier * loadWeight * intervalWeight * distanceWeight;

        const isBetter =
            weight > bestWeight ||
            (weight === bestWeight && Math.abs(day - desiredDueDay) < Math.abs(bestDay - desiredDueDay));

        if (isBetter) {
            bestWeight = weight;
            bestDay = day;
        }
    }

    if (bestDay === desiredDueDay) {
        return result;
    }

    const scheduledDays = Math.max(1, bestDay - today);
    const due = fromDayNumber(bestDay);
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

function hasCustomizedEasyDays(percentages: readonly number[]): boolean {
    return percentages.some((value) => Math.abs(value - 1) > 0.0001);
}

function easyDayModifier(percentage: number): number {
    if (!Number.isFinite(percentage)) {
        return 1;
    }

    if (percentage <= 0) {
        return 0.0001;
    }

    if (percentage >= 1) {
        return 1;
    }

    return Math.max(0.0001, percentage);
}

function weekdayIndex(dayNumber: number): number {
    const date = fromDayNumber(dayNumber);
    const sundayFirst = date.getDay();
    return (sundayFirst + 6) % 7;
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
