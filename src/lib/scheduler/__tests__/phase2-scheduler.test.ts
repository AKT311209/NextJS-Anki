import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SchedulerAnsweringService } from "@/lib/scheduler/answering";
import { SchedulerEngine } from "@/lib/scheduler/engine";
import { optimizeSchedulerParameters } from "@/lib/scheduler/params";
import { SchedulerQueueBuilder } from "@/lib/scheduler/queue";
import { toDayNumber } from "@/lib/scheduler/states";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { CardQueue, CardType, type Card } from "@/lib/types/card";
import { RevlogReviewKind } from "@/lib/types/revlog";
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

    it("generates FSRS transitions for all review ratings", async () => {
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

        const preview = await engine.previewCard(card, config, FIXED_NOW);

        expect(preview.again.nextCard.reps).toBeGreaterThan(card.reps);
        expect(preview.hard.nextCard.data).toContain('"scheduler":"fsrs"');
        expect(preview.good.due.getTime()).toBeGreaterThanOrEqual(FIXED_NOW.getTime());
        expect(preview.easy.scheduledDays).toBeGreaterThanOrEqual(preview.hard.scheduledDays);
    });

    it("uses SM-2 fallback when card requests legacy scheduler", async () => {
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

        const result = await engine.answerCard({
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
                { id: 1_001, cid: 700_001, ease: 4, ivl: 10, type: RevlogReviewKind.Review },
                { id: 1_002, cid: 700_001, ease: 3, ivl: 8, type: RevlogReviewKind.Review },
                { id: 2_001, cid: 700_002, ease: 1, ivl: 2, type: RevlogReviewKind.Relearning },
                { id: 2_002, cid: 700_002, ease: 3, ivl: 12, type: RevlogReviewKind.Review },
            ],
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                requestRetention: 0.9,
                maximumInterval: 30,
            },
        );

        expect(optimized.reviewCount).toBe(4);
        expect(optimized.recallRate).toBe(0.75);
        expect(optimized.requestRetention).toBe(0.9);
        expect(optimized.maximumInterval).toBe(30);
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

    it("mixes learn-ahead learning with new cards when mix mode is enabled", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::LearnAheadMix");

        for (let index = 0; index < 4; index += 1) {
            await notes.create({
                id: 7450 + index,
                guid: `learn-ahead-mix-${index}`,
                mid: 101,
                fields: [`front-${index}`, `back-${index}`],
            });
        }

        await cards.create({
            id: 7461,
            nid: 7450,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7462,
            nid: 7451,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY + 1,
        });
        await cards.create({
            id: 7463,
            nid: 7452,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY + 2,
        });
        await cards.create({
            id: 7464,
            nid: 7453,
            did: deck.id,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime() + 10 * 60_000,
            left: 1,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                learnAheadSeconds: 20 * 60,
                newReviewMix: "mix-with-reviews",
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 10,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.cards.map((card) => card.id)).toEqual([7461, 7462, 7464, 7463]);
        expect(queue.counts.new).toBe(3);
        expect(queue.counts.learning).toBe(1);
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

    it("caps new cards by remaining review limit unless explicitly ignored", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Queue::ReviewCap");

        for (let index = 0; index < 5; index += 1) {
            await notes.create({
                id: 7900 + index,
                guid: `review-cap-${index}`,
                mid: 101,
                fields: [`front-${index}`, `back-${index}`],
            });
        }

        await cards.create({
            id: 7911,
            nid: 7900,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7912,
            nid: 7901,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
        });

        await cards.create({
            id: 7913,
            nid: 7902,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7914,
            nid: 7903,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });
        await cards.create({
            id: 7915,
            nid: 7904,
            did: deck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);

        const cappedQueue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                newCardsIgnoreReviewLimit: false,
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 2,
                    newPerDay: 10,
                },
            },
        });

        expect(cappedQueue.counts.review).toBe(2);
        expect(cappedQueue.counts.new).toBe(0);

        const uncappedQueue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: deck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                newCardsIgnoreReviewLimit: true,
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 2,
                    newPerDay: 10,
                },
            },
        });

        expect(uncappedQueue.counts.review).toBe(2);
        expect(uncappedQueue.counts.new).toBe(3);
    });

    it("includes descendant deck cards when queueing a parent deck", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const parentDeck = await decks.create("ParentDeckParity");
        const childDeck = await decks.create("ParentDeckParity::Child");

        await notes.create({
            id: 8001,
            guid: "parent-deck-parity-note",
            mid: 101,
            fields: ["front", "back"],
        });

        await cards.create({
            id: 80011,
            nid: 8001,
            did: childDeck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
        });

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: parentDeck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 10,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.cards.map((card) => card.id)).toContain(80011);
    });

    it("applies parent deck limits when enabled", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const config = new ConfigRepository(connection);

        const parentDeck = await decks.create("LimitParent");
        const childDeck = await decks.create("LimitParent::Child");

        await config.updateDeckConfig(11, {
            id: 11,
            name: "ParentLimit",
            reviewsPerDay: 1,
            newPerDay: 20,
            rev: { perDay: 1 },
            new: { perDay: 20 },
        });
        await config.updateDeckConfig(12, {
            id: 12,
            name: "ChildLimit",
            reviewsPerDay: 5,
            newPerDay: 20,
            rev: { perDay: 5 },
            new: { perDay: 20 },
        });

        await decks.update(parentDeck.id, { conf: 11 });
        await decks.update(childDeck.id, { conf: 12 });

        for (let index = 0; index < 3; index += 1) {
            await notes.create({
                id: 8100 + index,
                guid: `limit-parent-${index}`,
                mid: 101,
                fields: ["front", "back"],
            });

            await cards.create({
                id: 8200 + index,
                nid: 8100 + index,
                did: childDeck.id,
                ord: 0,
                type: CardType.Review,
                queue: CardQueue.Review,
                due: FIXED_DAY,
            });
        }

        const queueBuilder = new SchedulerQueueBuilder(connection);
        const queue = await queueBuilder.buildQueue({
            now: FIXED_NOW,
            deckId: childDeck.id,
            config: {
                ...DEFAULT_SCHEDULER_CONFIG,
                applyAllParentLimits: true,
                limits: {
                    learningPerDay: 10,
                    reviewsPerDay: 5,
                    newPerDay: 10,
                },
            },
        });

        expect(queue.counts.review).toBe(1);
        expect(queue.cards).toHaveLength(1);
    });

    it("enforces minimum interval for FSRS cards graduating to Review", () => {
        const engine = new SchedulerEngine();
        const config: SchedulerConfig = {
            ...DEFAULT_SCHEDULER_CONFIG,
            enableFuzz: false,
            now: FIXED_NOW,
            minimumInterval: 1,
            graduatingInterval: 1,
        };

        // Simulate a learning card that FSRS would graduate with scheduled_days < 1
        // by creating a card in Learning state with enough reps to trigger graduation.
        const learningCard = createCard({
            id: 1003,
            nid: 5003,
            did: 1,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: FIXED_NOW.getTime(),
            ivl: 0,
            factor: 2500,
            reps: 2,
            lapses: 0,
            left: 1,
            data: JSON.stringify({
                scheduler: "fsrs",
                fsrs: {
                    stability: 0.5,
                    difficulty: 5,
                    lastReview: FIXED_NOW.getTime() - 10 * 60_000,
                    elapsedDays: 0,
                    scheduledDays: 0,
                },
            }),
        });

        const preview = engine.previewCard(learningCard, config, FIXED_NOW);

        // All non-Again ratings should graduate to Review with interval >= 1
        for (const rating of ["good", "easy"] as const) {
            const transition = preview[rating];
            if (transition.nextCard.queue === CardQueue.Review) {
                expect(
                    transition.scheduledDays,
                    `${rating}: Review cards must have scheduledDays >= 1`,
                ).toBeGreaterThanOrEqual(1);
                expect(
                    transition.nextCard.ivl,
                    `${rating}: Review cards must have ivl >= 1`,
                ).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it("uses Anki-style rollover boundaries when computing scheduler day numbers", () => {
        const beforeRollover = new Date(2026, 3, 2, 3, 0, 0);
        const afterRollover = new Date(2026, 3, 2, 5, 0, 0);

        expect(toDayNumber(afterRollover) - toDayNumber(beforeRollover)).toBe(1);
    });

    it("counts FSRS elapsed days by scheduler day rollover, not raw elapsed hours", () => {
        const engine = new SchedulerEngine();
        const now = new Date(2026, 3, 2, 5, 0, 0);
        const beforeCutoff = new Date(2026, 3, 2, 3, 0, 0);

        const card = createCard({
            id: 1004,
            nid: 5004,
            did: 1,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: toDayNumber(now),
            ivl: 5,
            factor: 2500,
            reps: 20,
            lapses: 2,
            left: 0,
            data: JSON.stringify({
                scheduler: "fsrs",
                fsrs: {
                    stability: 12,
                    difficulty: 5.2,
                    lastReview: beforeCutoff.getTime(),
                    elapsedDays: 0,
                    scheduledDays: 5,
                },
            }),
        });

        const preview = engine.previewCard(
            card,
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                enableFuzz: false,
                now,
            },
            now,
        );

        expect(preview.good.fsrs?.elapsedDays).toBe(1);
    });

    it("prioritizes relearning step delay for Again on review cards", () => {
        const engine = new SchedulerEngine();

        const reviewCard = createCard({
            id: 1005,
            nid: 5005,
            did: 1,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: toDayNumber(FIXED_NOW),
            ivl: 25,
            factor: 2500,
            reps: 30,
            lapses: 2,
            left: 0,
            data: JSON.stringify({
                scheduler: "fsrs",
                fsrs: {
                    stability: 26,
                    difficulty: 5.5,
                    lastReview: FIXED_NOW.getTime() - 25 * 24 * 60 * 60 * 1000,
                    elapsedDays: 25,
                    scheduledDays: 25,
                },
            }),
        });

        const preview = engine.previewCard(
            reviewCard,
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                enableFuzz: false,
                now: FIXED_NOW,
                relearningSteps: ["10m"],
            },
            FIXED_NOW,
        );

        const againMinutes = Math.round((preview.again.due.getTime() - FIXED_NOW.getTime()) / 60_000);

        expect(preview.again.nextCard.type).toBe(CardType.Relearning);
        expect(preview.again.nextCard.queue).toBe(CardQueue.Learning);
        expect(againMinutes).toBe(10);
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

    it("buries only sibling queues enabled in deck options", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const deck = await decks.create("Answer::SelectiveBury");
        await notes.create({
            id: 8300,
            guid: "selective-bury-note",
            mid: 101,
            fields: ["question", "answer"],
        });

        await cards.create({
            id: 8301,
            nid: 8300,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 8,
            factor: 2300,
            reps: 6,
            lapses: 0,
            data: JSON.stringify({ scheduler: "sm2" }),
        });

        await cards.create({
            id: 8302,
            nid: 8300,
            did: deck.id,
            ord: 1,
            type: CardType.New,
            queue: CardQueue.New,
            due: FIXED_DAY,
        });

        await cards.create({
            id: 8303,
            nid: 8300,
            did: deck.id,
            ord: 2,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: FIXED_DAY,
            ivl: 5,
            factor: 2300,
            reps: 4,
            lapses: 0,
            data: JSON.stringify({ scheduler: "sm2" }),
        });

        const service = new SchedulerAnsweringService(connection, new SchedulerEngine());
        const result = await service.answerCardById(
            8301,
            "good",
            {
                ...DEFAULT_SCHEDULER_CONFIG,
                burySiblings: false,
                buryNew: true,
                buryReviews: false,
                buryInterdayLearning: false,
            },
            FIXED_NOW,
            800,
        );

        expect(result.buriedSiblingCardIds).toEqual([8302]);

        const newSibling = await cards.getById(8302);
        const reviewSibling = await cards.getById(8303);

        expect(newSibling?.queue).toBe(CardQueue.SchedBuried);
        expect(reviewSibling?.queue).toBe(CardQueue.Review);
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
