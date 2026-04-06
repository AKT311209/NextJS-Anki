import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FontSizeOption = "small" | "medium" | "large" | "x-large";
export type FontFamilyOption = "system" | "inter" | "georgia" | "monospace";

export const FONT_SIZE_MAP: Record<FontSizeOption, string> = {
    small: "14px",
    medium: "16px",
    large: "18px",
    "x-large": "20px",
};

export const FONT_FAMILY_MAP: Record<FontFamilyOption, string> = {
    system:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    georgia: 'Georgia, Cambria, "Times New Roman", Times, serif',
    monospace:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

type SettingsStore = {
    readonly fontSize: FontSizeOption;
    readonly fontFamily: FontFamilyOption;
    readonly setFontSize: (size: FontSizeOption) => void;
    readonly setFontFamily: (family: FontFamilyOption) => void;
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            fontSize: "medium",
            fontFamily: "system",
            setFontSize: (fontSize) => set({ fontSize }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
        }),
        { name: "anki-settings" },
    ),
);
