import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeStatsSnapshot } from "@/hooks/use-stats";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";

describe("Phase 7 statistics", () => {
    let manager: CollectionDatabaseManager;
    let connection: CollectionDatabaseConnection;

    beforeEach(async () => {
        manager = new CollectionDatabaseManager({
            persistenceMode: "memory",
            preferOpfs: false,
            autoSaveDebounceMs: 1,
        });

        await manager.initialize();
        connection = await manager.getConnection();

        await ensureCollectionBootstrap(connection);
    });

    afterEach(async () => {
        await manager.close();
    });

    it("computes overview, trends, and forecast from collection data", async () => {
        const now = new Date("2026-04-02T12:00:00.000Z");
        const dayNumber = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
        const dayStart = new Date(now.getTime());
        dayStart.setHours(0, 0, 0, 0);

        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);

        const childDeck = await decks.create("Default::Child", {
            id: 2002,
            conf: 2,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 1001,
            cardId: 5001,
            deckId: 1,
            queue: 2,
            type: 2,
            due: dayNumber,
            ivl: 30,
            factor: 2500,
            data: '{"scheduler":"fsrs","fsrs":{"difficulty":4.6}}',
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 1002,
            cardId: 5002,
            deckId: 1,
            queue: 1,
            type: 1,
            due: now.getTime() - 5 * 60 * 1000,
            ivl: 0,
            factor: 2000,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 1003,
            cardId: 5003,
            deckId: childDeck.id,
            queue: 0,
            type: 0,
            due: 0,
            ivl: 0,
            factor: 0,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 1004,
            cardId: 5004,
            deckId: childDeck.id,
            queue: 2,
            type: 2,
            due: dayNumber + 3,
            ivl: 5,
            factor: 1800,
            data: '{"scheduler":"fsrs","fsrs":{"difficulty":8.4}}',
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 1005,
            cardId: 5005,
            deckId: 1,
            queue: -1,
            type: 2,
            due: dayNumber,
            ivl: 50,
            factor: 2300,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 5 * 60 * 60 * 1000, 1),
            cid: 5001,
            ease: 3,
            ivl: 30,
            lastIvl: 15,
            factor: 2500,
            time: 12_000,
            type: 1,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 7 * 60 * 60 * 1000, 2),
            cid: 5004,
            ease: 4,
            ivl: 5,
            lastIvl: 2,
            factor: 1900,
            time: 9_000,
            type: 1,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 9 * 60 * 60 * 1000, 3),
            cid: 5002,
            ease: 2,
            ivl: 1,
            lastIvl: 0,
            factor: 2000,
            time: 14_000,
            type: 0,
        });

        await revlog.insert({
            id: dayStart.getTime() - 6 * 60 * 60 * 1000,
            cid: 5001,
            ease: 1,
            ivl: 1,
            lastIvl: 0,
            factor: 2200,
            time: 10_000,
            type: 0,
        });

        const snapshot = await computeStatsSnapshot(connection, {
            now,
            selectedDeckId: null,
        });

        expect(snapshot.overview.totalCards).toBe(5);
        expect(snapshot.overview.totalNotes).toBe(5);
        expect(snapshot.overview.totalReviews).toBe(4);

        expect(snapshot.overview.reviewsToday).toBe(3);
        expect(snapshot.overview.correctRateToday).toBeCloseTo(1, 4);
        expect(snapshot.overview.dueToday).toBe(3);

        expect(snapshot.today.answerCount).toBe(3);
        expect(snapshot.today.answerMillis).toBe(35_000);
        expect(snapshot.today.correctCount).toBe(3);
        expect(snapshot.today.matureCount).toBe(0);
        expect(snapshot.today.learnCount).toBe(1);
        expect(snapshot.today.reviewCount).toBe(2);
        expect(snapshot.today.relearnCount).toBe(0);
        expect(snapshot.today.earlyReviewCount).toBe(0);

        expect(snapshot.trueRetention.today.youngPassed).toBe(2);
        expect(snapshot.trueRetention.today.youngFailed).toBe(0);
        expect(snapshot.trueRetention.today.maturePassed).toBe(0);
        expect(snapshot.trueRetention.today.matureFailed).toBe(0);
        expect(snapshot.trueRetention.week.youngPassed).toBe(2);

        expect(snapshot.futureDue.haveBacklog).toBe(false);
        expect(snapshot.futureDue.dailyLoad).toBe(1);
        expect(snapshot.futureDue.dueByDay).toEqual([
            { dayOffset: 0, dueCount: 2 },
            { dayOffset: 3, dueCount: 1 },
        ]);

        expect(snapshot.overview.stateCounts.new).toBe(1);
        expect(snapshot.overview.stateCounts.learning).toBe(1);
        expect(snapshot.overview.stateCounts.review).toBe(3);
        expect(snapshot.overview.stateCounts.suspended).toBe(1);

        expect(snapshot.reviewHeatmap.length).toBeGreaterThan(300);
        expect(snapshot.reviewHeatmap.some((entry) => entry.reviews > 0)).toBe(true);
        expect(snapshot.retention.length).toBeLessThanOrEqual(30);

        const todayForecast = snapshot.forecast.find((entry) => entry.dayOffset === 0);
        expect(todayForecast?.newCards).toBe(1);

        const dayThreeForecast = snapshot.forecast.find((entry) => entry.dayOffset === 3);
        expect(dayThreeForecast?.review).toBe(1);

        expect(snapshot.intervalDistribution.some((entry) => entry.count > 0)).toBe(true);
        expect(snapshot.difficultyDistribution.some((entry) => entry.count > 0)).toBe(true);
        expect(snapshot.hourlyDistribution).toHaveLength(24);
        expect(snapshot.hourlyBreakdown.oneMonth).toHaveLength(24);
        expect(snapshot.hourlyBreakdown.threeMonths).toHaveLength(24);
        expect(snapshot.hourlyBreakdown.oneYear).toHaveLength(24);
        expect(snapshot.hourlyBreakdown.allTime).toHaveLength(24);

        const allTimeHourTotals = snapshot.hourlyBreakdown.allTime.reduce((sum, hour) => sum + hour.total, 0);
        const allTimeHourCorrect = snapshot.hourlyBreakdown.allTime.reduce((sum, hour) => sum + hour.correct, 0);
        expect(allTimeHourTotals).toBe(4);
        expect(allTimeHourCorrect).toBe(3);

        expect(snapshot.deckRetention.some((entry) => entry.deckId === 1)).toBe(true);
        expect(snapshot.deckRetention.some((entry) => entry.deckId === childDeck.id)).toBe(true);
        expect(snapshot.deckForecast.some((entry) => entry.deckId === childDeck.id)).toBe(true);
    });

    it("scopes statistics to selected deck and exposes fsrs config", async () => {
        const now = new Date("2026-04-02T12:00:00.000Z");

        const decks = new DecksRepository(connection);
        const config = new ConfigRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);

        const childDeck = await decks.create("Default::Scoped", {
            id: 3002,
            conf: 2,
        });

        await config.updateDeckConfig(2, {
            requestRetention: 0.93,
            maximumInterval: 6000,
            learningSteps: ["1m", "15m"],
            relearningSteps: ["10m"],
            newPerDay: 30,
            reviewsPerDay: 250,
            learningPerDay: 100,
            enableFuzz: false,
            burySiblings: true,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 2001,
            cardId: 7001,
            deckId: 1,
            queue: 0,
            type: 0,
            due: 0,
            ivl: 0,
            factor: 0,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 2002,
            cardId: 7002,
            deckId: childDeck.id,
            queue: 2,
            type: 2,
            due: Math.floor(now.getTime() / (24 * 60 * 60 * 1000)),
            ivl: 15,
            factor: 2300,
            data: '{"scheduler":"fsrs","fsrs":{"difficulty":6.1}}',
        });

        const snapshot = await computeStatsSnapshot(connection, {
            now,
            selectedDeckId: childDeck.id,
        });

        expect(snapshot.scope.selectedDeckId).toBe(childDeck.id);
        expect(snapshot.overview.totalCards).toBe(1);
        expect(snapshot.overview.stateCounts.review).toBe(1);
        expect(snapshot.overview.stateCounts.new).toBe(0);

        expect(snapshot.fsrs).not.toBeNull();
        expect(snapshot.fsrs?.deckId).toBe(childDeck.id);
        expect(snapshot.fsrs?.requestRetention).toBeCloseTo(0.93, 6);
        expect(snapshot.fsrs?.maximumInterval).toBe(6000);
        expect(snapshot.fsrs?.newPerDay).toBe(30);
        expect(snapshot.fsrs?.reviewsPerDay).toBe(250);
        expect(snapshot.fsrs?.learningPerDay).toBe(100);
        expect(snapshot.fsrs?.enableFuzz).toBe(false);
        expect(snapshot.fsrs?.burySiblings).toBe(true);
        expect(snapshot.fsrs?.learningSteps).toEqual(["1m", "15m"]);
        expect(snapshot.fsrs?.relearningSteps).toEqual(["10m"]);
    });

    it("matches Anki true-retention and future-due edge cases", async () => {
        const now = new Date("2026-04-02T12:00:00.000Z");
        const dayNumber = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
        const dayStart = new Date(now.getTime());
        dayStart.setHours(0, 0, 0, 0);

        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);

        await insertNoteAndCard(notes, cards, {
            noteId: 3001,
            cardId: 8001,
            deckId: 1,
            queue: 2,
            type: 2,
            due: dayNumber - 2,
            ivl: 10,
            factor: 2300,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 3002,
            cardId: 8002,
            deckId: 1,
            queue: -2,
            type: 2,
            due: dayNumber,
            ivl: 15,
            factor: 2400,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 3003,
            cardId: 8003,
            deckId: 1,
            queue: -2,
            type: 2,
            due: dayNumber + 5,
            ivl: 20,
            factor: 2400,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 3004,
            cardId: 8004,
            deckId: 1,
            queue: -1,
            type: 2,
            due: dayNumber + 1,
            ivl: 5,
            factor: 2300,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 3005,
            cardId: 8005,
            deckId: 1,
            queue: 1,
            type: 1,
            due: now.getTime() + 2 * 24 * 60 * 60 * 1000,
            ivl: 0,
            factor: 2000,
        });

        await insertNoteAndCard(notes, cards, {
            noteId: 3006,
            cardId: 8006,
            deckId: 1,
            queue: 0,
            type: 0,
            due: 0,
            ivl: 0,
            factor: 0,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 8 * 60 * 60 * 1000, 1),
            cid: 8001,
            ease: 3,
            ivl: 12,
            lastIvl: 25,
            factor: 2300,
            time: 8_000,
            type: 1,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 9 * 60 * 60 * 1000, 2),
            cid: 8001,
            ease: 3,
            ivl: 2,
            lastIvl: 30,
            factor: 0,
            time: 7_000,
            type: 3,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 10 * 60 * 60 * 1000, 3),
            cid: 8001,
            ease: 1,
            ivl: 1,
            lastIvl: 30,
            factor: 2200,
            time: 9_000,
            type: 3,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 11 * 60 * 60 * 1000, 4),
            cid: 8005,
            ease: 2,
            ivl: 1,
            lastIvl: -90_000,
            factor: 2000,
            time: 10_000,
            type: 0,
        });

        await revlog.insert({
            id: encodeRevlogTimestamp(dayStart.getTime() + 12 * 60 * 60 * 1000, 5),
            cid: 8001,
            ease: 0,
            ivl: 10,
            lastIvl: 10,
            factor: 2300,
            time: 0,
            type: 4,
        });

        const snapshot = await computeStatsSnapshot(connection, {
            now,
            selectedDeckId: null,
        });

        expect(snapshot.today.answerCount).toBe(4);
        expect(snapshot.today.earlyReviewCount).toBe(2);
        expect(snapshot.today.reviewCount).toBe(1);
        expect(snapshot.today.learnCount).toBe(1);

        expect(snapshot.trueRetention.today.youngPassed).toBe(1);
        expect(snapshot.trueRetention.today.youngFailed).toBe(0);
        expect(snapshot.trueRetention.today.maturePassed).toBe(1);
        expect(snapshot.trueRetention.today.matureFailed).toBe(1);

        expect(snapshot.futureDue.haveBacklog).toBe(true);
        expect(snapshot.futureDue.dailyLoad).toBe(1);
        expect(snapshot.futureDue.dueByDay).toEqual([
            { dayOffset: -2, dueCount: 1 },
            { dayOffset: 1, dueCount: 1 },
            { dayOffset: 5, dueCount: 1 },
        ]);

        const monthTotals = snapshot.hourlyBreakdown.oneMonth.reduce((sum, hour) => sum + hour.total, 0);
        const monthCorrect = snapshot.hourlyBreakdown.oneMonth.reduce((sum, hour) => sum + hour.correct, 0);
        expect(monthTotals).toBe(2);
        expect(monthCorrect).toBe(2);
    });
});

async function insertNoteAndCard(
    notes: NotesRepository,
    cards: CardsRepository,
    input: {
        readonly noteId: number;
        readonly cardId: number;
        readonly deckId: number;
        readonly queue: number;
        readonly type: number;
        readonly due: number;
        readonly ivl: number;
        readonly factor: number;
        readonly data?: string;
    },
): Promise<void> {
    await notes.create({
        id: input.noteId,
        guid: `note-${input.noteId}`,
        mid: 100001,
        tags: "phase7",
        fields: [`Front ${input.noteId}`, `Back ${input.noteId}`],
    });

    await cards.create({
        id: input.cardId,
        nid: input.noteId,
        did: input.deckId,
        ord: 0,
        queue: input.queue,
        type: input.type,
        due: input.due,
        ivl: input.ivl,
        factor: input.factor,
        data: input.data,
    });
}

function encodeRevlogTimestamp(timestampMs: number, entropyDigit: number): number {
    const normalizedTimestamp = Math.max(0, Math.trunc(timestampMs));
    const normalizedDigit = Math.abs(Math.trunc(entropyDigit)) % 10;
    return normalizedTimestamp * 10 + normalizedDigit;
}
