import { describe, expect, it } from "vitest";
import { toDayNumber } from "@/lib/scheduler/states";
import {
    formatAnkiAnswerButtonInterval,
    formatAnkiIntervalDays,
    formatBrowserDueValue,
    formatBrowserIntervalValue,
} from "@/lib/scheduler/timespan";
import { CardQueue } from "@/lib/types/card";

describe("Phase 2 Anki-style timespan formatting", () => {
    it("formats answer button labels with collapse threshold", () => {
        expect(formatAnkiAnswerButtonInterval(30, 20 * 60)).toBe("<30s");
        expect(formatAnkiAnswerButtonInterval(10 * 60, 20 * 60)).toBe("<10m");
        expect(formatAnkiAnswerButtonInterval(2 * 60 * 60, 20 * 60)).toBe("2h");
    });

    it("formats interval day counts with month/year units", () => {
        expect(formatAnkiIntervalDays(3)).toBe("3d");
        expect(formatAnkiIntervalDays(45)).toBe("1.5mo");
        expect(formatAnkiIntervalDays(400)).toBe("1.1y");
    });

    it("formats browser due values by queue semantics", () => {
        const now = new Date("2026-04-02T12:00:00.000Z");

        expect(
            formatBrowserDueValue(
                {
                    queue: CardQueue.Learning,
                    due: now.getTime() + 5 * 60_000,
                },
                now,
            ),
        ).toBe("5m");

        expect(
            formatBrowserDueValue(
                {
                    queue: CardQueue.Review,
                    due: toDayNumber(now) + 3,
                },
                now,
            ),
        ).toBe("3d");

        expect(
            formatBrowserDueValue(
                {
                    queue: CardQueue.Review,
                    due: toDayNumber(now) - 1,
                },
                now,
            ),
        ).toBe("due");
    });

    it("formats browser interval values by queue", () => {
        expect(formatBrowserIntervalValue({ queue: CardQueue.New, ivl: 0 })).toBe("new");
        expect(formatBrowserIntervalValue({ queue: CardQueue.Learning, ivl: 0 })).toBe("learn");
        expect(formatBrowserIntervalValue({ queue: CardQueue.Review, ivl: 45 })).toBe("1.5mo");
    });
});
