import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
    const wasmPath = join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm-browser.wasm");
    const wasmBytes = await readFile(wasmPath);

    return new Response(wasmBytes, {
        headers: {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
