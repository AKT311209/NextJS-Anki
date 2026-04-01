export const NOTE_FIELD_SEPARATOR = "\x1f";

export interface Note {
    readonly id: number;
    readonly guid: string;
    readonly mid: number;
    readonly mod: number;
    readonly usn: number;
    readonly tags: string;
    readonly flds: string;
    readonly sfld: number;
    readonly csum: number;
    readonly flags: number;
    readonly data: string;
}

export type NotePatch = Partial<Omit<Note, "id">>;

export function splitFields(fields: string): string[] {
    if (!fields) {
        return [];
    }
    return fields.split(NOTE_FIELD_SEPARATOR);
}

export function joinFields(fields: readonly string[]): string {
    return fields.join(NOTE_FIELD_SEPARATOR);
}

export function splitTags(tags: string): string[] {
    return tags
        .trim()
        .split(" ")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}
