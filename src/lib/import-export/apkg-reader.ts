import initSqlJs, { type SqlJsStatic, type SqlValue } from "sql.js";
import { strFromU8, unzipSync } from "fflate";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import {
    DEFAULT_DECK_CONFIG_ID,
    DEFAULT_DECK_ID,
    ensureCollectionBootstrap,
} from "@/lib/storage/bootstrap";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository, type NotetypeRecord } from "@/lib/storage/repositories/notetypes";
import { RevlogRepository } from "@/lib/storage/repositories/revlog";
import {
    importMediaAssets,
    normalizeMediaFilename,
    type MediaConflictStrategy,
} from "@/lib/import-export/media-handler";

const NOTE_FIELD_SEPARATOR = "\x1f";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export interface ApkgCollectionMeta {
    readonly id: number;
    readonly crt: number;
    readonly mod: number;
    readonly scm: number;
    readonly ver: number;
    readonly dty: number;
    readonly usn: number;
    readonly ls: number;
    readonly conf: string;
    readonly models: string;
    readonly decks: string;
    readonly dconf: string;
    readonly tags: string;
}

export interface ApkgNoteRow {
    readonly id: number;
    readonly guid: string;
    readonly mid: number;
    readonly mod: number;
    readonly usn: number;
    readonly tags: string;
    readonly flds: string;
    readonly sfld: number;
    readonly csum: number;
    readonly flags: number;
    readonly data: string;
}

export interface ApkgCardRow {
    readonly id: number;
    readonly nid: number;
    readonly did: number;
    readonly ord: number;
    readonly mod: number;
    readonly usn: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
    readonly ivl: number;
    readonly factor: number;
    readonly reps: number;
    readonly lapses: number;
    readonly left: number;
    readonly odue: number;
    readonly odid: number;
    readonly flags: number;
    readonly data: string;
}

export interface ApkgRevlogRow {
    readonly id: number;
    readonly cid: number;
    readonly usn: number;
    readonly ease: number;
    readonly ivl: number;
    readonly lastIvl: number;
    readonly factor: number;
    readonly time: number;
    readonly type: number;
}

export interface ParsedApkgPackage {
    readonly collectionFileName: string;
    readonly col: ApkgCollectionMeta;
    readonly notes: readonly ApkgNoteRow[];
    readonly cards: readonly ApkgCardRow[];
    readonly revlog: readonly ApkgRevlogRow[];
    readonly mediaMap: Record<string, string>;
    readonly mediaFiles: Record<string, Uint8Array>;
}

export interface ApkgImportOptions {
    readonly importMedia?: boolean;
    readonly mediaConflictStrategy?: MediaConflictStrategy;
    readonly onProgress?: (message: string) => void;
}

export interface ApkgImportSummary {
    readonly package: {
        readonly notes: number;
        readonly cards: number;
        readonly revlog: number;
        readonly mediaEntries: number;
    };
    readonly imported: {
        readonly notes: number;
        readonly cards: number;
        readonly cardsFromDuplicateNotes: number;
        readonly revlog: number;
        readonly media: number;
    };
    readonly skipped: {
        readonly duplicateNotes: number;
        readonly revlogWithoutCards: number;
        readonly media: number;
    };
    readonly overwritten: {
        readonly media: number;
    };
    readonly failed: {
        readonly media: number;
    };
    readonly failures: readonly {
        readonly filename: string;
        readonly reason: string;
    }[];
}

interface DbImportSummary {
    readonly notesImported: number;
    readonly cardsImported: number;
    readonly cardsFromDuplicateNotesImported: number;
    readonly revlogImported: number;
    readonly duplicateNotesSkipped: number;
    readonly revlogSkipped: number;
}

export async function parseApkgArchive(
    input: Uint8Array | ArrayBuffer | Blob,
): Promise<ParsedApkgPackage> {
    const archiveBytes = await toUint8Array(input);
    const entries = unzipSync(archiveBytes);

    const collectionFileName = resolveCollectionFileName(entries);
    const collectionBytes = entries[collectionFileName];
    if (!collectionBytes) {
        throw new Error("APKG archive is missing collection database file.");
    }

    const mediaMap = parseMediaMap(entries.media);
    const mediaFiles = collectMediaFiles(entries, mediaMap);

    const sqlJs = await getSqlJs();
    const database = new sqlJs.Database(collectionBytes);

    try {
        const col = readCollectionMeta(database);
        const notes = readNotes(database);
        const cards = readCards(database);
        const revlog = readRevlog(database);

        return {
            collectionFileName,
            col,
            notes,
            cards,
            revlog,
            mediaMap,
            mediaFiles,
        };
    } finally {
        database.close();
    }
}

export async function importApkgArchive(
    connection: CollectionDatabaseConnection,
    input: Uint8Array | ArrayBuffer | Blob,
    options: ApkgImportOptions = {},
): Promise<ApkgImportSummary> {
    const parsed = await parseApkgArchive(input);
    return importParsedApkg(connection, parsed, options);
}

export async function importParsedApkg(
    connection: CollectionDatabaseConnection,
    parsed: ParsedApkgPackage,
    options: ApkgImportOptions = {},
): Promise<ApkgImportSummary> {
    const report = options.onProgress ?? (() => undefined);

    report("Preparing collection for import...");
    await ensureCollectionBootstrap(connection);

    report("Importing decks, notetypes, notes, cards, and revlog...");
    const databaseSummary = await connection.transaction(async (txConnection) => {
        return importParsedApkgIntoDatabase(txConnection, parsed);
    });

    let mediaImported = 0;
    let mediaOverwritten = 0;
    let mediaSkipped = 0;
    let mediaFailed = 0;
    let failures: readonly { filename: string; reason: string }[] = [];

    if (options.importMedia ?? true) {
        report("Importing media files...");

        const mediaAssets = Object.entries(parsed.mediaFiles).map(([filename, data]) => ({
            filename,
            data,
        }));

        const mediaResult = await importMediaAssets(mediaAssets, {
            conflictStrategy: options.mediaConflictStrategy ?? "skip",
        });

        mediaImported = mediaResult.imported;
        mediaOverwritten = mediaResult.overwritten;
        mediaSkipped = mediaResult.skipped;
        mediaFailed = mediaResult.failed;
        failures = mediaResult.failures;
    }

    return {
        package: {
            notes: parsed.notes.length,
            cards: parsed.cards.length,
            revlog: parsed.revlog.length,
            mediaEntries: Object.keys(parsed.mediaFiles).length,
        },
        imported: {
            notes: databaseSummary.notesImported,
            cards: databaseSummary.cardsImported,
            cardsFromDuplicateNotes: databaseSummary.cardsFromDuplicateNotesImported,
            revlog: databaseSummary.revlogImported,
            media: mediaImported,
        },
        skipped: {
            duplicateNotes: databaseSummary.duplicateNotesSkipped,
            revlogWithoutCards: databaseSummary.revlogSkipped,
            media: mediaSkipped,
        },
        overwritten: {
            media: mediaOverwritten,
        },
        failed: {
            media: mediaFailed,
        },
        failures,
    };
}

async function importParsedApkgIntoDatabase(
    connection: CollectionDatabaseConnection,
    parsed: ParsedApkgPackage,
): Promise<DbImportSummary> {
    const decksRepository = new DecksRepository(connection);
    const notesRepository = new NotesRepository(connection);
    const cardsRepository = new CardsRepository(connection);
    const notetypesRepository = new NotetypesRepository(connection);
    const revlogRepository = new RevlogRepository(connection);
    const configRepository = new ConfigRepository(connection);

    const [
        existingDecks,
        existingNotetypes,
        existingDeckConfigs,
        existingNotesByGuid,
        existingNoteIds,
        existingCardIds,
        existingRevlogIds,
    ] = await Promise.all([
        decksRepository.list(),
        notetypesRepository.list(),
        configRepository.getDeckConfigs(),
        connection.select<{ id: number; guid: string }>("SELECT id, guid FROM notes"),
        connection.select<{ id: number }>("SELECT id FROM notes"),
        connection.select<{ id: number }>("SELECT id FROM cards"),
        connection.select<{ id: number }>("SELECT id FROM revlog"),
    ]);

    const existingGuidMap = new Map<string, number>();
    for (const row of existingNotesByGuid) {
        if (row.guid) {
            existingGuidMap.set(row.guid, row.id);
        }
    }

    const noteIdSet = new Set(existingNoteIds.map((row) => row.id));
    const cardIdSet = new Set(existingCardIds.map((row) => row.id));
    const revlogIdSet = new Set(existingRevlogIds.map((row) => row.id));

    const allocateNoteId = createIdAllocator(noteIdSet);
    const allocateCardId = createIdAllocator(cardIdSet);
    const allocateRevlogId = createIdAllocator(revlogIdSet);

    const importedModelMap = parseJsonObjectMap(parsed.col.models);
    const importedDeckMap = parseJsonObjectMap(parsed.col.decks);
    const importedDeckConfigMap = parseJsonObjectMap(parsed.col.dconf);

    const notetypeIdMap = await mergeNotetypes(
        notetypesRepository,
        existingNotetypes,
        importedModelMap,
    );

    const deckConfigState = { ...existingDeckConfigs };
    let deckConfigsChanged = false;
    const deckConfigIdMap = new Map<number, number>();
    const deckConfigIdSet = new Set(
        Object.keys(deckConfigState)
            .map((key) => Number.parseInt(key, 10))
            .filter((value) => Number.isFinite(value)),
    );
    const allocateDeckConfigId = createIdAllocator(deckConfigIdSet);

    const mapDeckConfigId = (value: unknown): number => {
        const requestedId = asNumber(value, DEFAULT_DECK_CONFIG_ID);
        const cached = deckConfigIdMap.get(requestedId);
        if (cached !== undefined) {
            return cached;
        }

        if (deckConfigState[String(requestedId)] !== undefined) {
            deckConfigIdMap.set(requestedId, requestedId);
            return requestedId;
        }

        const importedConfig = importedDeckConfigMap[String(requestedId)];
        if (!isRecord(importedConfig)) {
            deckConfigIdMap.set(requestedId, DEFAULT_DECK_CONFIG_ID);
            return DEFAULT_DECK_CONFIG_ID;
        }

        const targetId = requestedId > 0 ? requestedId : allocateDeckConfigId(requestedId);
        if (deckConfigState[String(targetId)] !== undefined) {
            const remappedId = allocateDeckConfigId(targetId + 1);
            deckConfigState[String(remappedId)] = importedConfig;
            deckConfigIdMap.set(requestedId, remappedId);
            deckConfigsChanged = true;
            return remappedId;
        }

        deckConfigState[String(targetId)] = importedConfig;
        deckConfigIdMap.set(requestedId, targetId);
        deckConfigsChanged = true;
        return targetId;
    };

    const deckIdMap = await mergeDecks(
        decksRepository,
        existingDecks,
        importedDeckMap,
        mapDeckConfigId,
    );

    if (deckConfigsChanged) {
        await connection.run("UPDATE col SET dconf = ?, mod = ? WHERE id = 1", [
            JSON.stringify(deckConfigState),
            Date.now(),
        ]);
    }

    const noteIdMap = new Map<number, number>();
    const duplicateSourceNoteIds = new Set<number>();

    let notesImported = 0;
    let duplicateNotesSkipped = 0;

    for (const note of parsed.notes) {
        const normalizedGuid = note.guid.trim().length > 0 ? note.guid.trim() : createFallbackGuid(note.id);
        const existingId = existingGuidMap.get(normalizedGuid);
        if (existingId !== undefined) {
            noteIdMap.set(note.id, existingId);
            duplicateSourceNoteIds.add(note.id);
            duplicateNotesSkipped += 1;
            continue;
        }

        const mappedNotetypeId =
            notetypeIdMap.get(note.mid) ??
            notetypeIdMap.get(0) ??
            firstMappedId(notetypeIdMap) ??
            note.mid;

        const importedId = allocateNoteId(note.id);
        await notesRepository.create({
            id: importedId,
            guid: normalizedGuid,
            mid: mappedNotetypeId,
            mod: note.mod,
            usn: note.usn,
            tags: note.tags,
            fields: note.flds.split(NOTE_FIELD_SEPARATOR),
            sfld: note.sfld,
            csum: note.csum,
            flags: note.flags,
            data: note.data,
        });

        existingGuidMap.set(normalizedGuid, importedId);
        noteIdMap.set(note.id, importedId);
        notesImported += 1;
    }

    const cardIdMap = new Map<number, number>();
    let cardsImported = 0;
    let cardsFromDuplicateNotesImported = 0;

    for (const card of parsed.cards) {
        const mappedNoteId = noteIdMap.get(card.nid);
        if (!mappedNoteId) {
            continue;
        }

        const mappedDeckId = deckIdMap.get(card.did) ?? DEFAULT_DECK_ID;
        const importedId = allocateCardId(card.id);

        await cardsRepository.create({
            id: importedId,
            nid: mappedNoteId,
            did: mappedDeckId,
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
        });

        cardIdMap.set(card.id, importedId);
        cardsImported += 1;

        if (duplicateSourceNoteIds.has(card.nid)) {
            cardsFromDuplicateNotesImported += 1;
        }
    }

    let revlogImported = 0;
    let revlogSkipped = 0;

    for (const revlog of parsed.revlog) {
        const mappedCardId = cardIdMap.get(revlog.cid);
        if (!mappedCardId) {
            revlogSkipped += 1;
            continue;
        }

        const importedId = allocateRevlogId(revlog.id);
        await revlogRepository.insert({
            id: importedId,
            cid: mappedCardId,
            usn: revlog.usn,
            ease: revlog.ease,
            ivl: revlog.ivl,
            lastIvl: revlog.lastIvl,
            factor: revlog.factor,
            time: revlog.time,
            type: revlog.type,
        });

        revlogImported += 1;
    }

    return {
        notesImported,
        cardsImported,
        cardsFromDuplicateNotesImported,
        revlogImported,
        duplicateNotesSkipped,
        revlogSkipped,
    };
}

async function mergeNotetypes(
    repository: NotetypesRepository,
    existingNotetypes: readonly NotetypeRecord[],
    importedModelMap: Record<string, unknown>,
): Promise<Map<number, number>> {
    const byId = new Map<number, NotetypeRecord>();
    const byName = new Map<string, NotetypeRecord>();

    for (const entry of existingNotetypes) {
        byId.set(entry.id, entry);
        byName.set(entry.name.trim().toLowerCase(), entry);
    }

    const usedIds = new Set(existingNotetypes.map((entry) => entry.id));
    const allocateId = createIdAllocator(usedIds);

    const idMap = new Map<number, number>();

    for (const [rawId, model] of Object.entries(importedModelMap)) {
        if (!isRecord(model)) {
            continue;
        }

        const sourceId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(sourceId)) {
            continue;
        }

        const name = asString(model.name, `Imported Notetype ${sourceId}`).trim();
        const normalizedName = name.toLowerCase();

        const existingByName = byName.get(normalizedName);
        if (existingByName) {
            idMap.set(sourceId, existingByName.id);
            continue;
        }

        const existingById = byId.get(sourceId);
        if (existingById && existingById.name.trim().toLowerCase() === normalizedName) {
            idMap.set(sourceId, existingById.id);
            continue;
        }

        const targetId = usedIds.has(sourceId) ? allocateId(sourceId + 1) : sourceId;
        if (!usedIds.has(targetId)) {
            usedIds.add(targetId);
        }

        const created = await repository.create(name, {
            id: targetId,
            type: asNumber(model.type, 0),
            css: asString(model.css, ""),
            flds: asArray(model.flds),
            tmpls: asArray(model.tmpls),
            sortf: asNumber(model.sortf, 0),
            did: asOptionalNumber(model.did),
            mod: asNumber(model.mod, Date.now()),
            usn: asNumber(model.usn, 0),
        });

        byId.set(created.id, created);
        byName.set(normalizedName, created);
        idMap.set(sourceId, created.id);
    }

    return idMap;
}

async function mergeDecks(
    repository: DecksRepository,
    existingDecks: readonly DeckRecord[],
    importedDeckMap: Record<string, unknown>,
    mapDeckConfigId: (value: unknown) => number,
): Promise<Map<number, number>> {
    const byId = new Map<number, DeckRecord>();
    const byName = new Map<string, DeckRecord>();

    for (const entry of existingDecks) {
        byId.set(entry.id, entry);
        byName.set(entry.name.trim().toLowerCase(), entry);
    }

    const usedIds = new Set(existingDecks.map((entry) => entry.id));
    const allocateId = createIdAllocator(usedIds);

    const idMap = new Map<number, number>();

    for (const [rawId, deck] of Object.entries(importedDeckMap)) {
        if (!isRecord(deck)) {
            continue;
        }

        const sourceId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(sourceId)) {
            continue;
        }

        const name = asString(deck.name, `Imported Deck ${sourceId}`).trim();
        const normalizedName = name.toLowerCase();

        const existingByName = byName.get(normalizedName);
        if (existingByName) {
            idMap.set(sourceId, existingByName.id);
            continue;
        }

        const existingById = byId.get(sourceId);
        if (existingById && existingById.name.trim().toLowerCase() === normalizedName) {
            idMap.set(sourceId, existingById.id);
            continue;
        }

        const requestedConfigId = mapDeckConfigId(deck.conf);
        const targetId = usedIds.has(sourceId) ? allocateId(sourceId + 1) : sourceId;
        if (!usedIds.has(targetId)) {
            usedIds.add(targetId);
        }

        const created = await repository.create(name, {
            id: targetId,
            collapsed: asBoolean(deck.collapsed, false),
            browserCollapsed: asBoolean(deck.browserCollapsed, false),
            conf: requestedConfigId,
            desc: asString(deck.desc, ""),
            dyn: asNumber(deck.dyn, 0),
            extendNew: asNumber(deck.extendNew, 0),
            extendRev: asNumber(deck.extendRev, 0),
            mod: asNumber(deck.mod, Date.now()),
            usn: asNumber(deck.usn, 0),
        });

        byId.set(created.id, created);
        byName.set(normalizedName, created);
        idMap.set(sourceId, created.id);
    }

    return idMap;
}

function readCollectionMeta(database: InstanceType<SqlJsStatic["Database"]>): ApkgCollectionMeta {
    const row = readSingleRow(
        database,
        "SELECT id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags FROM col LIMIT 1",
    );
    if (!row) {
        throw new Error("Imported collection does not contain a col row.");
    }

    return {
        id: asNumber(row.id, 1),
        crt: asNumber(row.crt, 0),
        mod: asNumber(row.mod, 0),
        scm: asNumber(row.scm, 0),
        ver: asNumber(row.ver, 11),
        dty: asNumber(row.dty, 0),
        usn: asNumber(row.usn, 0),
        ls: asNumber(row.ls, 0),
        conf: asString(row.conf, "{}"),
        models: asString(row.models, "{}"),
        decks: asString(row.decks, "{}"),
        dconf: asString(row.dconf, "{}"),
        tags: asString(row.tags, "{}"),
    };
}

function readNotes(database: InstanceType<SqlJsStatic["Database"]>): ApkgNoteRow[] {
    const rows = readRows(
        database,
        "SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes ORDER BY id ASC",
    );

    return rows.map((row) => ({
        id: asNumber(row.id),
        guid: asString(row.guid, ""),
        mid: asNumber(row.mid),
        mod: asNumber(row.mod),
        usn: asNumber(row.usn),
        tags: asString(row.tags, ""),
        flds: asString(row.flds, ""),
        sfld: asNumber(row.sfld, 0),
        csum: asNumber(row.csum, 0),
        flags: asNumber(row.flags, 0),
        data: asString(row.data, ""),
    }));
}

function readCards(database: InstanceType<SqlJsStatic["Database"]>): ApkgCardRow[] {
    const rows = readRows(
        database,
        "SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards ORDER BY id ASC",
    );

    return rows.map((row) => ({
        id: asNumber(row.id),
        nid: asNumber(row.nid),
        did: asNumber(row.did),
        ord: asNumber(row.ord),
        mod: asNumber(row.mod),
        usn: asNumber(row.usn),
        type: asNumber(row.type, 0),
        queue: asNumber(row.queue, 0),
        due: asNumber(row.due, 0),
        ivl: asNumber(row.ivl, 0),
        factor: asNumber(row.factor, 0),
        reps: asNumber(row.reps, 0),
        lapses: asNumber(row.lapses, 0),
        left: asNumber(row.left, 0),
        odue: asNumber(row.odue, 0),
        odid: asNumber(row.odid, 0),
        flags: asNumber(row.flags, 0),
        data: asString(row.data, ""),
    }));
}

function readRevlog(database: InstanceType<SqlJsStatic["Database"]>): ApkgRevlogRow[] {
    const rows = readRows(
        database,
        "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id ASC",
    );

    return rows.map((row) => ({
        id: asNumber(row.id),
        cid: asNumber(row.cid),
        usn: asNumber(row.usn, 0),
        ease: asNumber(row.ease, 0),
        ivl: asNumber(row.ivl, 0),
        lastIvl: asNumber(row.lastIvl, 0),
        factor: asNumber(row.factor, 0),
        time: asNumber(row.time, 0),
        type: asNumber(row.type, 0),
    }));
}

function readRows(
    database: InstanceType<SqlJsStatic["Database"]>,
    sql: string,
): Array<Record<string, SqlValue>> {
    const statement = database.prepare(sql);
    try {
        const rows: Array<Record<string, SqlValue>> = [];
        while (statement.step()) {
            rows.push(statement.getAsObject());
        }
        return rows;
    } finally {
        statement.free();
    }
}

function readSingleRow(
    database: InstanceType<SqlJsStatic["Database"]>,
    sql: string,
): Record<string, SqlValue> | null {
    const rows = readRows(database, sql);
    return rows[0] ?? null;
}

function parseMediaMap(mediaBytes: Uint8Array | undefined): Record<string, string> {
    if (!mediaBytes) {
        return {};
    }

    const parsed = JSON.parse(strFromU8(mediaBytes, true)) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("APKG media map is invalid.");
    }

    const map: Record<string, string> = {};
    for (const [index, rawName] of Object.entries(parsed)) {
        const safeName = normalizeMediaFilename(asString(rawName, ""));
        if (!safeName) {
            continue;
        }
        map[index] = safeName;
    }

    return map;
}

function collectMediaFiles(
    entries: Record<string, Uint8Array>,
    mediaMap: Record<string, string>,
): Record<string, Uint8Array> {
    const files: Record<string, Uint8Array> = {};

    for (const [index, filename] of Object.entries(mediaMap)) {
        const data = entries[index];
        if (!data) {
            continue;
        }

        if (!(filename in files)) {
            files[filename] = data;
        }
    }

    return files;
}

function resolveCollectionFileName(entries: Record<string, Uint8Array>): string {
    if (entries["collection.anki21"]) {
        return "collection.anki21";
    }
    if (entries["collection.anki2"]) {
        return "collection.anki2";
    }

    const match = Object.keys(entries).find((name) => name.startsWith("collection.anki2"));
    if (match) {
        return match;
    }

    throw new Error("APKG archive does not contain collection.anki2 or collection.anki21.");
}

function parseJsonObjectMap(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed)) {
            return parsed;
        }
        return {};
    } catch {
        return {};
    }
}

function createIdAllocator(usedIds: Set<number>): (preferredId: number) => number {
    let fallbackSeed = Date.now();

    return (preferredId: number) => {
        let candidate = toPositiveInteger(preferredId);
        if (candidate <= 0) {
            candidate = toPositiveInteger(fallbackSeed);
            fallbackSeed += 1;
        }

        while (usedIds.has(candidate)) {
            candidate += 1;
        }

        usedIds.add(candidate);
        return candidate;
    };
}

function firstMappedId(map: Map<number, number>): number | null {
    for (const value of map.values()) {
        return value;
    }
    return null;
}

function createFallbackGuid(sourceId: number): string {
    return `imported-${sourceId}`;
}

function asString(value: unknown, fallback = ""): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value.toString();
    }
    if (value instanceof Uint8Array) {
        return new TextDecoder().decode(value);
    }
    return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
    const parsed = asNumber(value, Number.NaN);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }
        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }
    return fallback;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? [...value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const truncated = Math.trunc(value);
    return truncated > 0 ? truncated : 0;
}

async function toUint8Array(input: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
    if (input instanceof Uint8Array) {
        return input;
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }
    return new Uint8Array(await input.arrayBuffer());
}

async function getSqlJs(): Promise<SqlJsStatic> {
    if (!sqlJsPromise) {
        sqlJsPromise = initSqlJs({
            locateFile: (fileName) => {
                if (!fileName.endsWith(".wasm")) {
                    return fileName;
                }

                const isNodeRuntime =
                    typeof process !== "undefined" &&
                    typeof process.versions === "object" &&
                    Boolean(process.versions?.node) &&
                    typeof process.cwd === "function";

                if (isNodeRuntime) {
                    return `${process.cwd()}/node_modules/sql.js/dist/${fileName}`;
                }

                return fileName === "sql-wasm-browser.wasm"
                    ? "/sql-wasm-browser.wasm"
                    : "/sql-wasm.wasm";
            },
        });
    }

    return sqlJsPromise;
}
