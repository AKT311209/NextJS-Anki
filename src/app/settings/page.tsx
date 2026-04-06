"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useCollection } from "@/hooks/use-collection";
import {
    exportCollectionAsApkg,
    triggerApkgDownload,
} from "@/lib/import-export/apkg-writer";
import {
    BACKUP_UPDATED_EVENT,
    getLastBackupAt,
    markBackupCompleted,
    shouldShowBackupReminder,
    snoozeBackupReminder,
} from "@/lib/offline/backup-reminder";
import {
    useSettingsStore,
    FONT_SIZE_MAP,
    type FontSizeOption,
    type FontFamilyOption,
    type ThemeMode,
} from "@/stores/settings-store";

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemeMode; readonly label: string }> = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];

const FONT_SIZE_OPTIONS: ReadonlyArray<{
    readonly value: FontSizeOption;
    readonly label: string;
}> = [
    { value: "small", label: "Small (14px)" },
    { value: "medium", label: "Medium (16px)" },
    { value: "large", label: "Large (18px)" },
    { value: "x-large", label: "Extra Large (20px)" },
];

const FONT_FAMILY_OPTIONS: ReadonlyArray<{
    readonly value: FontFamilyOption;
    readonly label: string;
}> = [
    { value: "system", label: "System default" },
    { value: "inter", label: "Inter" },
    { value: "georgia", label: "Georgia (serif)" },
    { value: "monospace", label: "Monospace" },
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export default function SettingsPage() {
    const { theme, setTheme } = useTheme();
    const collection = useCollection();

    const fontSize = useSettingsStore((s) => s.fontSize);
    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const setFontSize = useSettingsStore((s) => s.setFontSize);
    const setFontFamily = useSettingsStore((s) => s.setFontFamily);
    const setThemeMode = useSettingsStore((s) => s.setThemeMode);

    const [backupBusy, setBackupBusy] = useState(false);
    const [backupError, setBackupError] = useState<string | null>(null);
    const [backupSuccess, setBackupSuccess] = useState<string | null>(null);
    const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const resolvedTheme = theme ?? "dark";

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const refreshBackupState = () => {
            setLastBackupAt(getLastBackupAt());
            setNow(Date.now());
        };

        refreshBackupState();

        const timer = window.setInterval(() => {
            setNow(Date.now());
        }, MINUTE_MS);

        window.addEventListener(BACKUP_UPDATED_EVENT, refreshBackupState);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener(BACKUP_UPDATED_EVENT, refreshBackupState);
        };
    }, []);

    const backupReminderDue = useMemo(
        () => shouldShowBackupReminder({ lastBackupAt, now }),
        [lastBackupAt, now],
    );
    const backupStatus = useMemo(() => formatBackupStatus(lastBackupAt, now), [lastBackupAt, now]);

    const handleCreateBackup = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            setBackupError("Collection is still loading. Please try again in a moment.");
            return;
        }

        setBackupBusy(true);
        setBackupError(null);
        setBackupSuccess(null);

        try {
            const result = await exportCollectionAsApkg(collection.connection, {
                includeMedia: true,
            });

            triggerApkgDownload(result);
            markBackupCompleted();
            setBackupSuccess(`Backup downloaded: ${result.fileName}`);
        } catch (cause) {
            const rawMessage = cause instanceof Error ? cause.message : "Failed to create backup.";
            const message = /No cards available for export/i.test(rawMessage)
                ? "No cards are available for APKG backup yet. Add or import cards first."
                : rawMessage;
            setBackupError(message);
        } finally {
            setBackupBusy(false);
        }
    }, [collection.connection, collection.ready]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link
                    href="/"
                    className="text-sm text-slate-400 underline-offset-4 transition hover:text-slate-200"
                >
                    &larr; Back to decks
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Settings</h1>
                <p className="text-sm text-slate-400">
                    Customize appearance and display preferences.
                </p>
            </header>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-lg font-semibold text-slate-100">Theme</h2>
                <p className="text-sm text-slate-400">
                    Choose between light and dark mode.
                </p>
                <div className="flex flex-wrap gap-2">
                    {THEME_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                                setTheme(option.value);
                                setThemeMode(option.value);
                            }}
                            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                                resolvedTheme === option.value
                                    ? "border-sky-700/60 bg-sky-500/10 text-sky-300"
                                    : "border-slate-700 text-slate-200 hover:bg-slate-800"
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-lg font-semibold text-slate-100">Font size</h2>
                <p className="text-sm text-slate-400">
                    Adjust the base text size across the entire app.
                </p>
                <div className="flex flex-wrap gap-2">
                    {FONT_SIZE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setFontSize(option.value)}
                            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                                fontSize === option.value
                                    ? "border-sky-700/60 bg-sky-500/10 text-sky-300"
                                    : "border-slate-700 text-slate-200 hover:bg-slate-800"
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-slate-500">
                    Current: {FONT_SIZE_MAP[fontSize]}
                </p>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-lg font-semibold text-slate-100">Font family</h2>
                <p className="text-sm text-slate-400">
                    Change the typeface used throughout the app.
                </p>
                <div className="flex flex-wrap gap-2">
                    {FONT_FAMILY_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setFontFamily(option.value)}
                            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                                fontFamily === option.value
                                    ? "border-sky-700/60 bg-sky-500/10 text-sky-300"
                                    : "border-slate-700 text-slate-200 hover:bg-slate-800"
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </section>

            <section id="backup" className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-lg font-semibold text-slate-100">Backup & offline safety</h2>
                <p className="text-sm text-slate-400">
                    Create a full <code>.apkg</code> backup of your local collection.
                </p>

                <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                    <p>{backupStatus}</p>
                    {backupReminderDue ? (
                        <p className="mt-1 text-amber-200">
                            Backup reminder due — it&apos;s a good time to export a fresh backup.
                        </p>
                    ) : (
                        <p className="mt-1 text-emerald-300">Backup reminder is up to date.</p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleCreateBackup()}
                        disabled={backupBusy || collection.loading}
                    >
                        {backupBusy ? "Creating backup..." : "Create full APKG backup"}
                    </button>

                    <button
                        type="button"
                        className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                            snoozeBackupReminder();
                            setNow(Date.now());
                        }}
                        disabled={!backupReminderDue || backupBusy}
                    >
                        Remind me tomorrow
                    </button>
                </div>

                {collection.loading ? (
                    <p className="text-xs text-slate-400">Initializing collection...</p>
                ) : null}

                {collection.error ? (
                    <p className="text-xs text-rose-300">{collection.error}</p>
                ) : null}

                {backupError ? <p className="text-xs text-rose-300">{backupError}</p> : null}
                {backupSuccess ? <p className="text-xs text-emerald-300">{backupSuccess}</p> : null}

                <p className="text-xs text-slate-500">
                    Need deck-scoped export/import controls? Use the
                    {" "}
                    <Link href="/import" className="underline underline-offset-2 hover:text-slate-300">
                        Import &amp; Export
                    </Link>
                    {" "}
                    page.
                </p>
            </section>
        </main>
    );
}

function formatBackupStatus(lastBackupAt: number | null, now: number): string {
    if (!lastBackupAt) {
        return "No backup has been created yet.";
    }

    const elapsed = Math.max(0, now - lastBackupAt);
    const dateLabel = new Date(lastBackupAt).toLocaleString();

    if (elapsed < HOUR_MS) {
        return `Last backup: less than an hour ago (${dateLabel}).`;
    }

    if (elapsed < DAY_MS) {
        const hours = Math.max(1, Math.floor(elapsed / HOUR_MS));
        return `Last backup: ${hours}h ago (${dateLabel}).`;
    }

    const days = Math.max(1, Math.floor(elapsed / DAY_MS));
    return `Last backup: ${days}d ago (${dateLabel}).`;
}
