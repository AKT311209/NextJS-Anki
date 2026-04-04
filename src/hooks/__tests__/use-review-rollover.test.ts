import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __reviewRollover } from "@/hooks/use-review";
import { toDayNumber } from "@/lib/scheduler/states";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { CardQueue, CardType } from "@/lib/types/card";

describe("review rollover unbury parity", () => {
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

    it("unburies cards when day marker is stale and updates marker", async () => {
        const now = new Date("2026-04-04T12:00:00.000Z");
        const today = toDayNumber(now);

        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const config = new ConfigRepository(connection);

        const deck = await decks.create("Rollover::Demo");
        await notes.create({
            id: 9900,
            guid: "rollover-note",
            mid: 101,
            fields: ["front", "back"],
        });

        await cards.create({
            id: 9901,
            nid: 9900,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.UserBuried,
            due: today,
            ivl: 4,
        });

        await config.updateGlobalConfig({
            lastUnburiedDay: today - 1,
            last_unburied_day: today - 1,
        });

        await __reviewRollover.maybeUnburyOnDayRollover(connection, now);

        const updatedCard = await cards.getById(9901);
        expect(updatedCard?.queue).toBe(CardQueue.Review);

        const global = await config.getGlobalConfig();
        expect(global.lastUnburiedDay).toBe(today);
        expect(global.last_unburied_day).toBe(today);
    });

    it("does not unbury again on the same scheduler day", async () => {
        const now = new Date("2026-04-04T12:00:00.000Z");
        const today = toDayNumber(now);

        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const config = new ConfigRepository(connection);

        const deck = await decks.create("Rollover::SameDay");
        await notes.create({
            id: 9910,
            guid: "rollover-note-same-day",
            mid: 101,
            fields: ["front", "back"],
        });

        await cards.create({
            id: 9911,
            nid: 9910,
            did: deck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.SchedBuried,
            due: today,
            ivl: 5,
        });

        await config.updateGlobalConfig({
            lastUnburiedDay: today,
            last_unburied_day: today,
        });

        await __reviewRollover.maybeUnburyOnDayRollover(connection, now);

        const unchangedCard = await cards.getById(9911);
        expect(unchangedCard?.queue).toBe(CardQueue.SchedBuried);
    });
});
