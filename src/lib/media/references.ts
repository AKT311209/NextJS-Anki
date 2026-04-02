import { NOTE_FIELD_SEPARATOR } from "@/lib/types/note";

const imageRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
const soundRegex = /\[sound:([^\]]+)\]/gi;

export interface MediaReference {
    readonly filename: string;
    readonly source: "image" | "audio";
}

export function extractMediaReferencesFromText(text: string): MediaReference[] {
    const references: MediaReference[] = [];

    for (const match of text.matchAll(imageRegex)) {
        const filename = normalizeMediaFilename(match[1]);
        if (filename) {
            references.push({ filename, source: "image" });
        }
    }

    for (const match of text.matchAll(soundRegex)) {
        const filename = normalizeMediaFilename(match[1]);
        if (filename) {
            references.push({ filename, source: "audio" });
        }
    }

    return references;
}

export function extractMediaReferencesFromFields(
    fields: string | readonly string[],
): MediaReference[] {
    const normalized = typeof fields === "string"
        ? fields
        : fields.join(NOTE_FIELD_SEPARATOR);
    return extractMediaReferencesFromText(normalized ?? "");
}

export function collectUniqueMediaFilenames(
    fields: string | readonly string[],
): string[] {
    const names = new Set<string>();

    for (const reference of extractMediaReferencesFromFields(fields)) {
        names.add(reference.filename);
    }

    return [...names].sort((left, right) => left.localeCompare(right));
}

function normalizeMediaFilename(value: string | undefined): string {
    if (!value) {
        return "";
    }

    const filename = value
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.trim() ?? "";

    if (filename.length === 0 || filename === "." || filename === "..") {
        return "";
    }

    return filename;
}
