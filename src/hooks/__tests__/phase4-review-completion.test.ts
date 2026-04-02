import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __reviewCompletion } from "@/hooks/use-review";
import { fromDayNumber, toDayNumber } from "@/lib/scheduler/states";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { CardQueue, CardType } from "@/lib/types/card";

describe("Phase 4 review completion summary", () => {
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

    it("counts learning cards still due today and reports next-card ETA in minutes", async () => {
        const now = new Date(2026, 3, 2, 10, 0, 0);
        const nowMs = now.getTime();
        const nextSchedulerDayStartMs = fromDayNumber(toDayNumber(now) + 1).getTime();

        const cards = new CardsRepository(connection);

        await cards.create({
            id: 91_001,
            nid: 91_001,
            did: 10,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: nowMs + 5 * 60_000,
        });

        await cards.create({
            id: 91_002,
            nid: 91_002,
            did: 10,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: nowMs + 20 * 60_000,
        });

        // Due right now, so not part of "still due later today".
        await cards.create({
            id: 91_003,
            nid: 91_003,
            did: 10,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: nowMs - 1,
        });

        // Next scheduler day; excluded from today's remainder.
        await cards.create({
            id: 91_004,
            nid: 91_004,
            did: 10,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: nextSchedulerDayStartMs + 1,
        });

        // Different deck.
        await cards.create({
            id: 91_005,
            nid: 91_005,
            did: 11,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: nowMs + 8 * 60_000,
        });

        // Non-learning queue; excluded.
        await cards.create({
            id: 91_006,
            nid: 91_006,
            did: 10,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: toDayNumber(now),
        });

        const scoped = await __reviewCompletion.loadReviewCompletionState(connection, 10, now);
        expect(scoped.dueLaterToday).toBe(2);
        expect(scoped.nextCardDueInMinutes).toBe(5);

        const allDecks = await __reviewCompletion.loadReviewCompletionState(connection, null, now);
        expect(allDecks.dueLaterToday).toBe(3);
        expect(allDecks.nextCardDueInMinutes).toBe(5);
    });

    it("returns empty completion summary when no learning cards remain today", async () => {
        const now = new Date(2026, 3, 2, 10, 0, 0);
        const cards = new CardsRepository(connection);

        await cards.create({
            id: 92_001,
            nid: 92_001,
            did: 12,
            ord: 0,
            type: CardType.Learning,
            queue: CardQueue.Learning,
            due: now.getTime() - 1,
        });

        const summary = await __reviewCompletion.loadReviewCompletionState(connection, 12, now);

        expect(summary.dueLaterToday).toBe(0);
        expect(summary.nextCardDueInMinutes).toBeNull();
    });
});