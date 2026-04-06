import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppRuntimeStatus } from "@/components/shared/AppRuntimeStatus";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
    title: "NextJS Anki",
    description: "Client-first spaced repetition in the browser.",
    manifest: "/manifest.webmanifest",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <ThemeProvider>
                    <AppRuntimeStatus />
                    {children}
                </ThemeProvider>
            </body>
        </html>
    );
}
