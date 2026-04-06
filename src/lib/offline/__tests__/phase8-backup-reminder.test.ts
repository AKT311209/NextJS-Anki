import { beforeEach, describe, expect, it } from "vitest";
import {
    getBackupReminderSnoozeUntil,
    getLastBackupAt,
    isBackupReminderDue,
    markBackupCompleted,
    shouldShowBackupReminder,
    snoozeBackupReminder,
} from "@/lib/offline/backup-reminder";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("Phase 8 backup reminder utility", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("treats missing backup as reminder due", () => {
        expect(getLastBackupAt()).toBeNull();
        expect(shouldShowBackupReminder({ now: 1_000_000 })).toBe(true);
    });

    it("records backup completion and clears reminder snooze", () => {
        const now = 2_000_000;

        snoozeBackupReminder(30 * MINUTE_MS, now);
        expect(getBackupReminderSnoozeUntil()).toBe(now + 30 * MINUTE_MS);

        markBackupCompleted(now + 10_000);

        expect(getLastBackupAt()).toBe(now + 10_000);
        expect(getBackupReminderSnoozeUntil()).toBeNull();
        expect(shouldShowBackupReminder({ now: now + 20_000 })).toBe(false);
    });

    it("hides reminders while snoozed and re-shows after snooze window", () => {
        const now = 3_000_000;

        const snoozeUntil = snoozeBackupReminder(2 * HOUR_MS, now);

        expect(shouldShowBackupReminder({ now: now + HOUR_MS })).toBe(false);
        expect(shouldShowBackupReminder({ now: snoozeUntil + 1 })).toBe(true);
    });

    it("marks recent backup as not due", () => {
        const now = 10 * DAY_MS;
        markBackupCompleted(now - 3 * DAY_MS);

        expect(isBackupReminderDue(getLastBackupAt(), now)).toBe(false);
        expect(shouldShowBackupReminder({ now })).toBe(false);
    });
});

const MINUTE_MS = 60 * 1000;
