import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { MediaRepository } from "@/lib/storage/repositories/media";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository } from "@/lib/storage/repositories/notetypes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";

describe("Phase 1 storage layer", () => {
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
    });

    afterEach(async () => {
        await manager.close();
    });

    it("applies schema migrations and creates Anki core tables", async () => {
        const tables = await connection.select<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table'",
        );
        const tableNames = new Set(tables.map((table) => table.name));

        expect(tableNames.has("col")).toBe(true);
        expect(tableNames.has("notes")).toBe(true);
        expect(tableNames.has("cards")).toBe(true);
        expect(tableNames.has("revlog")).toBe(true);
        expect(tableNames.has("graves")).toBe(true);
        expect(tableNames.has("_anki_schema_migrations")).toBe(true);

        const schemaVersionRow = await connection.get<{ version: number }>(
            "SELECT MAX(version) AS version FROM _anki_schema_migrations",
        );
        expect(schemaVersionRow?.version).toBe(1);
    });

    it("registers and executes custom SQL functions", async () => {
        const row = await connection.get<{
            field: string;
            hash: number;
            processed: string;
            stability: number;
            retr: number;
        }>(
            `
            SELECT
                field_at_index('Front' || char(31) || 'Back', 1) AS field,
                fnvhash('1|2|3') AS hash,
                process_text('<b>Hello</b>   WORLD', 7) AS processed,
                extract_fsrs_variable('{"s": 12.5, "last_review": 0}', 's') AS stability,
                extract_fsrs_retrievability('{"s": 10, "last_review": 0}', -0.5, 86400) AS retr
            `,
        );

        expect(row?.field).toBe("Back");
        expect(typeof row?.hash).toBe("number");
        expect(row?.processed).toBe("hello world");
        expect(row?.stability).toBe(12.5);
        expect((row?.retr ?? 0) <= 1).toBe(true);
        expect((row?.retr ?? 0) >= 0).toBe(true);
    });

    it("supports repository CRUD and scheduling queries", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);
        const media = new MediaRepository(connection);
        const config = new ConfigRepository(connection);
        const notetypes = new NotetypesRepository(connection);

        const deck = await decks.create("Geography::Europe");
        await notetypes.create("Basic");

        const noteId = Date.now();
        await notes.create({
            id: noteId,
            guid: "note-guid-1",
            mid: 1001,
            tags: "geo capital",
            fields: ["France", "Paris <img src=\"paris.png\"> [sound:paris.mp3]"],
        });

        const duplicateCandidates = await notes.findDuplicates(1001, "France");
        expect(duplicateCandidates.length).toBe(1);

        const backField = await notes.getField(noteId, 1);
        expect(backField.includes("Paris")).toBe(true);

        const cardId = noteId + 1;
        await cards.create({
            id: cardId,
            nid: noteId,
            did: deck.id,
            ord: 0,
            queue: 2,
            type: 2,
            due: 10,
            ivl: 5,
            factor: 2500,
        });

        const dueCards = await cards.getDueCards({
            deckId: deck.id,
            maxDue: 10,
            limit: 10,
        });
        expect(dueCards.length).toBe(1);
        expect(dueCards[0].id).toBe(cardId);

        await revlog.insert({
            id: Date.now(),
            cid: cardId,
            ease: 3,
            ivl: 5,
            lastIvl: 1,
            factor: 2500,
            time: 1500,
            type: 1,
        });

        const cardReviews = await revlog.listByCardId(cardId);
        expect(cardReviews.length).toBe(1);

        const references = await media.listReferencesByNote(noteId);
        expect(references.some((entry) => entry.filename === "paris.png")).toBe(true);
        expect(references.some((entry) => entry.filename === "paris.mp3")).toBe(true);

        const queueCounts = await cards.getQueueCountsByDeck(deck.id);
        expect(queueCounts.reviewCount).toBe(1);

        const deckCounts = await decks.getDeckCounts(deck.id);
        expect(deckCounts.total).toBe(1);

        const updatedConfig = await config.updateGlobalConfig({ locale: "en-US" });
        expect(updatedConfig.locale).toBe("en-US");

        const updatedDeckConfig = await config.updateDeckConfig(1, {
            new_per_day: 20,
            reviews_per_day: 100,
        });
        expect(updatedDeckConfig.new_per_day).toBe(20);
        expect(updatedDeckConfig.reviews_per_day).toBe(100);
    });

    it("deleting a deck removes cards in that deck", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);

        const deck = await decks.create("Delete Me");
        const noteId = Date.now();
        const cardId = noteId + 1;

        await notes.create({
            id: noteId,
            guid: "deck-delete-note-guid",
            mid: 1001,
            tags: "",
            fields: ["Front", "Back"],
        });

        await cards.create({
            id: cardId,
            nid: noteId,
            did: deck.id,
            ord: 0,
            queue: 2,
            type: 2,
            due: 0,
            ivl: 1,
            factor: 2500,
        });

        await revlog.insert({
            id: Date.now() + 1,
            cid: cardId,
            ease: 3,
            ivl: 1,
            lastIvl: 0,
            factor: 2500,
            time: 1000,
            type: 1,
        });

        await decks.delete(deck.id);

        const remainingDeck = await decks.getById(deck.id);
        const deckCardCount = await connection.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM cards WHERE did = ?",
            [deck.id],
        );
        const revlogCount = await connection.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM revlog WHERE cid = ?",
            [cardId],
        );

        expect(remainingDeck).toBeNull();
        expect(Number(deckCardCount?.count ?? 0)).toBe(0);
        expect(Number(revlogCount?.count ?? 0)).toBe(0);
    });

    it("preserves deck config overrides across bootstrap reruns", async () => {
        const config = new ConfigRepository(connection);

        await ensureCollectionBootstrap(connection);

        await config.updateDeckConfig(1, {
            newPerDay: 77,
            reviewsPerDay: 333,
            requestRetention: 0.95,
            rev: {
                perDay: 333,
                maxIvl: 12000,
            },
        });

        await ensureCollectionBootstrap(connection);

        const persisted = await config.getDeckConfig(1);
        expect(persisted).not.toBeNull();
        expect(persisted?.newPerDay).toBe(77);
        expect(persisted?.reviewsPerDay).toBe(333);
        expect(persisted?.requestRetention).toBe(0.95);

        const rev = persisted?.rev as Record<string, unknown> | undefined;
        expect(rev?.perDay).toBe(333);
        expect(rev?.maxIvl).toBe(12000);
    });
});
