import type { Database as SqlJsDatabase, SqlValue } from "sql.js";

const FIELD_SEPARATOR = "\x1f";
const DAY_IN_SECONDS = 86_400;
const REGISTERED_DATABASES = new WeakSet<SqlJsDatabase>();

export interface RegisterSqlFunctionsOptions {
    readonly force?: boolean;
}

export enum ProcessTextFlags {
    CaseFold = 1 << 0,
    StripHtml = 1 << 1,
    NormalizeWhitespace = 1 << 2,
}

export function registerSqlFunctions(
    database: SqlJsDatabase,
    options: RegisterSqlFunctionsOptions = {},
): void {
    if (!options.force && REGISTERED_DATABASES.has(database)) {
        return;
    }

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
        (
            data: SqlValue,
            due: SqlValue,
            ivl: SqlValue,
            today: SqlValue,
            nextDayAtMs: SqlValue,
            now: SqlValue,
        ) => extractFsrsRetrievability(data, due, ivl, today, nextDayAtMs, now),
    );

    database.create_function(
        "extract_fsrs_relative_retrievability",
        (
            data: SqlValue,
            due: SqlValue,
            ivl: SqlValue,
            today: SqlValue,
            _nextDayAtMs: SqlValue,
            now: SqlValue,
        ) => extractFsrsRelativeRetrievability(data, due, ivl, today, now),
    );

    REGISTERED_DATABASES.add(database);
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

function extractFsrsRetrievability(
    data: SqlValue,
    due: SqlValue,
    ivl: SqlValue,
    today: SqlValue,
    _nextDayAtMs: SqlValue,
    now: SqlValue,
): number | null {
    if (typeof data !== "string") {
        return null;
    }

    const parsed = parseJsonRecord(data);
    if (!parsed) {
        return null;
    }

    const dueNumber = toFiniteNumber(due);
    const interval = toFiniteNumber(ivl);
    const todayNumber = toFiniteNumber(today);
    const nowNumber = toFiniteNumber(now);
    if (dueNumber === null || interval === null || todayNumber === null || nowNumber === null) {
        return null;
    }

    const stabilityValue = resolveFsrsField(parsed, "s") ?? resolveFsrsField(parsed, "stability");
    const stability = toFiniteNumber(stabilityValue);
    if (stability === null || stability <= 0) {
        return null;
    }

    const decayValue = toFiniteNumber(resolveFsrsField(parsed, "decay"));
    const decay = decayValue ?? -0.5;

    const secondsElapsed = resolveFsrsSecondsElapsed(parsed, dueNumber, interval, todayNumber, nowNumber);
    if (secondsElapsed === null) {
        return null;
    }

    return computeFsrsRetrievability(stability, secondsElapsed / DAY_IN_SECONDS, decay);
}

function extractFsrsRelativeRetrievability(
    data: SqlValue,
    due: SqlValue,
    ivl: SqlValue,
    today: SqlValue,
    now: SqlValue,
): number | null {
    if (typeof data !== "string") {
        return null;
    }

    const parsed = parseJsonRecord(data);
    if (!parsed) {
        return null;
    }

    const dueNumber = toFiniteNumber(due);
    const interval = toFiniteNumber(ivl);
    const todayNumber = toFiniteNumber(today);
    const nowMs = toFiniteNumber(now);

    if (dueNumber === null || interval === null || todayNumber === null || nowMs === null) {
        return null;
    }

    const secondsElapsed = resolveFsrsSecondsElapsed(parsed, dueNumber, interval, todayNumber, nowMs);
    if (secondsElapsed === null) {
        return null;
    }

    const stabilityValue = resolveFsrsField(parsed, "s") ?? resolveFsrsField(parsed, "stability");
    const stability = toFiniteNumber(stabilityValue);

    if (stability !== null && stability > 0) {
        const desiredRetentionRaw = toFiniteNumber(resolveFsrsField(parsed, "dr"));
        const desiredRetention = Math.max(0.0001, desiredRetentionRaw ?? 0.9);
        const decay = toFiniteNumber(resolveFsrsField(parsed, "decay")) ?? -0.5;
        const currentRetrievability = Math.max(
            0.0001,
            computeFsrsRetrievability(stability, secondsElapsed / DAY_IN_SECONDS, decay) ?? 0.0001,
        );

        return -(
            (Math.pow(currentRetrievability, -1 / decay) - 1) /
            (Math.pow(desiredRetention, -1 / decay) - 1)
        );
    }

    const daysElapsed = secondsElapsed / DAY_IN_SECONDS;
    return -((daysElapsed + 0.001) / Math.max(1, interval));
}

function resolveFsrsSecondsElapsed(
    parsed: Record<string, unknown>,
    due: number,
    interval: number,
    today: number,
    now: number,
): number | null {
    const nowMs = normalizeEpochToMilliseconds(now);
    const lastReviewValue =
        resolveFsrsField(parsed, "last_review") ??
        resolveFsrsField(parsed, "lastReview") ??
        resolveFsrsField(parsed, "last_review_time");
    const lastReview = toFiniteNumber(lastReviewValue);

    if (lastReview !== null) {
        const lastReviewMs = normalizeEpochToMilliseconds(lastReview);
        return Math.max(0, (nowMs - lastReviewMs) / 1000);
    }

    if (isIntradayDue(due)) {
        const dueMs = normalizeEpochToMilliseconds(due);
        const lastReviewMs = dueMs - Math.max(0, interval) * 1000;
        return Math.max(0, (nowMs - lastReviewMs) / 1000);
    }

    const reviewDay = due - interval;
    const daysElapsed = Math.max(0, today - reviewDay);
    return daysElapsed * DAY_IN_SECONDS;
}

function isIntradayDue(due: number): boolean {
    return due > 365_000;
}

function computeFsrsRetrievability(stability: number, elapsedDays: number, decay: number): number | null {
    if (!Number.isFinite(stability) || !Number.isFinite(elapsedDays) || !Number.isFinite(decay) || decay === 0) {
        return null;
    }

    const factor = Math.pow(0.9, 1 / decay) - 1;
    const base = 1 + factor * (elapsedDays / stability);
    if (!Number.isFinite(base) || base <= 0) {
        return null;
    }

    const retrievability = Math.pow(base, decay);
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
