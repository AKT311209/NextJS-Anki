import {
    importMediaAssets,
    listStoredMediaFiles,
    loadMediaFiles,
    normalizeMediaFilename,
    type MediaConflictStrategy,
} from "@/lib/import-export/media-handler";

export interface PutMediaFileOptions {
    readonly conflictStrategy?: MediaConflictStrategy;
}

export interface PutMediaFileResult {
    readonly status: "imported" | "overwritten" | "skipped";
}

export async function putMediaFile(
    filename: string,
    data: Uint8Array,
    options: PutMediaFileOptions = {},
): Promise<PutMediaFileResult> {
    const normalized = normalizeMediaFilename(filename);
    if (!normalized) {
        throw new Error("Invalid media filename.");
    }

    const result = await importMediaAssets(
        [{ filename: normalized, data }],
        {
            conflictStrategy: options.conflictStrategy ?? "overwrite",
        },
    );

    if (result.failed > 0) {
        throw new Error(result.failures[0]?.reason ?? "Media write failed.");
    }

    if (result.overwritten > 0) {
        return { status: "overwritten" };
    }
    if (result.skipped > 0) {
        return { status: "skipped" };
    }

    return { status: "imported" };
}

export async function getMediaFile(filename: string): Promise<Uint8Array | null> {
    const normalized = normalizeMediaFilename(filename);
    if (!normalized) {
        return null;
    }

    const files = await loadMediaFiles([normalized]);
    return files.get(normalized) ?? null;
}

export async function getManyMediaFiles(
    filenames: readonly string[],
): Promise<Map<string, Uint8Array>> {
    const normalized = filenames
        .map((name) => normalizeMediaFilename(name))
        .filter((name) => name.length > 0);
    return loadMediaFiles(normalized);
}

export async function listMediaFiles(): Promise<string[]> {
    return listStoredMediaFiles();
}
