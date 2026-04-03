type FsrsBrowserModule = typeof import("fsrs-browser");

type FsrsInstance = InstanceType<FsrsBrowserModule["Fsrs"]>;
type FsrsItemState = {
    readonly interval: number;
    readonly memory: {
        readonly stability: number;
        readonly difficulty: number;
        free: () => void;
    };
    free: () => void;
};

export interface FsrsStateSnapshot {
    readonly intervalDays: number;
    readonly stability: number;
    readonly difficulty: number;
}

export interface FsrsNextStatesSnapshot {
    readonly again: FsrsStateSnapshot;
    readonly hard: FsrsStateSnapshot;
    readonly good: FsrsStateSnapshot;
    readonly easy: FsrsStateSnapshot;
}

export interface FsrsSchedulerInput {
    readonly desiredRetention: number;
    readonly daysElapsed: number;
    readonly stability?: number;
    readonly difficulty?: number;
}

export interface FsrsAnkiOptimizationSample {
    readonly id: number;
    readonly cid: number;
    readonly ease: number;
    readonly type: number;
}

export const DEFAULT_FSRS_WEIGHTS: readonly number[] = [
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542,
] as const;

let fsrsBrowserModule: FsrsBrowserModule | null = null;
let initPromise: Promise<FsrsBrowserModule> | null = null;

function getOrInitModule(): Promise<FsrsBrowserModule> {
    if (fsrsBrowserModule) return Promise.resolve(fsrsBrowserModule);
    if (!initPromise) {
        initPromise = loadFsrsBrowserModule().then((m) => {
            fsrsBrowserModule = m;
            return m;
        });
    }
    return initPromise;
}

/**
 * Pre-load the FSRS WASM module. Call this early in the app lifecycle
 * (e.g. inside a useEffect) to ensure the module is ready before
 * synchronous helpers like {@link createFsrsScheduler} are used.
 */
export async function initFsrs(): Promise<void> {
    await getOrInitModule();
}

// Auto-start loading on the client so it's ready by first use.
if (typeof window !== "undefined") {
    getOrInitModule();
}

export function createFsrsScheduler(weights?: readonly number[]): FsrsInstance {
    if (!fsrsBrowserModule) {
        throw new Error("FSRS WASM module not loaded yet — call initFsrs() first");
    }
    const normalized = normalizeFsrsWeights(weights);
    return new fsrsBrowserModule.Fsrs(new Float32Array(normalized));
}

export function computeNextFsrsStates(
    fsrs: FsrsInstance,
    input: FsrsSchedulerInput,
): FsrsNextStatesSnapshot {
    const nextStates = fsrs.nextStates(
        normalizeOptionalNumber(input.stability),
        normalizeOptionalNumber(input.difficulty),
        input.desiredRetention,
        Math.max(0, Math.trunc(input.daysElapsed)),
    );

    try {
        return {
            again: readItemState(nextStates.again),
            hard: readItemState(nextStates.hard),
            good: readItemState(nextStates.good),
            easy: readItemState(nextStates.easy),
        };
    } finally {
        nextStates.free();
    }
}

export function computeFsrsParametersAnki(
    reviews: readonly FsrsAnkiOptimizationSample[],
    enableShortTerm: boolean,
): number[] {
    if (reviews.length === 0) {
        return [...DEFAULT_FSRS_WEIGHTS];
    }

    const sorted = [...reviews].sort((left, right) => {
        if (left.cid === right.cid) {
            return left.id - right.id;
        }
        return left.cid - right.cid;
    });

    const cids = new BigInt64Array(sorted.map((review) => BigInt(Math.trunc(review.cid))));
    const ids = new BigInt64Array(sorted.map((review) => BigInt(Math.trunc(review.id))));
    const eases = new Uint8Array(sorted.map((review) => clampToByte(review.ease)));
    const types = new Uint8Array(sorted.map((review) => clampToByte(review.type)));

    const scheduler = createFsrsScheduler();
    try {
        const minuteOffset = -new Date().getTimezoneOffset();
        const optimized = scheduler.computeParametersAnki(
            minuteOffset,
            cids,
            eases,
            ids,
            types,
            undefined,
            enableShortTerm,
        );

        return normalizeFsrsWeights(Array.from(optimized));
    } finally {
        scheduler.free();
    }
}

export function normalizeFsrsWeights(weights: readonly number[] | undefined): number[] {
    const normalized = [...DEFAULT_FSRS_WEIGHTS];

    if (!weights || weights.length === 0) {
        return normalized;
    }

    for (let index = 0; index < normalized.length; index += 1) {
        const candidate = weights[index];
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            normalized[index] = candidate;
        }
    }

    return normalized;
}

function readItemState(itemState: FsrsItemState): FsrsStateSnapshot {
    const memory = itemState.memory;

    try {
        return {
            intervalDays: finiteNonNegative(itemState.interval),
            stability: finiteNonNegative(memory.stability),
            difficulty: finiteNonNegative(memory.difficulty),
        };
    } finally {
        memory.free();
        itemState.free();
    }
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

function finiteNonNegative(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, value);
}

function clampToByte(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(255, Math.max(0, Math.trunc(value)));
}

async function loadFsrsBrowserModule(): Promise<FsrsBrowserModule> {
    patchGlobalScopeForWorkerBindings();

    const fsrsModule = await import("fsrs-browser");

    try {
        await fsrsModule.default();
    } catch {
        // Turbopack can produce an import.meta.url that new URL() cannot parse,
        // causing the default WASM resolution to fail.  Fall back to an explicit
        // path served from public/wasm/ (kept in sync via postinstall).
        if (typeof window !== "undefined") {
            await fsrsModule.default("/wasm/fsrs_browser_bg.wasm");
        } else {
            throw new Error("Failed to initialize FSRS WASM module");
        }
    }

    return fsrsModule;
}

function patchGlobalScopeForWorkerBindings(): void {
    const scope = globalThis as Record<string, unknown>;

    if (!("self" in scope) || scope.self === undefined || scope.self === null) {
        scope.self = scope;
    }

    const workerScope = scope.self as Record<string, unknown>;

    if (typeof workerScope.addEventListener === "function" && typeof workerScope.removeEventListener === "function") {
        return;
    }

    const listeners = new Map<string, Set<(event: { readonly type: string; readonly data?: unknown }) => void>>();

    workerScope.addEventListener = (
        type: string,
        listener: (event: { readonly type: string; readonly data?: unknown }) => void,
    ) => {
        const existing = listeners.get(type) ?? new Set();
        existing.add(listener);
        listeners.set(type, existing);
    };

    workerScope.removeEventListener = (
        type: string,
        listener: (event: { readonly type: string; readonly data?: unknown }) => void,
    ) => {
        listeners.get(type)?.delete(listener);
    };

    if (typeof workerScope.postMessage !== "function") {
        workerScope.postMessage = () => {
            // No-op shim for non-worker runtimes.
        };
    }
}
