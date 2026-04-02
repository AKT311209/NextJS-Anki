import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardQueue, type Card } from "@/lib/types/card";
import type {
    QueueBuildRequest,
    QueueBuildResult,
    SchedulerReviewMix,
} from "@/lib/types/scheduler";
import { toDayNumber } from "@/lib/scheduler/states";

export class SchedulerQueueBuilder {
    public constructor(private readonly connection: CollectionDatabaseConnection) { }

    public async buildQueue(request: QueueBuildRequest): Promise<QueueBuildResult> {
        const now = request.now;
        const nowMs = now.getTime();
        const learnAheadCutoffMs = nowMs + request.config.learnAheadSeconds * 1000;
        const today = toDayNumber(now);
        const buriedIds = request.buriedCardIds ?? new Set<number>();

        const [
            learningIntradayDueNow,
            learningIntradayDueAhead,
            learningInterdayDue,
            reviewCards,
            allNewCards,
        ] = await Promise.all([
            this.selectCardsByDueRange(CardQueue.Learning, undefined, nowMs, request.deckId),
            this.selectCardsByDueRange(CardQueue.Learning, nowMs + 1, learnAheadCutoffMs, request.deckId),
            this.selectDueCards(CardQueue.DayLearning, today, request.deckId),
            this.selectDueCards(CardQueue.Review, today, request.deckId),
            this.selectDueCards(CardQueue.New, Number.MAX_SAFE_INTEGER, request.deckId),
        ]);

        const allowedNewCardIds = request.allowedNewCardIds;
        const newCards = allowedNewCardIds
            ? allNewCards.filter((card) => allowedNewCardIds.has(card.id))
            : allNewCards;

        const intradayNow = this.filterVisibleCards(learningIntradayDueNow, buriedIds);
        const intradayAhead = this.filterVisibleCards(learningIntradayDueAhead, buriedIds);
        const interday = this.filterVisibleCards(learningInterdayDue, buriedIds);
        const review = this.filterVisibleCards(reviewCards, buriedIds);
        const fresh = this.filterVisibleCards(newCards, buriedIds);

        // Mirrors Anki gather ordering, where interday learning cards consume review limits first.
        const selectedInterday = interday.slice(0, request.config.limits.reviewsPerDay);
        const remainingReviewSlots = Math.max(0, request.config.limits.reviewsPerDay - selectedInterday.length);
        const selectedReview = review.slice(0, remainingReviewSlots);
        const selectedNew = fresh.slice(0, request.config.limits.newPerDay);

        const mainDue = mergeByReviewMix(selectedReview, selectedInterday, request.config.interdayLearningMix);
        const main = mergeByReviewMix(mainDue, selectedNew, request.config.newReviewMix);

        let cards = [...intradayNow, ...main, ...intradayAhead];
        if (request.config.burySiblings) {
            cards = keepFirstCardPerNote(cards);
        }

        const counts = summarizeCounts(cards);

        return {
            now,
            cards,
            counts,
        };
    }

    private async selectCardsByDueRange(
        queue: CardQueue,
        minDue: number | undefined,
        maxDue: number,
        deckId?: number,
    ): Promise<Card[]> {
        if (minDue !== undefined && minDue > maxDue) {
            return [];
        }

        const minDueSql = minDue === undefined ? "" : "AND due >= ?";
        const minDueParams = minDue === undefined ? [] : [minDue];

        if (deckId !== undefined) {
            return this.connection.select<Card>(
                `
                SELECT *
                FROM cards
                WHERE queue = ?
                  AND did = ?
                  ${minDueSql}
                  AND due <= ?
                ORDER BY due ASC, id ASC
                `,
                [queue, deckId, ...minDueParams, maxDue],
            );
        }

        return this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              ${minDueSql}
              AND due <= ?
            ORDER BY due ASC, id ASC
            `,
            [queue, ...minDueParams, maxDue],
        );
    }

    private async selectDueCards(queue: CardQueue, maxDue: number, deckId?: number): Promise<Card[]> {
        if (deckId !== undefined) {
            return this.connection.select<Card>(
                `
				SELECT *
				FROM cards
				WHERE queue = ?
				  AND did = ?
				  AND due <= ?
				ORDER BY due ASC, id ASC
				`,
                [queue, deckId, maxDue],
            );
        }

        return this.connection.select<Card>(
            `
			SELECT *
			FROM cards
			WHERE queue = ?
			  AND due <= ?
			ORDER BY due ASC, id ASC
			`,
            [queue, maxDue],
        );
    }

    private filterVisibleCards(cards: Card[], buriedIds: ReadonlySet<number>): Card[] {
        return cards.filter((card) => {
            if (buriedIds.has(card.id)) {
                return false;
            }
            if (card.queue === CardQueue.Suspended || card.queue === CardQueue.SchedBuried || card.queue === CardQueue.UserBuried) {
                return false;
            }
            return true;
        });
    }
}

function summarizeCounts(cards: readonly Card[]): QueueBuildResult["counts"] {
    return {
        learning: cards
            .filter((card) => card.queue === CardQueue.Learning || card.queue === CardQueue.DayLearning)
            .length,
        review: cards.filter((card) => card.queue === CardQueue.Review).length,
        new: cards.filter((card) => card.queue === CardQueue.New).length,
    };
}

function mergeByReviewMix<T>(
    reviews: readonly T[],
    alternate: readonly T[],
    mode: SchedulerReviewMix,
): T[] {
    if (mode === "before-reviews") {
        return [...alternate, ...reviews];
    }
    if (mode === "after-reviews") {
        return [...reviews, ...alternate];
    }
    return intersperse(reviews, alternate);
}

function intersperse<T>(one: readonly T[], two: readonly T[]): T[] {
    const merged: T[] = [];
    let oneIndex = 0;
    let twoIndex = 0;

    const ratio = (one.length + 1) / (two.length + 1);

    while (oneIndex < one.length || twoIndex < two.length) {
        if (oneIndex < one.length && twoIndex < two.length) {
            const relativeTwoIndex = (twoIndex + 1) * ratio;
            if (relativeTwoIndex < oneIndex + 1) {
                merged.push(two[twoIndex]);
                twoIndex += 1;
            } else {
                merged.push(one[oneIndex]);
                oneIndex += 1;
            }
            continue;
        }

        if (oneIndex < one.length) {
            merged.push(one[oneIndex]);
            oneIndex += 1;
            continue;
        }

        merged.push(two[twoIndex]);
        twoIndex += 1;
    }

    return merged;
}

function keepFirstCardPerNote(cards: Card[]): Card[] {
    const seen = new Set<number>();
    const output: Card[] = [];

    for (const card of cards) {
        if (seen.has(card.nid)) {
            continue;
        }
        seen.add(card.nid);
        output.push(card);
    }

    return output;
}
