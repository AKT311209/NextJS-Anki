import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    importParsedApkg,
    parseApkgArchive,
} from "@/lib/import-export/apkg-reader";
import { exportCollectionAsApkg } from "@/lib/import-export/apkg-writer";
import {
    importParsedCsv,
    parseCsvImportText,
    suggestCsvFieldMapping,
} from "@/lib/import-export/csv-import";
import {
    resetInMemoryMediaStoreForTests,
} from "@/lib/import-export/media-handler";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import {
    CollectionDatabaseManager,
    type CollectionDatabaseConnection,
} from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository } from "@/lib/storage/repositories/notetypes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { putMediaFile } from "@/lib/media/store";

const DAY_IN_MS = 86_400_000;

describe("Phase 6 import/export", () => {
    let sourceManager: CollectionDatabaseManager;
    let targetManager: CollectionDatabaseManager;
    let sourceConnection: CollectionDatabaseConnection;
    let targetConnection: CollectionDatabaseConnection;

    beforeEach(async () => {
        resetInMemoryMediaStoreForTests();

        sourceManager = new CollectionDatabaseManager({
            persistenceMode: "memory",
            preferOpfs: false,
            autoSaveDebounceMs: 1,
        });
        targetManager = new CollectionDatabaseManager({
            persistenceMode: "memory",
            preferOpfs: false,
            autoSaveDebounceMs: 1,
        });

        await sourceManager.initialize();
        await targetManager.initialize();

        sourceConnection = await sourceManager.getConnection("source");
        targetConnection = await targetManager.getConnection("target");
    });

    afterEach(async () => {
        await sourceManager.close();
        await targetManager.close();
        resetInMemoryMediaStoreForTests();
    });

    it("exports APKG, parses it, and re-imports duplicate GUID note cards as separate cards", async () => {
        await ensureCollectionBootstrap(sourceConnection);
        await seedSampleCollection(sourceConnection);

        const exported = await exportCollectionAsApkg(sourceConnection, {
            includeMedia: true,
        });

        expect(exported.summary.notes).toBe(1);
        expect(exported.summary.cards).toBe(1);
        expect(exported.summary.revlog).toBe(1);
        expect(exported.summary.media).toBe(2);

        const parsed = await parseApkgArchive(exported.bytes);
        expect(parsed.notes).toHaveLength(1);
        expect(parsed.cards).toHaveLength(1);
        expect(parsed.revlog).toHaveLength(1);
        expect(Object.keys(parsed.mediaFiles).sort()).toEqual(["earth.mp3", "earth.png"]);

        // Reset in-memory media storage to simulate importing into a fresh browser profile.
        resetInMemoryMediaStoreForTests();

        await ensureCollectionBootstrap(targetConnection);

        const firstImport = await importParsedApkg(targetConnection, parsed, {
            importMedia: true,
            mediaConflictStrategy: "overwrite",
        });

        expect(firstImport.imported.notes).toBe(1);
        expect(firstImport.imported.cards).toBe(1);
        expect(firstImport.imported.revlog).toBe(1);
        expect(firstImport.imported.media).toBe(2);

        const secondImport = await importParsedApkg(targetConnection, parsed, {
            importMedia: true,
            mediaConflictStrategy: "skip",
        });

        expect(secondImport.skipped.duplicateNotes).toBe(1);
        expect(secondImport.imported.notes).toBe(0);
        expect(secondImport.imported.cards).toBe(1);
        expect(secondImport.imported.cardsFromDuplicateNotes).toBe(1);

        const noteCount = await targetConnection.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM notes",
        );
        const cardCount = await targetConnection.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM cards",
        );
        const revlogCount = await targetConnection.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM revlog",
        );

        expect(Number(noteCount?.count ?? 0)).toBe(1);
        expect(Number(cardCount?.count ?? 0)).toBe(2);
        expect(Number(revlogCount?.count ?? 0)).toBe(2);
    });

    it("parses CSV metadata and imports rows with duplicate detection", async () => {
        await ensureCollectionBootstrap(targetConnection);

        const notetypeRepository = new NotetypesRepository(targetConnection);
        const basic = (await notetypeRepository.list()).find((entry) => entry.name === "Basic");

        expect(basic).toBeTruthy();
        if (!basic) {
            throw new Error("Basic notetype missing.");
        }

        const parsed = parseCsvImportText(
            [
                "tags: geo capitals",
                "Front,Back",
                "France,Paris",
                "France,Lyon",
                "Japan,Tokyo",
            ].join("\n"),
            { hasHeader: true },
        );

        expect(parsed.hasHeader).toBe(true);
        expect(parsed.headers).toEqual(["Front", "Back"]);
        expect(parsed.tagsToAdd).toEqual(["geo", "capitals"]);
        expect(parsed.rows).toHaveLength(3);

        const mapping = suggestCsvFieldMapping(parsed, 2);
        expect(mapping).toEqual([0, 1]);

        const deckRepository = new DecksRepository(targetConnection);
        const defaultDeck = await deckRepository.getById(1);

        const importSummary = await importParsedCsv(targetConnection, {
            parsed,
            notetypeId: basic.id,
            deckId: defaultDeck?.id,
            fieldMapping: mapping,
        });

        expect(importSummary.importedNotes).toBe(2);
        expect(importSummary.importedCards).toBe(2);
        expect(importSummary.duplicateRows).toBe(1);

        const notes = await targetConnection.select<{ flds: string; tags: string }>(
            "SELECT flds, tags FROM notes ORDER BY id ASC",
        );

        expect(notes).toHaveLength(2);
        expect(notes[0]?.tags.includes("geo")).toBe(true);
    });

    it("auto-detects tab-delimited files", () => {
        const parsed = parseCsvImportText(
            [
                "Front\tBack",
                "Alpha\tBeta",
                "Gamma\tDelta",
            ].join("\n"),
            { hasHeader: true },
        );

        expect(parsed.delimiter).toBe("\t");
        expect(parsed.headers).toEqual(["Front", "Back"]);
        expect(parsed.rows).toEqual([
            ["Alpha", "Beta"],
            ["Gamma", "Delta"],
        ]);
    });
});

async function seedSampleCollection(connection: CollectionDatabaseConnection): Promise<void> {
    const decksRepository = new DecksRepository(connection);
    const notesRepository = new NotesRepository(connection);
    const cardsRepository = new CardsRepository(connection);
    const notetypesRepository = new NotetypesRepository(connection);
    const revlogRepository = new RevlogRepository(connection);

    const basicNotetype = (await notetypesRepository.list()).find((entry) => entry.name === "Basic");
    if (!basicNotetype) {
        throw new Error("Expected Basic notetype to exist after bootstrap.");
    }

    const defaultDeck = await decksRepository.getById(1);
    if (!defaultDeck) {
        throw new Error("Expected default deck to exist after bootstrap.");
    }

    const noteId = 1_650_000_000_000;
    const cardId = noteId + 1;
    const now = Date.now();
    const today = Math.floor(now / DAY_IN_MS);

    await notesRepository.create({
        id: noteId,
        guid: "phase6-guid-1",
        mid: basicNotetype.id,
        tags: " geography world ",
        fields: ["Earth", "Planet <img src=\"earth.png\"> [sound:earth.mp3]"],
        mod: now,
        usn: 0,
        sfld: 0,
        csum: 0,
        flags: 0,
        data: "",
    });

    await cardsRepository.create({
        id: cardId,
        nid: noteId,
        did: defaultDeck.id,
        ord: 0,
        mod: now,
        usn: 0,
        type: 2,
        queue: 2,
        due: today,
        ivl: 10,
        factor: 2500,
        reps: 3,
        lapses: 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: "",
    });

    await revlogRepository.insert({
        id: now,
        cid: cardId,
        usn: 0,
        ease: 3,
        ivl: 10,
        lastIvl: 5,
        factor: 2500,
        time: 1500,
        type: 1,
    });

    await putMediaFile("earth.png", new Uint8Array([1, 2, 3]));
    await putMediaFile("earth.mp3", new Uint8Array([4, 5, 6]));
}
