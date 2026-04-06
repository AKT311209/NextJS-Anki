"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import { useApplySettings } from "@/hooks/use-apply-settings";

function SettingsApplier({ children }: { readonly children: ReactNode }) {
    useApplySettings();
    return <>{children}</>;
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
        >
            <SettingsApplier>{children}</SettingsApplier>
        </NextThemesProvider>
    );
}
