"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    BACKUP_UPDATED_EVENT,
    getLastBackupAt,
    shouldShowBackupReminder,
    snoozeBackupReminder,
} from "@/lib/offline/backup-reminder";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function AppRuntimeStatus() {
    const [mounted, setMounted] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const refreshBackupState = () => {
            setLastBackupAt(getLastBackupAt());
            setNow(Date.now());
        };

        const onOnline = () => {
            setIsOnline(true);
        };

        const onOffline = () => {
            setIsOnline(false);
        };

        setIsOnline(window.navigator.onLine);
        refreshBackupState();
        setMounted(true);

        const timer = window.setInterval(() => {
            setNow(Date.now());
        }, MINUTE_MS);

        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        window.addEventListener(BACKUP_UPDATED_EVENT, refreshBackupState);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
            window.removeEventListener(BACKUP_UPDATED_EVENT, refreshBackupState);
        };
    }, []);

    const backupStatusLabel = useMemo(() => describeBackupRecency(lastBackupAt, now), [lastBackupAt, now]);
    const backupReminderVisible = useMemo(
        () => shouldShowBackupReminder({ lastBackupAt, now }),
        [lastBackupAt, now],
    );

    return (
        <div className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                    <span
                        data-testid="network-status-pill"
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${isOnline
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/70 dark:bg-amber-500/10 dark:text-amber-300"
                            }`}
                    >
                        {isOnline ? "Online" : "Offline"}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                        {isOnline
                            ? "Local data is available and ready."
                            : "You can keep reviewing offline; changes stay local."}
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {mounted && <span className="text-slate-500 dark:text-slate-400">{backupStatusLabel}</span>}
                    {mounted && backupReminderVisible ? (
                        <>
                            <Link
                                href="/settings#backup"
                                className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-700/70 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
                            >
                                Backup now
                            </Link>
                            <button
                                type="button"
                                className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                onClick={() => {
                                    snoozeBackupReminder();
                                    setNow(Date.now());
                                }}
                            >
                                Remind tomorrow
                            </button>
                        </>
                    ) : mounted ? (
                        <Link
                            href="/settings#backup"
                            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            Backup
                        </Link>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function describeBackupRecency(lastBackupAt: number | null, now: number): string {
    if (!lastBackupAt) {
        return "No backup yet";
    }

    const elapsed = Math.max(0, now - lastBackupAt);

    if (elapsed < HOUR_MS) {
        return "Backed up less than an hour ago";
    }

    if (elapsed < DAY_MS) {
        const hours = Math.max(1, Math.floor(elapsed / HOUR_MS));
        return `Backed up ${hours}h ago`;
    }

    const days = Math.max(1, Math.floor(elapsed / DAY_MS));
    return `Backed up ${days}d ago`;
}
