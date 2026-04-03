"use client";

import { releaseProxy, wrap, type Remote } from "comlink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCollection } from "@/hooks/use-collection";
import {
    exportCollectionAsApkg,
    triggerApkgDownload,
    type ApkgExportSummary,
} from "@/lib/import-export/apkg-writer";
import {
    importParsedApkg,
    type ApkgImportSummary,
} from "@/lib/import-export/apkg-reader";
import {
    importParsedCsv,
    suggestCsvFieldMapping,
    type CsvDelimiter,
    type CsvImportSummary,
    type ParsedCsvData,
} from "@/lib/import-export/csv-import";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { NotetypesRepository, type NotetypeRecord } from "@/lib/storage/repositories/notetypes";
import type { ImportWorkerApi } from "@/workers/import.worker";

type DelimiterSelection = "auto" | CsvDelimiter;

interface ExportUiSummary {
    readonly fileName: string;
    readonly stats: ApkgExportSummary;
}

export default function ImportPage() {
    const collection = useCollection();

    const [decks, setDecks] = useState<DeckRecord[]>([]);
    const [notetypes, setNotetypes] = useState<NotetypeRecord[]>([]);

    const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
    const [selectedNotetypeId, setSelectedNotetypeId] = useState<number | null>(null);

    const [apkgFile, setApkgFile] = useState<File | null>(null);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvParsed, setCsvParsed] = useState<ParsedCsvData | null>(null);
    const [csvFieldMapping, setCsvFieldMapping] = useState<number[]>([]);

    const [csvHasHeader, setCsvHasHeader] = useState(false);
    const [csvDelimiter, setCsvDelimiter] = useState<DelimiterSelection>("auto");
    const [mediaConflict, setMediaConflict] = useState<"skip" | "overwrite">("skip");

    const [includeMediaOnExport, setIncludeMediaOnExport] = useState(true);
    const [exportDeckSelection, setExportDeckSelection] = useState<number | null>(null);

    const [busy, setBusy] = useState<null | "apkg" | "csv-preview" | "csv-import" | "export">(null);
    const [error, setError] = useState<string | null>(null);
    const [logMessages, setLogMessages] = useState<string[]>([]);

    const [apkgSummary, setApkgSummary] = useState<ApkgImportSummary | null>(null);
    const [csvSummary, setCsvSummary] = useState<CsvImportSummary | null>(null);
    const [exportSummary, setExportSummary] = useState<ExportUiSummary | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const workerApiRef = useRef<Remote<ImportWorkerApi> | null>(null);

    const appendLog = useCallback((message: string) => {
        setLogMessages((current) => {
            const next = [...current, message];
            return next.slice(-20);
        });
    }, []);

    const selectedNotetype = useMemo(
        () => notetypes.find((entry) => entry.id === selectedNotetypeId) ?? null,
        [notetypes, selectedNotetypeId],
    );

    const selectedNotetypeFieldNames = useMemo(
        () => parseNotetypeFieldNames(selectedNotetype?.flds),
        [selectedNotetype?.flds],
    );

    const isBusy = busy !== null;

    const loadImportOptions = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        await ensureCollectionBootstrap(collection.connection);

        const decksRepository = new DecksRepository(collection.connection);
        const notetypesRepository = new NotetypesRepository(collection.connection);
        const [deckRows, notetypeRows] = await Promise.all([
            decksRepository.list(),
            notetypesRepository.list(),
        ]);

        setDecks(deckRows);
        setNotetypes(notetypeRows);

        setSelectedDeckId((current) => {
            if (current !== null && deckRows.some((deck) => deck.id === current)) {
                return current;
            }
            return deckRows[0]?.id ?? null;
        });

        setExportDeckSelection((current) => {
            if (current === null) {
                return null;
            }
            if (deckRows.some((deck) => deck.id === current)) {
                return current;
            }
            return null;
        });

        setSelectedNotetypeId((current) => {
            if (current !== null && notetypeRows.some((notetype) => notetype.id === current)) {
                return current;
            }

            const basic = notetypeRows.find((entry) => entry.name === "Basic");
            return basic?.id ?? notetypeRows[0]?.id ?? null;
        });
    }, [collection.connection, collection.ready]);

    useEffect(() => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        void loadImportOptions();
    }, [collection.connection, collection.ready, loadImportOptions]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const worker = new Worker(new URL("../../workers/import.worker.ts", import.meta.url), {
            type: "module",
        });
        const workerApi = wrap<ImportWorkerApi>(worker);

        workerRef.current = worker;
        workerApiRef.current = workerApi;

        return () => {
            if (workerApiRef.current) {
                void workerApiRef.current[releaseProxy]();
            }
            worker.terminate();
            workerRef.current = null;
            workerApiRef.current = null;
        };
    }, []);

    const parseCsvPreview = useCallback(
        async (file: File, options?: { preserveCurrentMapping?: boolean }) => {
            const workerApi = workerApiRef.current;
            if (!workerApi) {
                throw new Error("Import worker is not ready yet.");
            }

            setBusy("csv-preview");
            setError(null);
            setCsvSummary(null);
            appendLog("Parsing CSV preview...");

            try {
                const parsed = await workerApi.parseCsv(file ? await file.text() : "", {
                    delimiter: csvDelimiter === "auto" ? undefined : csvDelimiter,
                    hasHeader: csvHasHeader,
                });

                setCsvParsed(parsed);
                setCsvFieldMapping((current) => {
                    if (options?.preserveCurrentMapping && current.length === selectedNotetypeFieldNames.length) {
                        return current;
                    }

                    return suggestCsvFieldMapping(parsed, selectedNotetypeFieldNames.length);
                });

                appendLog(`CSV parsed: ${parsed.rows.length} row(s), ${parsed.columnCount} column(s).`);
            } finally {
                setBusy(null);
            }
        },
        [appendLog, csvDelimiter, csvHasHeader, selectedNotetypeFieldNames.length],
    );

    const onSelectCsvFile = useCallback(
        async (file: File | null) => {
            setCsvFile(file);
            setCsvParsed(null);
            setCsvFieldMapping([]);
            if (!file) {
                return;
            }

            try {
                await parseCsvPreview(file);
            } catch (cause) {
                const message = cause instanceof Error ? cause.message : "Failed to parse CSV file.";
                setError(message);
                appendLog(`CSV parse failed: ${message}`);
            }
        },
        [appendLog, parseCsvPreview],
    );

    const handleApkgImport = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }
        if (!apkgFile) {
            setError("Choose an APKG file first.");
            return;
        }

        const workerApi = workerApiRef.current;
        if (!workerApi) {
            setError("Import worker is not ready yet.");
            return;
        }

        setBusy("apkg");
        setError(null);
        setApkgSummary(null);
        setCsvSummary(null);
        appendLog(`Reading ${apkgFile.name}...`);

        try {
            const archiveBytes = new Uint8Array(await apkgFile.arrayBuffer());

            appendLog("Parsing APKG archive in worker...");
            const parsed = await workerApi.parseApkg(archiveBytes);

            appendLog("Applying APKG import into local collection...");
            const summary = await importParsedApkg(collection.connection, parsed, {
                mediaConflictStrategy: mediaConflict,
                importMedia: true,
                onProgress: appendLog,
            });

            setApkgSummary(summary);
            appendLog("APKG import completed.");

            await collection.manager?.saveNow();
            await loadImportOptions();
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "APKG import failed.";
            setError(message);
            appendLog(`APKG import failed: ${message}`);
        } finally {
            setBusy(null);
        }
    }, [
        apkgFile,
        appendLog,
        collection.connection,
        collection.manager,
        collection.ready,
        loadImportOptions,
        mediaConflict,
    ]);

    const handleCsvImport = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }
        if (!csvParsed || selectedNotetypeId === null) {
            setError("Parse a CSV file and select a notetype first.");
            return;
        }

        setBusy("csv-import");
        setError(null);
        setApkgSummary(null);
        setCsvSummary(null);

        try {
            appendLog("Importing CSV rows...");
            const summary = await importParsedCsv(collection.connection, {
                parsed: csvParsed,
                notetypeId: selectedNotetypeId,
                deckId: selectedDeckId ?? undefined,
                fieldMapping: csvFieldMapping,
                onProgress: appendLog,
            });

            setCsvSummary(summary);
            appendLog("CSV import completed.");

            await collection.manager?.saveNow();
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "CSV import failed.";
            setError(message);
            appendLog(`CSV import failed: ${message}`);
        } finally {
            setBusy(null);
        }
    }, [
        appendLog,
        collection.connection,
        collection.manager,
        collection.ready,
        csvFieldMapping,
        csvParsed,
        selectedDeckId,
        selectedNotetypeId,
    ]);

    const handleApkgExport = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        setBusy("export");
        setError(null);
        setExportSummary(null);

        try {
            appendLog("Generating APKG export...");
            const result = await exportCollectionAsApkg(collection.connection, {
                deckId: exportDeckSelection ?? undefined,
                includeMedia: includeMediaOnExport,
                onProgress: appendLog,
            });

            triggerApkgDownload(result);
            setExportSummary({
                fileName: result.fileName,
                stats: result.summary,
            });
            appendLog(`Exported ${result.fileName}.`);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "APKG export failed.";
            setError(message);
            appendLog(`APKG export failed: ${message}`);
        } finally {
            setBusy(null);
        }
    }, [
        appendLog,
        collection.connection,
        collection.ready,
        exportDeckSelection,
        includeMediaOnExport,
    ]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <div className="flex items-center gap-3">
                    <Link
                        href="/"
                        className="text-sm text-slate-400 transition hover:text-slate-200"
                    >
                        &larr; Back to decks
                    </Link>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Import & Export</h1>
                <p className="max-w-3xl text-sm text-slate-300 sm:text-base">
                    Import Anki <code>.apkg</code> packages or CSV/TSV files, and export your collection
                    back to <code>.apkg</code>.
                </p>
            </header>

            {collection.loading ? (
                <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                    Initializing collection...
                </section>
            ) : null}

            {(collection.error || error) ? (
                <section className="rounded-lg border border-rose-700/50 bg-rose-950/40 p-4 text-sm text-rose-200">
                    {collection.error ?? error}
                </section>
            ) : null}

            <section className="grid gap-6 lg:grid-cols-2">
                <article className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                    <h2 className="text-lg font-semibold text-slate-100">Import `.apkg`</h2>
                    <p className="text-sm text-slate-300">
                        Parses the package in a worker, then merges notes/cards/review history into your current collection.
                        Duplicate notes are detected by GUID, and cards from those duplicate notes are imported as
                        separate card entries.
                    </p>

                    <label className="block text-sm text-slate-200">
                        APKG file
                        <input
                            className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                            type="file"
                            accept=".apkg,.zip"
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null;
                                setApkgFile(file);
                            }}
                            disabled={isBusy || !collection.ready}
                        />
                    </label>

                    <label className="block text-sm text-slate-200">
                        Media conflict strategy
                        <select
                            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                            value={mediaConflict}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                setMediaConflict(value === "overwrite" ? "overwrite" : "skip");
                            }}
                            disabled={isBusy || !collection.ready}
                        >
                            <option value="skip">Skip existing files</option>
                            <option value="overwrite">Overwrite existing files</option>
                        </select>
                    </label>

                    <button
                        type="button"
                        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleApkgImport()}
                        disabled={!apkgFile || isBusy || !collection.ready}
                    >
                        {busy === "apkg" ? "Importing..." : "Import APKG"}
                    </button>

                    {apkgSummary ? (
                        <div className="rounded-md border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                            <p className="font-semibold">Import summary</p>
                            <ul className="mt-2 space-y-1">
                                <li>
                                    Imported: {apkgSummary.imported.notes} notes, {apkgSummary.imported.cards} cards,
                                    {" "}
                                    {apkgSummary.imported.cardsFromDuplicateNotes} cards from duplicate notes,
                                    {" "}
                                    {apkgSummary.imported.revlog} revlog, {apkgSummary.imported.media} media
                                </li>
                                <li>
                                    Skipped: {apkgSummary.skipped.duplicateNotes} duplicate notes,
                                    {" "}
                                    {apkgSummary.skipped.revlogWithoutCards} revlog entries without imported cards,
                                    {" "}
                                    {apkgSummary.skipped.media} media
                                </li>
                            </ul>
                        </div>
                    ) : null}
                </article>

                <article className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                    <h2 className="text-lg font-semibold text-slate-100">Import CSV / TSV</h2>
                    <p className="text-sm text-slate-300">
                        Parse text files with a preview, map columns to notetype fields, then import with duplicate detection.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm text-slate-200">
                            Delimiter
                            <select
                                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                                value={csvDelimiter}
                                onChange={(event) => {
                                    const raw = event.currentTarget.value;
                                    setCsvDelimiter(
                                        raw === "\t" || raw === "," || raw === ";" || raw === "|"
                                            ? raw
                                            : "auto",
                                    );
                                }}
                                disabled={isBusy || !collection.ready}
                            >
                                <option value="auto">Auto-detect</option>
                                <option value=",">Comma (,)</option>
                                <option value="\t">Tab (\t)</option>
                                <option value=";">Semicolon (;)</option>
                                <option value="|">Pipe (|)</option>
                            </select>
                        </label>

                        <label className="block text-sm text-slate-200">
                            Target deck
                            <select
                                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                                value={selectedDeckId ?? ""}
                                onChange={(event) => {
                                    const parsed = Number.parseInt(event.currentTarget.value, 10);
                                    setSelectedDeckId(Number.isFinite(parsed) ? parsed : null);
                                }}
                                disabled={isBusy || !collection.ready}
                            >
                                {decks.map((deck) => (
                                    <option key={deck.id} value={deck.id}>
                                        {deck.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm text-slate-200">
                            Notetype
                            <select
                                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                                value={selectedNotetypeId ?? ""}
                                onChange={(event) => {
                                    const parsed = Number.parseInt(event.currentTarget.value, 10);
                                    setSelectedNotetypeId(Number.isFinite(parsed) ? parsed : null);
                                }}
                                disabled={isBusy || !collection.ready}
                            >
                                {notetypes.map((notetype) => (
                                    <option key={notetype.id} value={notetype.id}>
                                        {notetype.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-slate-200 sm:mt-8">
                            <input
                                type="checkbox"
                                className="size-4 rounded border-slate-600 bg-slate-950"
                                checked={csvHasHeader}
                                onChange={(event) => setCsvHasHeader(event.currentTarget.checked)}
                                disabled={isBusy || !collection.ready}
                            />
                            First row is header
                        </label>
                    </div>

                    <label className="block text-sm text-slate-200">
                        CSV/TSV file
                        <input
                            className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                            type="file"
                            accept=".csv,.tsv,.txt"
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null;
                                void onSelectCsvFile(file);
                            }}
                            disabled={isBusy || !collection.ready}
                        />
                    </label>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                                if (csvFile) {
                                    void parseCsvPreview(csvFile, { preserveCurrentMapping: true });
                                }
                            }}
                            disabled={!csvFile || isBusy || !collection.ready}
                        >
                            {busy === "csv-preview" ? "Parsing..." : "Refresh preview"}
                        </button>

                        <button
                            type="button"
                            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleCsvImport()}
                            disabled={!csvParsed || selectedNotetypeId === null || isBusy || !collection.ready}
                        >
                            {busy === "csv-import" ? "Importing..." : "Import CSV"}
                        </button>
                    </div>

                    {csvParsed ? (
                        <div className="space-y-3 rounded-md border border-slate-700/60 bg-slate-950/60 p-3">
                            <p className="text-xs text-slate-300">
                                Parsed {csvParsed.rows.length} row(s), {csvParsed.columnCount} column(s), delimiter:
                                {" "}
                                <code>{csvParsed.delimiter === "\t" ? "tab" : csvParsed.delimiter}</code>
                            </p>

                            <div className="grid gap-2">
                                {selectedNotetypeFieldNames.map((fieldName, fieldOrdinal) => (
                                    <label
                                        key={`${fieldName}-${fieldOrdinal}`}
                                        className="flex items-center gap-2 text-xs text-slate-200"
                                    >
                                        <span className="w-36 shrink-0">{fieldName}</span>
                                        <select
                                            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                                            value={csvFieldMapping[fieldOrdinal] ?? -1}
                                            onChange={(event) => {
                                                const mapped = Number.parseInt(event.currentTarget.value, 10);
                                                setCsvFieldMapping((current) => {
                                                    const next = [...current];
                                                    next[fieldOrdinal] = Number.isFinite(mapped) ? mapped : -1;
                                                    return next;
                                                });
                                            }}
                                            disabled={isBusy}
                                        >
                                            <option value={-1}>Ignore field</option>
                                            {csvParsed.headers.map((header, columnIndex) => (
                                                <option key={`${header}-${columnIndex}`} value={columnIndex}>
                                                    {header || `Column ${columnIndex + 1}`}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>

                            <div className="overflow-x-auto rounded border border-slate-800">
                                <table className="min-w-full divide-y divide-slate-800 text-xs">
                                    <thead className="bg-slate-900 text-slate-300">
                                        <tr>
                                            {csvParsed.headers.map((header, index) => (
                                                <th key={`${header}-${index}`} className="px-2 py-1 text-left font-medium">
                                                    {header || `Column ${index + 1}`}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 text-slate-200">
                                        {csvParsed.rows.slice(0, 8).map((row, rowIndex) => (
                                            <tr key={`preview-row-${rowIndex}`}>
                                                {row.map((cell, cellIndex) => (
                                                    <td key={`preview-cell-${rowIndex}-${cellIndex}`} className="px-2 py-1">
                                                        {cell}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {csvSummary ? (
                        <div className="rounded-md border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                            Imported {csvSummary.importedNotes} notes / {csvSummary.importedCards} cards, skipped
                            {" "}
                            {csvSummary.skippedRows} empty row(s), {csvSummary.duplicateRows} duplicate row(s).
                        </div>
                    ) : null}
                </article>
            </section>

            <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                <h2 className="text-lg font-semibold text-slate-100">Export `.apkg`</h2>
                <p className="text-sm text-slate-300">
                    Export the full collection or a single deck as an Anki-compatible package.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-slate-200">
                        Deck scope
                        <select
                            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                            value={exportDeckSelection ?? "all"}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (value === "all") {
                                    setExportDeckSelection(null);
                                    return;
                                }

                                const parsed = Number.parseInt(value, 10);
                                setExportDeckSelection(Number.isFinite(parsed) ? parsed : null);
                            }}
                            disabled={isBusy || !collection.ready}
                        >
                            <option value="all">All decks</option>
                            {decks.map((deck) => (
                                <option key={deck.id} value={deck.id}>
                                    {deck.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2 text-sm text-slate-200 sm:mt-8">
                        <input
                            type="checkbox"
                            className="size-4 rounded border-slate-600 bg-slate-950"
                            checked={includeMediaOnExport}
                            onChange={(event) => setIncludeMediaOnExport(event.currentTarget.checked)}
                            disabled={isBusy || !collection.ready}
                        />
                        Include media files
                    </label>
                </div>

                <button
                    type="button"
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleApkgExport()}
                    disabled={isBusy || !collection.ready}
                >
                    {busy === "export" ? "Exporting..." : "Export APKG"}
                </button>

                {exportSummary ? (
                    <div className="rounded-md border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                        Exported <strong>{exportSummary.fileName}</strong> with {exportSummary.stats.notes} notes,
                        {" "}
                        {exportSummary.stats.cards} cards, {exportSummary.stats.revlog} revlog entries,
                        {" "}
                        {exportSummary.stats.media} media file(s).
                    </div>
                ) : null}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
                <h2 className="text-lg font-semibold text-slate-100">Progress log</h2>
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                    {logMessages.length === 0 ? <li>No operations yet.</li> : null}
                    {logMessages.map((message, index) => (
                        <li key={`log-${index}`}>• {message}</li>
                    ))}
                </ul>
            </section>
        </main>
    );
}

function parseNotetypeFieldNames(raw: unknown[] | undefined): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        return ["Front", "Back"];
    }

    return raw
        .map((value, index) => {
            if (!value || typeof value !== "object") {
                return `Field ${index + 1}`;
            }

            const typed = value as Record<string, unknown>;
            const name = typed.name;
            if (typeof name === "string" && name.trim().length > 0) {
                return name;
            }

            return `Field ${index + 1}`;
        })
        .filter((name) => name.trim().length > 0);
}
