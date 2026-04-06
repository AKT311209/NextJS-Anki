"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
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

export default function SettingsPage() {
    const { theme, setTheme } = useTheme();
    const fontSize = useSettingsStore((s) => s.fontSize);
    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const setFontSize = useSettingsStore((s) => s.setFontSize);
    const setFontFamily = useSettingsStore((s) => s.setFontFamily);
    const setThemeMode = useSettingsStore((s) => s.setThemeMode);

    const resolvedTheme = theme ?? "dark";

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
        </main>
    );
}
