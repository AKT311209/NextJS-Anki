import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardQueue, type Card } from "@/lib/types/card";
import type { QueueBuildRequest, QueueBuildResult } from "@/lib/types/scheduler";
import { toDayNumber } from "@/lib/scheduler/states";

export class SchedulerQueueBuilder {
    public constructor(private readonly connection: CollectionDatabaseConnection) { }

    public async buildQueue(request: QueueBuildRequest): Promise<QueueBuildResult> {
        const now = request.now;
        const nowMs = now.getTime();
        const today = toDayNumber(now);
        const buriedIds = request.buriedCardIds ?? new Set<number>();

        const [learningIntraday, learningInterday, reviewCards, newCards] = await Promise.all([
            this.selectDueCards(CardQueue.Learning, nowMs, request.deckId),
            this.selectDueCards(CardQueue.DayLearning, today, request.deckId),
            this.selectDueCards(CardQueue.Review, today, request.deckId),
            this.selectDueCards(CardQueue.New, Number.MAX_SAFE_INTEGER, request.deckId),
        ]);

        const selectedLearning = this.filterVisibleCards([...learningIntraday, ...learningInterday], buriedIds).slice(
            0,
            request.config.limits.learningPerDay,
        );

        const selectedReview = this.filterVisibleCards(reviewCards, buriedIds).slice(
            0,
            request.config.limits.reviewsPerDay,
        );

        const selectedNew = this.filterVisibleCards(newCards, buriedIds).slice(
            0,
            request.config.limits.newPerDay,
        );

        let cards = [...selectedLearning, ...selectedReview, ...selectedNew];
        if (request.config.burySiblings) {
            cards = keepFirstCardPerNote(cards);
        }

        const counts = {
            learning: cards.filter((card) => card.queue === CardQueue.Learning || card.queue === CardQueue.DayLearning).length,
            review: cards.filter((card) => card.queue === CardQueue.Review).length,
            new: cards.filter((card) => card.queue === CardQueue.New).length,
        };

        return {
            now,
            cards,
            counts,
        };
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
