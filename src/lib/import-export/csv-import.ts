import { fnv1a32 } from "@/lib/storage/sql-functions";
import {
    DEFAULT_DECK_ID,
    ensureCollectionBootstrap,
} from "@/lib/storage/bootstrap";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository } from "@/lib/storage/repositories/notetypes";

const DAY_IN_MS = 86_400_000;

export type CsvDelimiter = "," | "\t" | ";" | "|";

export interface CsvParseOptions {
    readonly delimiter?: CsvDelimiter;
    readonly hasHeader?: boolean;
}

export interface ParsedCsvData {
    readonly delimiter: CsvDelimiter;
    readonly hasHeader: boolean;
    readonly headers: readonly string[];
    readonly rows: readonly string[][];
    readonly tagsToAdd: readonly string[];
    readonly columnCount: number;
}

export interface CsvImportOptions {
    readonly parsed: ParsedCsvData;
    readonly notetypeId: number;
    readonly deckId?: number;
    readonly fieldMapping: readonly number[];
    readonly extraTags?: readonly string[];
    readonly onProgress?: (message: string) => void;
}

export interface CsvImportSummary {
    readonly importedNotes: number;
    readonly importedCards: number;
    readonly skippedRows: number;
    readonly duplicateRows: number;
}

export function parseCsvImportText(
    text: string,
    options: CsvParseOptions = {},
): ParsedCsvData {
    const normalizedText = stripBom(text);
    const delimiter = options.delimiter ?? detectDelimiter(normalizedText);
    const rawRows = parseDelimitedRows(normalizedText, delimiter);

    const cleanedRows = rawRows.filter((row) => !isCommentRow(row));

    let cursor = 0;
    const tagsToAdd: string[] = [];

    if (cleanedRows[0]?.length === 1) {
        const candidate = cleanedRows[0][0]?.trim() ?? "";
        if (candidate.toLowerCase().startsWith("tags:")) {
            const tagsText = candidate.slice(5).trim();
            if (tagsText.length > 0) {
                for (const tag of tagsText.split(/\s+/g)) {
                    const normalized = tag.trim();
                    if (normalized.length > 0) {
                        tagsToAdd.push(normalized);
                    }
                }
            }
            cursor = 1;
        }
    }

    const nonEmptyRows = cleanedRows
        .slice(cursor)
        .filter((row) => row.some((cell) => cell.trim().length > 0));

    const hasHeader = options.hasHeader ?? false;
    const headerRow = hasHeader ? nonEmptyRows[0] ?? [] : [];
    const dataRows = hasHeader ? nonEmptyRows.slice(1) : nonEmptyRows;

    const columnCount = Math.max(
        headerRow.length,
        ...dataRows.map((row) => row.length),
        0,
    );

    const headers = hasHeader
        ? padRow(headerRow, columnCount)
        : buildDefaultHeaders(columnCount);

    const rows = dataRows.map((row) => padRow(row, columnCount));

    return {
        delimiter,
        hasHeader,
        headers,
        rows,
        tagsToAdd,
        columnCount,
    };
}

export function suggestCsvFieldMapping(
    parsed: ParsedCsvData,
    notetypeFieldCount: number,
): number[] {
    const mapping: number[] = [];
    for (let fieldOrdinal = 0; fieldOrdinal < notetypeFieldCount; fieldOrdinal += 1) {
        mapping.push(fieldOrdinal < parsed.columnCount ? fieldOrdinal : -1);
    }
    return mapping;
}

export async function importParsedCsv(
    connection: CollectionDatabaseConnection,
    options: CsvImportOptions,
): Promise<CsvImportSummary> {
    const report = options.onProgress ?? (() => undefined);
    await ensureCollectionBootstrap(connection);

    report("Preparing CSV import...");

    const notetypesRepository = new NotetypesRepository(connection);
    const notesRepository = new NotesRepository(connection);
    const cardsRepository = new CardsRepository(connection);

    const notetype = await notetypesRepository.getById(options.notetypeId);
    if (!notetype) {
        throw new Error(`Notetype ${options.notetypeId} was not found.`);
    }

    const notetypeFieldCount = parseNotetypeFieldCount(notetype.flds);
    const templateCount = parseNotetypeTemplateCount(notetype.tmpls);
    const deckId = options.deckId ?? DEFAULT_DECK_ID;

    const [noteIdRows, cardIdRows] = await Promise.all([
        connection.select<{ id: number }>("SELECT id FROM notes"),
        connection.select<{ id: number }>("SELECT id FROM cards"),
    ]);

    const noteIdAllocator = createIdAllocator(new Set(noteIdRows.map((row) => row.id)));
    const cardIdAllocator = createIdAllocator(new Set(cardIdRows.map((row) => row.id)));

    const tagsToApply = normalizeTags([...(options.parsed.tagsToAdd ?? []), ...(options.extraTags ?? [])]);

    let importedNotes = 0;
    let importedCards = 0;
    let skippedRows = 0;
    let duplicateRows = 0;

    for (const row of options.parsed.rows) {
        const fields = mapRowToFields(row, options.fieldMapping, notetypeFieldCount);
        const primaryField = fields[0]?.trim() ?? "";

        if (primaryField.length === 0) {
            skippedRows += 1;
            continue;
        }

        const duplicates = await notesRepository.findDuplicates(options.notetypeId, primaryField);
        if (duplicates.length > 0) {
            duplicateRows += 1;
            continue;
        }

        const noteId = noteIdAllocator(Date.now());
        const now = Date.now();

        await notesRepository.create({
            id: noteId,
            guid: createCsvGuid(noteId),
            mid: options.notetypeId,
            mod: now,
            usn: 0,
            tags: tagsToApply.join(" "),
            fields,
            sfld: parseSortField(fields[0]),
            csum: fnv1a32(primaryField),
            flags: 0,
            data: "",
        });

        importedNotes += 1;

        const today = Math.floor(now / DAY_IN_MS);
        for (let templateOrdinal = 0; templateOrdinal < templateCount; templateOrdinal += 1) {
            await cardsRepository.create({
                id: cardIdAllocator(Date.now() + templateOrdinal),
                nid: noteId,
                did: deckId,
                ord: templateOrdinal,
                mod: now,
                usn: 0,
                type: 0,
                queue: 0,
                due: today,
                ivl: 0,
                factor: 2500,
                reps: 0,
                lapses: 0,
                left: 0,
                odue: 0,
                odid: 0,
                flags: 0,
                data: "",
            });
            importedCards += 1;
        }
    }

    return {
        importedNotes,
        importedCards,
        skippedRows,
        duplicateRows,
    };
}

function mapRowToFields(
    row: readonly string[],
    mapping: readonly number[],
    fieldCount: number,
): string[] {
    const fields: string[] = [];

    for (let fieldOrdinal = 0; fieldOrdinal < fieldCount; fieldOrdinal += 1) {
        const sourceColumn = mapping[fieldOrdinal] ?? -1;
        if (sourceColumn < 0) {
            fields.push("");
            continue;
        }

        fields.push(row[sourceColumn] ?? "");
    }

    return fields;
}

function parseDelimitedRows(text: string, delimiter: CsvDelimiter): string[][] {
    const rows: string[][] = [];

    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inQuotes) {
            if (char === '"') {
                const next = text[index + 1];
                if (next === '"') {
                    cell += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            continue;
        }

        if (char === delimiter) {
            row.push(cell);
            cell = "";
            continue;
        }

        if (char === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }

        if (char === "\r") {
            continue;
        }

        cell += char;
    }

    row.push(cell);
    rows.push(row);

    return rows;
}

function detectDelimiter(text: string): CsvDelimiter {
    const lines = text
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && !line.toLowerCase().startsWith("tags:"));

    const sampleLines = lines.slice(0, 10);
    const candidates: CsvDelimiter[] = ["\t", ",", ";", "|"];

    let selected: CsvDelimiter = ",";
    let bestScore = -1;

    for (const candidate of candidates) {
        let total = 0;
        let hits = 0;

        for (const sample of sampleLines) {
            const count = countOccurrences(sample, candidate);
            total += count;
            if (count > 0) {
                hits += 1;
            }
        }

        const score = total * 10 + hits;
        if (score > bestScore) {
            bestScore = score;
            selected = candidate;
        }
    }

    return bestScore <= 0 ? "," : selected;
}

function countOccurrences(text: string, search: string): number {
    if (!text || !search) {
        return 0;
    }

    let count = 0;
    let cursor = 0;
    while (cursor < text.length) {
        const index = text.indexOf(search, cursor);
        if (index === -1) {
            break;
        }
        count += 1;
        cursor = index + search.length;
    }
    return count;
}

function isCommentRow(row: readonly string[]): boolean {
    if (row.length === 0) {
        return true;
    }

    if (row.length === 1) {
        return row[0].trimStart().startsWith("#");
    }

    return false;
}

function padRow(row: readonly string[], columnCount: number): string[] {
    if (columnCount <= 0) {
        return [];
    }

    const next = [...row];
    while (next.length < columnCount) {
        next.push("");
    }
    if (next.length > columnCount) {
        return next.slice(0, columnCount);
    }
    return next;
}

function buildDefaultHeaders(columnCount: number): string[] {
    return Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
}

function parseNotetypeFieldCount(raw: unknown[] | undefined): number {
    if (!Array.isArray(raw) || raw.length === 0) {
        return 2;
    }
    return raw.length;
}

function parseNotetypeTemplateCount(raw: unknown[] | undefined): number {
    if (!Array.isArray(raw) || raw.length === 0) {
        return 1;
    }
    return raw.length;
}

function parseSortField(value: string | undefined): number {
    if (!value) {
        return 0;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTags(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const raw of tags) {
        const tag = raw.trim();
        if (tag.length === 0) {
            continue;
        }
        if (seen.has(tag)) {
            continue;
        }
        seen.add(tag);
        normalized.push(tag);
    }

    return normalized;
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

function toPositiveInteger(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const truncated = Math.trunc(value);
    return truncated > 0 ? truncated : 0;
}

function createCsvGuid(seed: number): string {
    return `csv-${seed}-${Math.random().toString(16).slice(2, 10)}`;
}

function stripBom(text: string): string {
    if (text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}
