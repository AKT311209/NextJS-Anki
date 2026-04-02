import { SchedulerEngine } from "@/lib/scheduler/engine";
import { resolveSchedulerConfig } from "@/lib/scheduler/params";
import { burySiblingCards } from "@/lib/scheduler/burying";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import type { Card } from "@/lib/types/card";
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
        const result = await this.engine.answerCard({
            ...input,
            config,
        });
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
