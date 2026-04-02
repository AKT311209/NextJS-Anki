import { toDayNumber } from "@/lib/scheduler/states";
import { CardQueue } from "@/lib/types/card";

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const MONTH_SECONDS = 30 * DAY_SECONDS;
const YEAR_SECONDS = 365.25 * DAY_SECONDS;

type TimespanUnit = "s" | "m" | "h" | "d" | "mo" | "y";

interface NaturalSpan {
    readonly value: number;
    readonly unit: TimespanUnit;
}

interface BrowserDueInput {
    readonly queue: number;
    readonly due: number;
}

interface BrowserIntervalInput {
    readonly queue: number;
    readonly ivl: number;
}

export function formatAnkiAnswerButtonInterval(seconds: number, collapseSeconds: number): string {
    const normalizedSeconds = normalizeSeconds(seconds);
    const label = formatAnkiTimespan(Math.max(1, normalizedSeconds));

    if (collapseSeconds > 0 && normalizedSeconds < collapseSeconds) {
        return `<${label}`;
    }

    return label;
}

export function formatAnkiIntervalDays(days: number): string {
    if (!Number.isFinite(days) || days <= 0) {
        return "0d";
    }

    return formatAnkiTimespan(days * DAY_SECONDS);
}

export function formatBrowserDueValue(card: BrowserDueInput, now: Date = new Date()): string {
    if (card.queue === CardQueue.Suspended || card.queue === CardQueue.SchedBuried || card.queue === CardQueue.UserBuried) {
        return "-";
    }

    if (card.queue === CardQueue.Learning) {
        const remainingSeconds = (card.due - now.getTime()) / 1000;
        if (remainingSeconds <= 0) {
            return "due";
        }
        return formatAnkiTimespan(remainingSeconds);
    }

    if (card.queue === CardQueue.New || card.queue === CardQueue.DayLearning || card.queue === CardQueue.Review) {
        const remainingDays = card.due - toDayNumber(now);
        if (remainingDays <= 0) {
            return "due";
        }
        return formatAnkiIntervalDays(remainingDays);
    }

    return String(card.due);
}

export function formatBrowserIntervalValue(card: BrowserIntervalInput): string {
    if (card.queue === CardQueue.New) {
        return "new";
    }

    if (card.queue === CardQueue.Learning || card.queue === CardQueue.DayLearning) {
        return "learn";
    }

    return formatAnkiIntervalDays(card.ivl);
}

export function formatAnkiTimespan(seconds: number): string {
    const span = toNaturalSpan(seconds);
    return `${roundSpanValue(span.value, span.unit)}${span.unit}`;
}

function toNaturalSpan(seconds: number): NaturalSpan {
    const normalized = Math.max(0, normalizeSeconds(seconds));

    if (normalized < MINUTE_SECONDS) {
        return {
            value: normalized,
            unit: "s",
        };
    }

    if (normalized < HOUR_SECONDS) {
        return {
            value: normalized / MINUTE_SECONDS,
            unit: "m",
        };
    }

    if (normalized < DAY_SECONDS) {
        return {
            value: normalized / HOUR_SECONDS,
            unit: "h",
        };
    }

    if (normalized < MONTH_SECONDS) {
        return {
            value: normalized / DAY_SECONDS,
            unit: "d",
        };
    }

    if (normalized < YEAR_SECONDS) {
        return {
            value: normalized / MONTH_SECONDS,
            unit: "mo",
        };
    }

    return {
        value: normalized / YEAR_SECONDS,
        unit: "y",
    };
}

function roundSpanValue(value: number, unit: TimespanUnit): string {
    if (unit === "s" || unit === "m" || unit === "d") {
        return String(Math.max(1, Math.round(value)));
    }

    const rounded = Math.max(0.1, Math.round(value * 10) / 10);
    return rounded.toString();
}

function normalizeSeconds(seconds: number): number {
    if (!Number.isFinite(seconds)) {
        return 0;
    }

    return Math.max(0, seconds);
}
