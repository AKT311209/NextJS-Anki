const LAST_BACKUP_AT_KEY = "nextjs-anki::backup-last-completed-at";
const BACKUP_REMINDER_SNOOZE_UNTIL_KEY = "nextjs-anki::backup-reminder-snooze-until";

export const BACKUP_UPDATED_EVENT = "nextjs-anki:backup-updated";

export const DEFAULT_BACKUP_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_BACKUP_REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

interface BackupReminderVisibilityOptions {
    readonly now?: number;
    readonly reminderIntervalMs?: number;
    readonly lastBackupAt?: number | null;
    readonly snoozeUntil?: number | null;
}

export function getLastBackupAt(): number | null {
    return readNumericLocalStorageValue(LAST_BACKUP_AT_KEY);
}

export function getBackupReminderSnoozeUntil(): number | null {
    return readNumericLocalStorageValue(BACKUP_REMINDER_SNOOZE_UNTIL_KEY);
}

export function isBackupReminderDue(
    lastBackupAt: number | null,
    now = Date.now(),
    reminderIntervalMs = DEFAULT_BACKUP_REMINDER_INTERVAL_MS,
): boolean {
    if (!Number.isFinite(now) || now <= 0) {
        return false;
    }

    if (!lastBackupAt || !Number.isFinite(lastBackupAt) || lastBackupAt <= 0) {
        return true;
    }

    return now - lastBackupAt >= Math.max(0, reminderIntervalMs);
}

export function shouldShowBackupReminder(options: BackupReminderVisibilityOptions = {}): boolean {
    const now = options.now ?? Date.now();
    const reminderIntervalMs = options.reminderIntervalMs ?? DEFAULT_BACKUP_REMINDER_INTERVAL_MS;
    const lastBackupAt = options.lastBackupAt ?? getLastBackupAt();
    const snoozeUntil = options.snoozeUntil ?? getBackupReminderSnoozeUntil();

    if (!isBackupReminderDue(lastBackupAt, now, reminderIntervalMs)) {
        return false;
    }

    if (!snoozeUntil || !Number.isFinite(snoozeUntil)) {
        return true;
    }

    return snoozeUntil <= now;
}

export function markBackupCompleted(at = Date.now()): void {
    writeNumericLocalStorageValue(LAST_BACKUP_AT_KEY, at);
    removeLocalStorageValue(BACKUP_REMINDER_SNOOZE_UNTIL_KEY);
    dispatchBackupUpdatedEvent();
}

export function snoozeBackupReminder(
    durationMs = DEFAULT_BACKUP_REMINDER_SNOOZE_MS,
    now = Date.now(),
): number {
    const snoozeUntil = Math.max(now, now + Math.max(0, durationMs));
    writeNumericLocalStorageValue(BACKUP_REMINDER_SNOOZE_UNTIL_KEY, snoozeUntil);
    dispatchBackupUpdatedEvent();
    return snoozeUntil;
}

export function clearBackupReminderSnooze(): void {
    removeLocalStorageValue(BACKUP_REMINDER_SNOOZE_UNTIL_KEY);
    dispatchBackupUpdatedEvent();
}

function dispatchBackupUpdatedEvent(): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new Event(BACKUP_UPDATED_EVENT));
}

function readNumericLocalStorageValue(key: string): number | null {
    if (typeof localStorage === "undefined") {
        return null;
    }

    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return null;
        }

        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function writeNumericLocalStorageValue(key: string, value: number): void {
    if (typeof localStorage === "undefined") {
        return;
    }

    try {
        const normalized = Math.trunc(value);
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return;
        }

        localStorage.setItem(key, String(normalized));
    } catch {
        // Storage can be unavailable in private browsing or restricted contexts.
    }
}

function removeLocalStorageValue(key: string): void {
    if (typeof localStorage === "undefined") {
        return;
    }

    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore storage write errors.
    }
}
