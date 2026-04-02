import "@testing-library/jest-dom/vitest";

if (typeof globalThis.self === "undefined") {
    (globalThis as Record<string, unknown>).self = globalThis;
}

const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.protocol === "file:") {
        const { readFile } = await import("node:fs/promises");
        const body = await readFile(url);

        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": url.pathname.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
            },
        });
    }

    return nativeFetch(input, init);
};
