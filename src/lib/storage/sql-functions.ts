import type { Database as SqlJsDatabase, SqlValue } from "sql.js";

const FIELD_SEPARATOR = "\x1f";
const DAY_IN_MS = 86_400_000;

export enum ProcessTextFlags {
    CaseFold = 1 << 0,
    StripHtml = 1 << 1,
    NormalizeWhitespace = 1 << 2,
}

export function registerSqlFunctions(database: SqlJsDatabase): void {
    database.create_function("field_at_index", (fields: SqlValue, ordinal: SqlValue) =>
        fieldAtIndex(fields, ordinal),
    );

    database.create_function("fnvhash", (value: SqlValue) => fnvhash(value));

    database.create_function("process_text", (text: SqlValue, flags: SqlValue) =>
        processText(text, flags),
    );

    database.create_function("extract_fsrs_variable", (data: SqlValue, key: SqlValue) =>
        extractFsrsVariable(data, key),
    );

    database.create_function(
        "extract_fsrs_retrievability",
        (data: SqlValue, decay: SqlValue, now: SqlValue) =>
            extractFsrsRetrievability(data, decay, now),
    );
}

function fieldAtIndex(fields: SqlValue, ordinal: SqlValue): string {
    if (typeof fields !== "string") {
        return "";
    }

    const index = toInteger(ordinal);
    if (index === null || index < 0) {
        return "";
    }

    const split = fields.split(FIELD_SEPARATOR);
    return split[index] ?? "";
}

function fnvhash(value: SqlValue): number {
    return fnv1a32(normalizeSqlValue(value));
}

function processText(text: SqlValue, flags: SqlValue): string {
    let processed = normalizeSqlValue(text);
    const normalizedFlags = toInteger(flags) ?? 0;

    if ((normalizedFlags & ProcessTextFlags.StripHtml) !== 0) {
        processed = processed.replace(/<[^>]+>/g, " ");
    }

    if ((normalizedFlags & ProcessTextFlags.CaseFold) !== 0) {
        processed = processed.toLocaleLowerCase();
    }

    if ((normalizedFlags & ProcessTextFlags.NormalizeWhitespace) !== 0) {
        processed = processed.replace(/\s+/g, " ").trim();
    }

    return processed;
}

function extractFsrsVariable(data: SqlValue, key: SqlValue): number | string | null {
    if (typeof data !== "string" || typeof key !== "string") {
        return null;
    }

    const parsed = parseJsonRecord(data);
    if (!parsed) {
        return null;
    }

    const resolvedValue = resolveFsrsField(parsed, key);
    if (typeof resolvedValue === "number" || typeof resolvedValue === "string") {
        return resolvedValue;
    }

    return null;
}

function extractFsrsRetrievability(data: SqlValue, decay: SqlValue, now: SqlValue): number | null {
    if (typeof data !== "string") {
        return null;
    }

    const parsed = parseJsonRecord(data);
    if (!parsed) {
        return null;
    }

    const decayNumber = toFiniteNumber(decay);
    const nowNumber = toFiniteNumber(now);
    if (decayNumber === null || nowNumber === null || decayNumber === 0) {
        return null;
    }

    const stabilityValue = resolveFsrsField(parsed, "s") ?? resolveFsrsField(parsed, "stability");
    const lastReviewValue =
        resolveFsrsField(parsed, "last_review") ??
        resolveFsrsField(parsed, "lastReview") ??
        resolveFsrsField(parsed, "last_review_time");

    const stability = toFiniteNumber(stabilityValue);
    const lastReview = toFiniteNumber(lastReviewValue);
    if (stability === null || stability <= 0 || lastReview === null) {
        return null;
    }

    const normalizedNow = normalizeEpochToMilliseconds(nowNumber);
    const normalizedLastReview = normalizeEpochToMilliseconds(lastReview);
    const elapsedDays = Math.max(0, (normalizedNow - normalizedLastReview) / DAY_IN_MS);

    const factor = Math.pow(0.9, 1 / decayNumber) - 1;
    const retrievability = Math.pow(1 + factor * (elapsedDays / stability), decayNumber);
    return clamp(retrievability, 0, 1);
}

function normalizeSqlValue(value: SqlValue): string {
    if (value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value.toString() : "";
    }
    if (value instanceof Uint8Array) {
        return new TextDecoder().decode(value);
    }

    return "";
}

function toInteger(value: SqlValue): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

function resolveFsrsField(source: Record<string, unknown>, key: string): unknown {
    if (key in source) {
        return source[key];
    }

    const fsrsBlock = source.fsrs;
    if (fsrsBlock && typeof fsrsBlock === "object" && !Array.isArray(fsrsBlock)) {
        const typedFsrsBlock = fsrsBlock as Record<string, unknown>;
        if (key in typedFsrsBlock) {
            return typedFsrsBlock[key];
        }
    }

    const aliases: Record<string, string[]> = {
        s: ["stability"],
        d: ["difficulty"],
        dr: ["desired_retention", "desiredRetention", "retention"],
    };

    for (const alias of aliases[key] ?? []) {
        if (alias in source) {
            return source[alias];
        }
        if (fsrsBlock && typeof fsrsBlock === "object" && !Array.isArray(fsrsBlock)) {
            const typedFsrsBlock = fsrsBlock as Record<string, unknown>;
            if (alias in typedFsrsBlock) {
                return typedFsrsBlock[alias];
            }
        }
    }

    return null;
}

function normalizeEpochToMilliseconds(value: number): number {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

export function fnv1a32(input: string): number {
    const bytes = new TextEncoder().encode(input);
    let hash = 0x811c9dc5;

    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}
