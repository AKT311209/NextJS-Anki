import initSqlJs, { type SqlJsStatic } from "sql.js";
import { zipSync } from "fflate";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { applyMigrations } from "@/lib/storage/schema";
import { loadMediaFiles } from "@/lib/import-export/media-handler";
import type {
    ApkgCardRow,
    ApkgCollectionMeta,
    ApkgNoteRow,
    ApkgRevlogRow,
} from "@/lib/import-export/apkg-reader";

const imageRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
const soundRegex = /\[sound:([^\]]+)\]/gi;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export interface ApkgExportOptions {
    readonly deckId?: number;
    readonly includeMedia?: boolean;
    readonly fileName?: string;
    readonly onProgress?: (message: string) => void;
}

export interface ApkgExportSummary {
    readonly notes: number;
    readonly cards: number;
    readonly revlog: number;
    readonly media: number;
}

export interface ApkgExportResult {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly mediaMap: Record<string, string>;
    readonly summary: ApkgExportSummary;
}

export async function exportCollectionAsApkg(
    connection: CollectionDatabaseConnection,
    options: ApkgExportOptions = {},
): Promise<ApkgExportResult> {
    const report = options.onProgress ?? (() => undefined);
    const includeMedia = options.includeMedia ?? true;

    report("Gathering cards for export...");
    const cards = await connection.select<ApkgCardRow>(
        options.deckId === undefined
            ? "SELECT * FROM cards ORDER BY id ASC"
            : "SELECT * FROM cards WHERE did = ? ORDER BY id ASC",
        options.deckId === undefined ? undefined : [options.deckId],
    );

    if (cards.length === 0) {
        throw new Error("No cards available for export.");
    }

    const noteIds = uniqueNumbers(cards.map((card) => card.nid));
    const notes = await selectByIds<ApkgNoteRow>(
        connection,
        "SELECT * FROM notes WHERE id IN",
        noteIds,
    );
    const cardIds = uniqueNumbers(cards.map((card) => card.id));
    const revlog = await selectByIds<ApkgRevlogRow>(
        connection,
        "SELECT * FROM revlog WHERE cid IN",
        cardIds,
    );

    const col = await connection.get<ApkgCollectionMeta>(
        "SELECT id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags FROM col WHERE id = 1 LIMIT 1",
    );
    if (!col) {
        throw new Error("Collection metadata row is missing.");
    }

    report("Building temporary collection database...");

    const usedDeckIds = uniqueNumbers(cards.map((card) => card.did));
    const usedNotetypeIds = uniqueNumbers(notes.map((note) => note.mid));

    const sourceModels = parseJsonObjectMap(col.models);
    const sourceDecks = parseJsonObjectMap(col.decks);
    const sourceDeckConfigs = parseJsonObjectMap(col.dconf);

    const expandedDeckIds = expandDeckIdsWithAncestors(usedDeckIds, sourceDecks);
    const filteredModels = filterRecordByNumericKeys(sourceModels, usedNotetypeIds);
    const filteredDecks = filterRecordByNumericKeys(sourceDecks, expandedDeckIds);
    const deckConfigIds = resolveDeckConfigIds(filteredDecks);
    const filteredDeckConfigs = filterRecordByNumericKeys(sourceDeckConfigs, deckConfigIds);

    const exportCollectionBytes = await buildCollectionDatabase({
        col,
        notes,
        cards,
        revlog,
        models: filteredModels,
        decks: filteredDecks,
        deckConfigs: filteredDeckConfigs,
    });

    report("Collecting media assets...");
    const mediaResult = includeMedia
        ? await collectMediaAssets(notes)
        : {
            mediaMap: {} as Record<string, string>,
            mediaFiles: new Map<string, Uint8Array>(),
        };

    report("Packaging .apkg archive...");
    const archiveEntries: Record<string, Uint8Array> = {
        "collection.anki2": exportCollectionBytes,
        media: encodeUtf8(JSON.stringify(mediaResult.mediaMap)),
    };

    for (const [index, filename] of Object.entries(mediaResult.mediaMap)) {
        const bytes = mediaResult.mediaFiles.get(filename);
        if (bytes) {
            archiveEntries[index] = bytes;
        }
    }

    const archiveBytes = zipSync(archiveEntries, { level: 6 });
    const resolvedFileName = resolveExportFileName(options.fileName, options.deckId);

    return {
        fileName: resolvedFileName,
        bytes: archiveBytes,
        mediaMap: mediaResult.mediaMap,
        summary: {
            notes: notes.length,
            cards: cards.length,
            revlog: revlog.length,
            media: Object.keys(mediaResult.mediaMap).length,
        },
    };
}

export function triggerApkgDownload(result: ApkgExportResult): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("APKG download is only available in browser environments.");
    }

    const bytes = result.bytes;
    const blobBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(blobBytes).set(bytes);
    const blob = new Blob([blobBytes], { type: "application/octet-stream" });
    const href = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = result.fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(href);
}

async function buildCollectionDatabase(input: {
    readonly col: ApkgCollectionMeta;
    readonly notes: readonly ApkgNoteRow[];
    readonly cards: readonly ApkgCardRow[];
    readonly revlog: readonly ApkgRevlogRow[];
    readonly models: Record<string, unknown>;
    readonly decks: Record<string, unknown>;
    readonly deckConfigs: Record<string, unknown>;
}): Promise<Uint8Array> {
    const sqlJs = await getSqlJs();
    const database = new sqlJs.Database();

    try {
        applyMigrations(database);

        database.run(
            `
			UPDATE col
			SET crt = ?, mod = ?, scm = ?, ver = ?, dty = ?, usn = ?, ls = ?,
				conf = ?, models = ?, decks = ?, dconf = ?, tags = ?
			WHERE id = 1
			`,
            [
                input.col.crt,
                Date.now(),
                input.col.scm,
                input.col.ver,
                input.col.dty,
                input.col.usn,
                input.col.ls,
                input.col.conf,
                JSON.stringify(input.models),
                JSON.stringify(input.decks),
                JSON.stringify(input.deckConfigs),
                input.col.tags,
            ],
        );

        const noteStatement = database.prepare(
            `
			INSERT INTO notes (
				id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
        );
        try {
            for (const note of input.notes) {
                noteStatement.run([
                    note.id,
                    note.guid,
                    note.mid,
                    note.mod,
                    note.usn,
                    note.tags,
                    note.flds,
                    note.sfld,
                    note.csum,
                    note.flags,
                    note.data,
                ]);
            }
        } finally {
            noteStatement.free();
        }

        const cardStatement = database.prepare(
            `
			INSERT INTO cards (
				id, nid, did, ord, mod, usn, type, queue, due, ivl,
				factor, reps, lapses, left, odue, odid, flags, data
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
        );
        try {
            for (const card of input.cards) {
                cardStatement.run([
                    card.id,
                    card.nid,
                    card.did,
                    card.ord,
                    card.mod,
                    card.usn,
                    card.type,
                    card.queue,
                    card.due,
                    card.ivl,
                    card.factor,
                    card.reps,
                    card.lapses,
                    card.left,
                    card.odue,
                    card.odid,
                    card.flags,
                    card.data,
                ]);
            }
        } finally {
            cardStatement.free();
        }

        const revlogStatement = database.prepare(
            `
			INSERT INTO revlog (
				id, cid, usn, ease, ivl, lastIvl, factor, time, type
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
        );
        try {
            for (const entry of input.revlog) {
                revlogStatement.run([
                    entry.id,
                    entry.cid,
                    entry.usn,
                    entry.ease,
                    entry.ivl,
                    entry.lastIvl,
                    entry.factor,
                    entry.time,
                    entry.type,
                ]);
            }
        } finally {
            revlogStatement.free();
        }

        return database.export();
    } finally {
        database.close();
    }
}

async function collectMediaAssets(
    notes: readonly ApkgNoteRow[],
): Promise<{
    mediaMap: Record<string, string>;
    mediaFiles: Map<string, Uint8Array>;
}> {
    const references = new Set<string>();

    for (const note of notes) {
        const fields = note.flds ?? "";

        for (const match of fields.matchAll(imageRegex)) {
            const name = normalizeMediaReference(match[1]);
            if (name) {
                references.add(name);
            }
        }

        for (const match of fields.matchAll(soundRegex)) {
            const name = normalizeMediaReference(match[1]);
            if (name) {
                references.add(name);
            }
        }
    }

    const sortedReferences = [...references].sort((left, right) => left.localeCompare(right));
    const mediaFiles = await loadMediaFiles(sortedReferences);

    const mediaMap: Record<string, string> = {};
    let index = 0;
    for (const filename of sortedReferences) {
        if (!mediaFiles.has(filename)) {
            continue;
        }
        mediaMap[String(index)] = filename;
        index += 1;
    }

    return { mediaMap, mediaFiles };
}

async function selectByIds<T>(
    connection: CollectionDatabaseConnection,
    baseSql: string,
    ids: readonly number[],
): Promise<T[]> {
    if (ids.length === 0) {
        return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    const sql = `${baseSql} (${placeholders}) ORDER BY id ASC`;
    return connection.select<T>(sql, [...ids]);
}

function uniqueNumbers(values: readonly number[]): number[] {
    return [...new Set(values.map((value) => Math.trunc(value)).filter((value) => Number.isFinite(value)))];
}

function parseJsonObjectMap(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

function filterRecordByNumericKeys(
    source: Record<string, unknown>,
    numericKeys: readonly number[],
): Record<string, unknown> {
    if (numericKeys.length === 0) {
        return {};
    }

    const keySet = new Set(numericKeys.map((value) => String(value)));
    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
        if (keySet.has(key)) {
            filtered[key] = value;
        }
    }

    return filtered;
}

function resolveDeckConfigIds(filteredDecks: Record<string, unknown>): number[] {
    const ids = new Set<number>();
    for (const deck of Object.values(filteredDecks)) {
        if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
            continue;
        }

        const conf = (deck as Record<string, unknown>).conf;
        if (typeof conf === "number" && Number.isFinite(conf)) {
            ids.add(Math.trunc(conf));
        } else if (typeof conf === "string") {
            const parsed = Number.parseInt(conf, 10);
            if (Number.isFinite(parsed)) {
                ids.add(parsed);
            }
        }
    }
    return [...ids];
}

function expandDeckIdsWithAncestors(
    seedDeckIds: readonly number[],
    sourceDecks: Record<string, unknown>,
): number[] {
    const expanded = new Set(seedDeckIds);
    const idToName = new Map<number, string>();
    const nameToId = new Map<string, number>();

    for (const [rawId, value] of Object.entries(sourceDecks)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }

        const id = Number.parseInt(rawId, 10);
        if (!Number.isFinite(id)) {
            continue;
        }

        const name = (value as Record<string, unknown>).name;
        if (typeof name !== "string" || name.trim().length === 0) {
            continue;
        }

        idToName.set(id, name);
        nameToId.set(name.toLowerCase(), id);
    }

    for (const deckId of seedDeckIds) {
        const name = idToName.get(deckId);
        if (!name) {
            continue;
        }

        const parts = name.split("::").map((part) => part.trim()).filter((part) => part.length > 0);
        for (let index = 1; index <= parts.length; index += 1) {
            const ancestorName = parts.slice(0, index).join("::").toLowerCase();
            const ancestorId = nameToId.get(ancestorName);
            if (ancestorId !== undefined) {
                expanded.add(ancestorId);
            }
        }
    }

    return [...expanded];
}

function normalizeMediaReference(value: string | undefined): string {
    if (!value) {
        return "";
    }

    const normalized = value
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.trim() ?? "";

    if (!normalized || normalized === "." || normalized === "..") {
        return "";
    }

    return normalized;
}

function resolveExportFileName(fileName: string | undefined, deckId: number | undefined): string {
    if (fileName && fileName.trim().length > 0) {
        return fileName.trim().toLowerCase().endsWith(".apkg")
            ? fileName.trim()
            : `${fileName.trim()}.apkg`;
    }

    const scope = deckId === undefined ? "collection" : `deck-${deckId}`;
    const date = new Date().toISOString().slice(0, 10);
    return `nextjs-anki-${scope}-${date}.apkg`;
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

function encodeUtf8(value: string): Uint8Array {
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(value, "utf8"));
    }

    if (typeof TextEncoder !== "undefined") {
        const encoded = new TextEncoder().encode(value);
        return new Uint8Array(encoded);
    }

    const escaped = unescape(encodeURIComponent(value));
    const result = new Uint8Array(escaped.length);
    for (let index = 0; index < escaped.length; index += 1) {
        result[index] = escaped.charCodeAt(index);
    }
    return result;
}
