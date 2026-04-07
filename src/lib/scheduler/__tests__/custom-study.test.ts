import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    CUSTOM_STUDY_SESSION_DECK_NAME,
    CustomStudyError,
    CustomStudyService,
} from "@/lib/scheduler/custom-study";
import { toDayNumber } from "@/lib/scheduler/states";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { CollectionDatabaseManager, type CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import { CardQueue, CardType } from "@/lib/types/card";

describe("custom study service", () => {
    let manager: CollectionDatabaseManager;
    let connection: CollectionDatabaseConnection;

    beforeEach(async () => {
        manager = new CollectionDatabaseManager({
            persistenceMode: "memory",
            preferOpfs: false,
        });

        await manager.initialize();
        connection = await manager.getConnection();
        await ensureCollectionBootstrap(connection);
    });

    afterEach(async () => {
        await manager.close();
    });

    it("extends new limits on deck and parent decks when global parent limits are enabled", async () => {
        const decks = new DecksRepository(connection);
        const config = new ConfigRepository(connection);
        const service = new CustomStudyService(connection);

        const parent = await decks.create("CustomStudy::Parent");
        const child = await decks.create("CustomStudy::Parent::Child");

        const today = toDayNumber(new Date());

        await decks.update(parent.id, {
            lastDayStudied: today,
            newStudied: 7,
            reviewStudied: 4,
        });
        await decks.update(child.id, {
            lastDayStudied: today,
            newStudied: 5,
            reviewStudied: 3,
        });

        await config.updateGlobalConfig({
            applyAllParentLimits: true,
        });

        await service.apply({
            deckId: child.id,
            mode: "new-limit-delta",
            delta: 2,
        });

        const updatedParent = await decks.getById(parent.id);
        const updatedChild = await decks.getById(child.id);

        expect(updatedChild?.newStudied).toBe(3);
        expect(updatedParent?.newStudied).toBe(5);
        expect(updatedChild?.extendNew).toBe(2);
    });

    it("creates a preview custom study session deck and moves matching cards", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const service = new CustomStudyService(connection);

        const sourceDeck = await decks.create("CustomStudy::Preview");
        const nowMs = Date.now();
        const noteId = nowMs;
        const cardId = nowMs + 1;

        await notes.create({
            id: noteId,
            guid: "custom-study-preview-note",
            mid: 100001,
            tags: " alpha beta ",
            fields: ["front", "back"],
        });

        await cards.create({
            id: cardId,
            nid: noteId,
            did: sourceDeck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: toDayNumber(new Date()),
        });

        const previewSelectorRows = await connection.select<{ readonly id: number }>(
            `
            SELECT c.id
            FROM cards c
            WHERE c.did = ?
              AND c.odid = 0
              AND c.queue NOT IN (?, ?, ?)
              AND c.type = ?
            ORDER BY c.nid ASC, c.ord ASC, c.id ASC
            LIMIT ?
            `,
            [
                sourceDeck.id,
                CardQueue.Suspended,
                CardQueue.SchedBuried,
                CardQueue.UserBuried,
                CardType.New,
                99_999,
            ],
        );
        expect(previewSelectorRows).toHaveLength(1);

        const directPreviewRows = await (
            service as unknown as {
                selectPreviewCandidateCards: (
                    scopeDeckIds: readonly number[],
                    nowMs: number,
                    days: number,
                ) => Promise<Array<{ readonly id: number }>>;
            }
        ).selectPreviewCandidateCards([sourceDeck.id], Date.now(), 2);
        expect(directPreviewRows).toHaveLength(1);

        const first = await service.apply({
            deckId: sourceDeck.id,
            mode: "preview-days",
            days: 2,
        });

        expect(first.movedCardCount).toBe(1);
        expect(first.filteredDeckId).toBeGreaterThan(0);

        const sessionDeck = (await decks.list()).find((deck) => deck.name === CUSTOM_STUDY_SESSION_DECK_NAME);
        expect(sessionDeck?.dyn).toBe(1);

        const movedCard = await cards.getById(cardId);
        expect(movedCard?.did).toBe(sessionDeck?.id);
        expect(movedCard?.odid).toBe(sourceDeck.id);
        expect(movedCard?.queue).toBe(CardQueue.Preview);
        expect((movedCard?.due ?? 0) < 0).toBe(true);

        const second = await service.apply({
            deckId: sourceDeck.id,
            mode: "preview-days",
            days: 2,
        });

        expect(second.movedCardCount).toBe(1);
        expect(second.filteredDeckId).toBe(sessionDeck?.id);
    });

    it("returns no-matching-cards error when a custom study search is empty", async () => {
        const decks = new DecksRepository(connection);
        const service = new CustomStudyService(connection);

        const sourceDeck = await decks.create("CustomStudy::Forgotten");

        await expect(
            service.apply({
                deckId: sourceDeck.id,
                mode: "forgot-days",
                days: 1,
            }),
        ).rejects.toMatchObject({
            name: "CustomStudyError",
            code: "NO_MATCHING_CARDS",
        } satisfies Partial<CustomStudyError>);
    });

    it("persists cram include/exclude tags and returns them in defaults", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const revlog = new RevlogRepository(connection);
        const config = new ConfigRepository(connection);
        const service = new CustomStudyService(connection);

        const sourceDeck = await decks.create("CustomStudy::Cram");
        const nowMs = Date.now();
        const noteId = nowMs + 10;
        const cardId = nowMs + 11;

        await notes.create({
            id: noteId,
            guid: "custom-study-cram-note",
            mid: 100001,
            tags: " alpha ",
            fields: ["front", "back"],
        });

        await cards.create({
            id: cardId,
            nid: noteId,
            did: sourceDeck.id,
            ord: 0,
            type: CardType.Review,
            queue: CardQueue.Review,
            due: toDayNumber(new Date()) - 1,
            ivl: 5,
            reps: 3,
            factor: 2500,
        });

        await revlog.insert({
            id: nowMs * 10,
            cid: cardId,
            ease: 3,
            ivl: 5,
            lastIvl: 4,
            factor: 2500,
            time: 4000,
            type: 1,
        });

        await notes.create({
            id: nowMs + 12,
            guid: "custom-study-cram-tag-source",
            mid: 100001,
            tags: " beta ",
            fields: ["front beta", "back beta"],
        });

        await cards.create({
            id: nowMs + 13,
            nid: nowMs + 12,
            did: sourceDeck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: toDayNumber(new Date()),
        });

        const result = await service.apply({
            deckId: sourceDeck.id,
            mode: "cram",
            cram: {
                kind: "all",
                cardLimit: 100,
                tagsToInclude: ["alpha"],
                tagsToExclude: ["beta"],
            },
        });

        expect(result.movedCardCount).toBe(1);

        const global = await config.getGlobalConfig();
        expect(global[`customStudyIncludeTags:${sourceDeck.id}`]).toEqual(["alpha"]);
        expect(global[`customStudyExcludeTags:${sourceDeck.id}`]).toEqual(["beta"]);

        const defaults = await service.getDefaults(sourceDeck.id);
        const beta = defaults.tags.find((tag) => tag.name === "beta");

        expect(beta?.exclude).toBe(true);
    });

    it("fails when a non-filtered deck already uses the custom-study session name", async () => {
        const decks = new DecksRepository(connection);
        const notes = new NotesRepository(connection);
        const cards = new CardsRepository(connection);
        const service = new CustomStudyService(connection);

        const sourceDeck = await decks.create("CustomStudy::Conflict");
        await decks.create(CUSTOM_STUDY_SESSION_DECK_NAME, {
            dyn: 0,
        });

        const nowMs = Date.now();
        await notes.create({
            id: nowMs + 20,
            guid: "custom-study-conflict-note",
            mid: 100001,
            fields: ["front", "back"],
        });
        await cards.create({
            id: nowMs + 21,
            nid: nowMs + 20,
            did: sourceDeck.id,
            ord: 0,
            type: CardType.New,
            queue: CardQueue.New,
            due: toDayNumber(new Date()),
        });

        await expect(
            service.apply({
                deckId: sourceDeck.id,
                mode: "preview-days",
                days: 1,
            }),
        ).rejects.toMatchObject({
            name: "CustomStudyError",
            code: "EXISTING_DECK",
        } satisfies Partial<CustomStudyError>);
    });
});
