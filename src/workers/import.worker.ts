import { expose } from "comlink";
import { parseApkgArchive, type ParsedApkgPackage } from "@/lib/import-export/apkg-reader";
import {
    parseCsvImportText,
    type CsvParseOptions,
    type ParsedCsvData,
} from "@/lib/import-export/csv-import";

const importWorkerApi = {
    ping: () => "import-worker-ready",
    parseApkg: async (archiveBytes: Uint8Array | ArrayBuffer): Promise<ParsedApkgPackage> => {
        return parseApkgArchive(archiveBytes);
    },
    parseCsv: (text: string, options: CsvParseOptions = {}): ParsedCsvData => {
        return parseCsvImportText(text, options);
    },
};

export type ImportWorkerApi = typeof importWorkerApi;

expose(importWorkerApi);
