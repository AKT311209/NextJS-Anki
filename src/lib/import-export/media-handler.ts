const MEDIA_ROOT_DIRECTORY = "nextjs-anki-media";

const inMemoryMediaStore = new Map<string, Uint8Array>();

export type MediaConflictStrategy = "skip" | "overwrite";

export interface MediaAsset {
    readonly filename: string;
    readonly data: Uint8Array;
}

export interface MediaImportResult {
    readonly imported: number;
    readonly overwritten: number;
    readonly skipped: number;
    readonly failed: number;
    readonly failures: readonly {
        readonly filename: string;
        readonly reason: string;
    }[];
}

export interface ImportMediaAssetsOptions {
    readonly conflictStrategy?: MediaConflictStrategy;
}

export async function importMediaAssets(
    assets: readonly MediaAsset[],
    options: ImportMediaAssetsOptions = {},
): Promise<MediaImportResult> {
    const conflictStrategy = options.conflictStrategy ?? "skip";
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;
    let failed = 0;
    const failures: Array<{ filename: string; reason: string }> = [];

    for (const asset of assets) {
        const safeName = normalizeMediaFilename(asset.filename);
        if (!safeName) {
            failed += 1;
            failures.push({
                filename: asset.filename,
                reason: "Invalid media filename.",
            });
            continue;
        }

        try {
            const status = await writeMediaFile(safeName, asset.data, conflictStrategy);
            if (status === "imported") {
                imported += 1;
            } else if (status === "overwritten") {
                overwritten += 1;
            } else {
                skipped += 1;
            }
        } catch (cause) {
            failed += 1;
            failures.push({
                filename: safeName,
                reason: cause instanceof Error ? cause.message : "Unknown media write failure.",
            });
        }
    }

    return {
        imported,
        overwritten,
        skipped,
        failed,
        failures,
    };
}

export async function loadMediaFiles(
    filenames: readonly string[],
): Promise<Map<string, Uint8Array>> {
    const entries = new Map<string, Uint8Array>();

    for (const rawName of filenames) {
        const safeName = normalizeMediaFilename(rawName);
        if (!safeName) {
            continue;
        }

        const data = await readMediaFile(safeName);
        if (data) {
            entries.set(safeName, data);
        }
    }

    return entries;
}

export async function listStoredMediaFiles(): Promise<string[]> {
    const mediaDirectory = await getMediaDirectoryHandle();
    if (!mediaDirectory) {
        return [...inMemoryMediaStore.keys()].sort((left, right) => left.localeCompare(right));
    }

    const names: string[] = [];
    const iterableDirectory = mediaDirectory as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>;
    };

    for await (const [name, handle] of iterableDirectory.entries()) {
        if (handle.kind === "file") {
            names.push(name);
        }
    }

    return names.sort((left, right) => left.localeCompare(right));
}

export function normalizeMediaFilename(filename: string): string {
    const normalized = filename
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.trim()
        .replaceAll("\0", "") ?? "";

    if (normalized.length === 0 || normalized === "." || normalized === "..") {
        return "";
    }

    return normalized;
}

export function resetInMemoryMediaStoreForTests(): void {
    inMemoryMediaStore.clear();
}

async function writeMediaFile(
    filename: string,
    data: Uint8Array,
    conflictStrategy: MediaConflictStrategy,
): Promise<"imported" | "overwritten" | "skipped"> {
    const mediaDirectory = await getMediaDirectoryHandle();
    if (!mediaDirectory) {
        const existing = inMemoryMediaStore.has(filename);
        if (existing && conflictStrategy === "skip") {
            return "skipped";
        }

        inMemoryMediaStore.set(filename, new Uint8Array(data));
        return existing ? "overwritten" : "imported";
    }

    const existing = await mediaFileExists(mediaDirectory, filename);
    if (existing && conflictStrategy === "skip") {
        return "skipped";
    }

    const fileHandle = await mediaDirectory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        const payload = new ArrayBuffer(data.byteLength);
        new Uint8Array(payload).set(data);
        await writable.write(payload);
    } finally {
        await writable.close();
    }

    return existing ? "overwritten" : "imported";
}

async function readMediaFile(filename: string): Promise<Uint8Array | null> {
    const mediaDirectory = await getMediaDirectoryHandle();
    if (!mediaDirectory) {
        const inMemory = inMemoryMediaStore.get(filename);
        return inMemory ? new Uint8Array(inMemory) : null;
    }

    try {
        const fileHandle = await mediaDirectory.getFileHandle(filename, { create: false });
        const file = await fileHandle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    } catch {
        return null;
    }
}

async function mediaFileExists(
    mediaDirectory: FileSystemDirectoryHandle,
    filename: string,
): Promise<boolean> {
    try {
        await mediaDirectory.getFileHandle(filename, { create: false });
        return true;
    } catch {
        return false;
    }
}

async function getMediaDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (typeof navigator === "undefined") {
        return null;
    }

    const storage = navigator.storage as StorageManager & {
        getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof storage?.getDirectory !== "function") {
        return null;
    }

    try {
        const root = await storage.getDirectory();
        return root.getDirectoryHandle(MEDIA_ROOT_DIRECTORY, { create: true });
    } catch {
        return null;
    }
}
