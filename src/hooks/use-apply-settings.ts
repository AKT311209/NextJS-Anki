import { useEffect } from "react";
import { useTheme } from "next-themes";
import {
    useSettingsStore,
    FONT_SIZE_MAP,
    FONT_FAMILY_MAP,
} from "@/stores/settings-store";

export function useApplySettings() {
    const { theme, setTheme } = useTheme();
    const fontSize = useSettingsStore((s) => s.fontSize);
    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const themeMode = useSettingsStore((s) => s.themeMode);

    useEffect(() => {
        if (theme !== themeMode) {
            setTheme(themeMode);
        }
    }, [theme, themeMode, setTheme]);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--font-size-base", FONT_SIZE_MAP[fontSize]);
        root.style.setProperty("--font-family", FONT_FAMILY_MAP[fontFamily]);
    }, [fontSize, fontFamily]);
}
