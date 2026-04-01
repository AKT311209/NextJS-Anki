"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface CardHtmlProps {
    readonly html: string;
    readonly css?: string;
    readonly className?: string;
    readonly nightMode?: boolean;
    readonly autoPlayAudio?: boolean;
}

const SOUND_TAG_PATTERN = /\[sound:([^\]]+)\]/g;

const BASE_CARD_CSS = `
:host {
    color: #e2e8f0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.anki-card-html {
    line-height: 1.6;
    word-break: break-word;
    font-size: 1.1rem;
}

.anki-card-html img,
.anki-card-html video,
.anki-card-html iframe {
    max-width: 100%;
    height: auto;
}

.anki-card-html audio {
    width: 100%;
    margin-top: 0.75rem;
}

.anki-card-html .cloze {
    color: #22d3ee;
    font-weight: 700;
}

.anki-card-html .cloze-inactive {
    opacity: 0.75;
}
`;

const NIGHT_MODE_CSS = `
:host {
    color: #f8fafc;
}

a {
    color: #38bdf8;
}

code,
pre {
    background: rgba(15, 23, 42, 0.6);
    border-radius: 0.375rem;
}
`;

export function CardHtml({
    html,
    css = "",
    className,
    nightMode = true,
    autoPlayAudio = true,
}: CardHtmlProps) {
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }

        const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = "";

        const style = document.createElement("style");
        style.textContent = `${BASE_CARD_CSS}\n${nightMode ? NIGHT_MODE_CSS : ""}\n${css}`;

        const container = document.createElement("article");
        container.className = "anki-card-html";
        container.innerHTML = replaceSoundTags(html);

        shadowRoot.append(style, container);

        if (!autoPlayAudio) {
            return;
        }

        const audios = shadowRoot.querySelectorAll<HTMLAudioElement>("audio[data-anki-autoplay='true']");
        for (const audio of audios) {
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {
                    // Browsers may block autoplay without user interaction.
                });
            }
        }
    }, [autoPlayAudio, css, html, nightMode]);

    return <div ref={hostRef} className={cn("w-full", className)} />;
}

function replaceSoundTags(source: string): string {
    return source.replace(SOUND_TAG_PATTERN, (_match, rawSource: string) => {
        const normalized = normalizeAudioSource(rawSource);
        if (!normalized) {
            return "";
        }

        return `<audio controls preload="auto" data-anki-autoplay="true" src="${escapeHtmlAttribute(normalized)}"></audio>`;
    });
}

function normalizeAudioSource(rawSource: string): string | null {
    const value = rawSource.trim();
    if (value.length === 0) {
        return null;
    }

    if (/^(javascript|data):/i.test(value)) {
        return null;
    }

    return value;
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
