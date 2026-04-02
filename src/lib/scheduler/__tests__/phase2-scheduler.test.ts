import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SchedulerAnsweringService } from "@/lib/scheduler/answering";
import { SchedulerEngine } from "@/lib/scheduler/engine";
import { optimizeSchedulerParameters } from "@/lib/scheduler/params";
import { SchedulerQueueBuilder } from "@/lib/scheduler/queue";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { CardQueue, CardType, type Card } from "@/lib/types/card";
import { DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from "@/lib/types/scheduler";

const FIXED_NOW = new Date("2026-04-01T12:00:00.000Z");
const FIXED_DAY = Math.floor(FIXED_NOW.getTime() / (24 * 60 * 60 * 1000));

describe("Phase 2 scheduler domain", () => {
    let manager: CollectionDatabaseManager;
    let connection: CollectionDatabaseConnection;

    beforeEach(async () => {
        manager = new CollectionDatabaseManager({
            persistenceMode: "memory",
            preferOpfs: false,
        });

        await manager.initialize();
        connection = await manager.getConnection();
    });

    afterEach(async () => {
        await manager.close();
    });

    it("generates FSRS transitions for all review ratings", () => {
        const engine = new SchedulerEngine();
        const config: SchedulerConfig = {
            ...DEFAULT_SCHEDULER_CONFIG,
            enableFuzz: false,
            now: FIXED_NOW,
        };

        const card = createCard({
            id: 1001,
            nid: 5001,
            did: 1,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
            ivl: 0,
            factor: 2500,
            reps: 0,
            lapses: 0,
            left: 0,
            data: "",
        });

        const preview = engine.previewCard(card, config, FIXED_NOW);

        expect(preview.again.nextCard.reps).toBeGreaterThan(card.reps);
        expect(preview.hard.nextCard.data).toContain('"scheduler":"fsrs"');
        expect(preview.good.due.getTime()).toBeGreaterThanOrEqual(FIXED_NOW.getTime());
        expect(preview.easy.scheduledDays).toBeGreaterThanOrEqual(preview.hard.scheduledDays);
    });

    it("uses SM-2 fallback when card requests legacy scheduler", () => {
        const engine = new SchedulerEngine();
        const config: SchedulerConfig = {
            ...DEFAULT_SCHEDULER_CONFIG,
            enableFuzz: false,
            now: FIXED_NOW,
        };

        const reviewCard = createCard({
            id: 1002,
            nid: 5002,
            did: 1,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 12,
            factor: 2400,
            reps: 10,
            lapses: 1,
            left: 0,
            data: JSON.stringify({ scheduler: "sm2" }),
        });

        const result = engine.answerCard({
            card: reviewCard,
            rating: "good",
            config,
            now: FIXED_NOW,
            answerMillis: 900,
        });

        expect(result.fsrs).toBeUndefined();
        expect(result.nextCard.queue).toBe(CardQueue.Review);
        expect(result.nextCard.ivl).toBeGreaterThan(reviewCard.ivl);
        expect(result.nextCard.data).toContain('"scheduler":"sm2"');
    });

    it("computes optimization summary from review history", () => {
        const optimized = optimizeSchedulerParameters(
            [
                { ease: 4, ivl: 10 },
                { ease: 3, ivl: 8 },
                { ease: 1, ivl: 2 },
                { ease: 3, ivl: 12 },
            ],
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                requestRetention: 0.9,
                maximumInterval: 30,
            },
        );

        expect(optimized.reviewCount).toBe(4);
        expect(optimized.recallRate).toBe(0.75);
        expect(optimized.requestRetention).toBeLessThan(0.9);
        expect(optimized.maximumInterval).toBeGreaterThanOrEqual(30);
        expect(optimized.weights.length).toBe(21);
    });

    it("builds queue in learn -> review -> new order and applies sibling filtering", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::Demo");

        await notes.create({
            id: 6100,
            guid: "q-note-1",
            mid: 101,
            fields: ["front-1", "back-1"],
        });
        await notes.create({
            id: 6200,
            guid: "q-note-2",
            mid: 101,
            fields: ["front-2", "back-2"],
        });
        await notes.create({
            id: 6300,
            guid: "q-note-3",
            mid: 101,
            fields: ["front-3", "back-3"],
        });
        await notes.create({
            id: 6400,
            guid: "q-note-4",
            mid: 101,
            fields: ["front-4", "back-4"],
        });

        await cards.create({
            id: 7001,
            nid: 6100,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() - 60_000,
        });
        await cards.create({
            id: 7002,
            nid: 6200,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.DayLearning,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7003,
            nid: 6300,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 4,
            factor: 2500,
        });

        // sibling new cards (same note id) should collapse to one when burySiblings=true
        await cards.create({
            id: 7004,
            nid: 6400,
            did: deck.id,
            ord: 1,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7005,
            nid: 6400,
            did: deck.id,
            ord: 2,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                burySiblings: true,
                interdayLearningMix: "before-reviews",
                newReviewMix: "after-reviews",
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 10,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.cards[0].queue).toBe(CardQueue.Learning);
        expect(queue.cards[1].queue).toBe(CardQueue.DayLearning);
        expect(queue.cards[2].queue).toBe(CardQueue.Review);
        expect(queue.cards[3].queue).toBe(CardQueue.New);
        expect(queue.counts.new).toBe(1);
    });

    it("keeps new counts from backfilling outside session scope", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::ScopedNew");

        for (let index = 0; index < 3; index += 1) {
            await notes.create({
                id: 7100 + index,
                guid: `scoped-new-${index}`,
                mid: 101,
                fields: [`front-${index}`, `back-${index}`],
            });

            await cards.create({
                id: 7201 + index,
                nid: 7100 + index,
                did: deck.id,
                ord: 0,
                type: CardType.New,
                queue: CardQueue.New,
                due: FIXED_DAY + index,
            });
        }

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const config: SchedulerConfig = {
            ...DEFAULT_SCHEDULER_CONFIG,
            burySiblings: false,
            limits: {
                learningPerDay: 10,
                reviewsPerDay: 10,
                newPerDay: 2,
            },
        };

        const initial = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config,
        });

        const scopedNewIds = new Set(
            initial.cards
                .filter((card) => card.queue === CardQueue.New)
                .map((card) => card.id),
        );

        expect(scopedNewIds).toEqual(new Set([7201, 7202]));

        await cards.update(7201, {
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() + 60_000,
            ivl: 0,
            left: 1,
        });

        const rebuilt = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config,
            allowedNewCardIds: scopedNewIds,
        });

        expect(rebuilt.counts.new).toBe(1);
        expect(rebuilt.cards.some((card) => card.id === 7203)).toBe(false);
    });

    it("uses learn-ahead cutoff for learning queue and counts", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::DeferredLearning");

        await notes.create({
            id: 7301,
            guid: "deferred-learn-1",
            mid: 101,
            fields: ["front-1", "back-1"],
        });
        await notes.create({
            id: 7302,
            guid: "deferred-learn-2",
            mid: 101,
            fields: ["front-2", "back-2"],
        });
        await notes.create({
            id: 7303,
            guid: "deferred-learn-3",
            mid: 101,
            fields: ["front-3", "back-3"],
        });
        await notes.create({
            id: 7304,
            guid: "deferred-learn-4",
            mid: 101,
            fields: ["front-4", "back-4"],
        });

        await cards.create({
            id: 7401,
            nid: 7301,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() - 1,
            left: 1,
        });
        await cards.create({
            id: 7402,
            nid: 7302,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() + 10 * 60_000,
            left: 1,
        });
        await cards.create({
            id: 7403,
            nid: 7303,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() + 2 * 60 * 60_000,
            left: 1,
        });
        await cards.create({
            id: 7404,
            nid: 7304,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.DayLearning,
            due: FIXED_DAY,
            left: 1,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                learnAheadSeconds: 20 * 60,
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 10,
                    newPerDay: 10,
                },
            },
        });

        // intraday due now -> main queue (interday) -> intraday learn-ahead
        expect(queue.cards).toHaveLength(3);
        expect(queue.cards[0].id).toBe(7401);
        expect(queue.cards[1].id).toBe(7404);
        expect(queue.cards[2].id).toBe(7402);
        expect(queue.cards.some((card) => card.id === 7403)).toBe(false);
        expect(queue.counts.learning).toBe(3);
    });

    it("intersperses review and new cards like Anki", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::Mixing");

        for (let index = 0; index < 5; index += 1) {
            await notes.create({
                id: 7500 + index,
                guid: `mix-note-${index}`,
                mid: 101,
                fields: [`front-${index}`, `back-${index}`],
            });
        }

        await cards.create({
            id: 7601,
            nid: 7500,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7602,
            nid: 7501,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY + 1,
        });
        await cards.create({
            id: 7603,
            nid: 7502,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY + 2,
        });
        await cards.create({
            id: 7604,
            nid: 7503,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7605,
            nid: 7504,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY + 1,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: new Date("2026-04-05T12:00:00.000Z"),
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                newReviewMix: "mix-with-reviews",
                interdayLearningMix: "after-reviews",
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 10,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.cards.map((card) => card.id)).toEqual([7601, 7604, 7602, 7605, 7603]);
        expect(queue.counts.review).toBe(3);
        expect(queue.counts.new).toBe(2);
    });

    it("consumes review limit with interday learning before review cards", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::ReviewLimit");

        for (let index = 0; index < 4; index += 1) {
            await notes.create({
                id: 7700 + index,
                guid: `limit-note-${index}`,
                mid: 101,
                fields: [`front-${index}`, `back-${index}`],
            });
        }

        await cards.create({
            id: 7801,
            nid: 7700,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.DayLearning,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7802,
            nid: 7701,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.DayLearning,
            due: FIXED_DAY + 1,
        });
        await cards.create({
            id: 7803,
            nid: 7702,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7804,
            nid: 7703,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY + 1,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: new Date("2026-04-05T12:00:00.000Z"),
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                interdayLearningMix: "after-reviews",
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 2,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.cards.map((card) => card.id)).toEqual([7801, 7802]);
        expect(queue.counts.learning).toBe(2);
        expect(queue.counts.review).toBe(0);
    });

    it("answers card, writes revlog, marks leech, and buries siblings", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);

        const deck = await decks.create("Answer::Demo");
        await notes.create({
            id: 8000,
            guid: "a-note",
            mid: 101,
            fields: ["question", "answer"],
        });

        await cards.create({
            id: 8101,
            nid: 8000,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 6,
            factor: 2300,
            reps: 5,
            lapses: 0,
            data: JSON.stringify({ scheduler: "sm2" }),
        });

        await cards.create({
            id: 8102,
            nid: 8000,
            did: deck.id,
            ord: 1,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 6,
            factor: 2300,
            reps: 5,
            lapses: 0,
            data: JSON.stringify({ scheduler: "sm2" }),
        });

        const service = new SchedulerAnsweringService(connection, new SchedulerEngine());
        const result = await service.answerCardById(
            8101,
            "again",
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                leechThreshold: 1,
                burySiblings: true,
            },
            FIXED_NOW,
            1200,
        );

        expect(result.leechDetected).toBe(true);
        expect(result.buriedSiblingCardIds).toEqual([8102]);

        const updatedCard = await cards.getById(8101);
        expect(updatedCard?.flags && (updatedCard.flags & 0x80)).toBeTruthy();
        expect(updatedCard?.queue).toBe(CardQueue.Learning);

        const siblingCard = await cards.getById(8102);
        expect(siblingCard?.queue).toBe(CardQueue.SchedBuried);

        const logs = await revlog.listByCardId(8101);
        expect(logs.length).toBe(1);
        expect(logs[0].ease).toBe(1);
    });
});

function createCard(input: Partial<Card> & Pick<Card, "id" | "nid" | "did" | "ord">): Card {
    return {
        id: input.id,
        nid: input.nid,
        did: input.did,
        ord: input.ord,
        mod: input.mod ?? FIXED_NOW.getTime(),
        usn: input.usn ?? 0,
        type: input.type ?? CardType.New,
        queue: input.queue ?? CardQueue.New,
        due: input.due ?? FIXED_DAY,
        ivl: input.ivl ?? 0,
        factor: input.factor ?? 2500,
        reps: input.reps ?? 0,
        lapses: input.lapses ?? 0,
        left: input.left ?? 0,
        odue: input.odue ?? 0,
        odid: input.odid ?? 0,
        flags: input.flags ?? 0,
        data: input.data ?? "",
    };
}
