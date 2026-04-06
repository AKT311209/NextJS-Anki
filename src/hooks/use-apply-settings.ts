import { useEffect } from "react";
import {
    useSettingsStore,
    FONT_SIZE_MAP,
    FONT_FAMILY_MAP,
} from "@/stores/settings-store";

export function useApplySettings() {
    const fontSize = useSettingsStore((s) => s.fontSize);
    const fontFamily = useSettingsStore((s) => s.fontFamily);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--font-size-base", FONT_SIZE_MAP[fontSize]);
        root.style.setProperty("--font-family", FONT_FAMILY_MAP[fontFamily]);
    }, [fontSize, fontFamily]);
}
