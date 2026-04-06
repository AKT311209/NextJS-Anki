"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CollectionDatabaseManager,
    type CollectionDatabaseConnection,
    type CollectionDatabaseManagerOptions,
} from "@/lib/storage/database";
import { useCollectionStore } from "@/stores/collection-store";

export interface UseCollectionOptions {
    readonly connectionId?: string;
    readonly managerOverride?: CollectionDatabaseManager;
    readonly managerOptions?: CollectionDatabaseManagerOptions;
}

export interface UseCollectionResult {
    readonly ready: boolean;
    readonly loading: boolean;
    readonly error: string | null;
    readonly manager: CollectionDatabaseManager | null;
    readonly connection: CollectionDatabaseConnection | null;
    readonly reload: () => Promise<void>;
}

let sharedManagerPromise: Promise<CollectionDatabaseManager> | null = null;
const durabilityBoundManagers = new WeakSet<CollectionDatabaseManager>();

function bindCollectionDurabilityHandlers(manager: CollectionDatabaseManager): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return;
    }

    if (durabilityBoundManagers.has(manager)) {
        return;
    }

    const flushCollection = () => {
        void manager.saveNow();
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
            flushCollection();
        }
    };

    window.addEventListener("pagehide", flushCollection);
    window.addEventListener("beforeunload", flushCollection);
    document.addEventListener("visibilitychange", onVisibilityChange);

    durabilityBoundManagers.add(manager);
}

async function getSharedManager(
    options: CollectionDatabaseManagerOptions | undefined,
): Promise<CollectionDatabaseManager> {
    if (!sharedManagerPromise) {
        sharedManagerPromise = (async () => {
            const manager = new CollectionDatabaseManager(options);
            await manager.initialize();
            return manager;
        })();
    }

    return sharedManagerPromise;
}

export function useCollection(options: UseCollectionOptions = {}): UseCollectionResult {
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [manager, setManager] = useState<CollectionDatabaseManager | null>(null);
    const [connection, setConnection] = useState<CollectionDatabaseConnection | null>(null);
    const setCollectionReady = useCollectionStore((state) => state.setReady);

    const connectionId = options.connectionId ?? "main";

    const initialize = useCallback(async () => {
        if (typeof window === "undefined") {
            setLoading(false);
            setReady(false);
            setCollectionReady(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const nextManager = options.managerOverride
                ? options.managerOverride
                : await getSharedManager(options.managerOptions);

            if (options.managerOverride) {
                await nextManager.initialize();
            }

            bindCollectionDurabilityHandlers(nextManager);

            const nextConnection = await nextManager.getConnection(connectionId);

            setManager(nextManager);
            setConnection(nextConnection);
            setReady(true);
            setCollectionReady(true);
            setLoading(false);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to initialize collection.";
            setError(message);
            setReady(false);
            setConnection(null);
            setCollectionReady(false);
            setLoading(false);
        }
    }, [connectionId, options.managerOptions, options.managerOverride, setCollectionReady]);

    useEffect(() => {
        let disposed = false;

        queueMicrotask(() => {
            if (disposed) {
                return;
            }
            void initialize();
        });

        return () => {
            disposed = true;
        };
    }, [initialize]);

    return useMemo(
        () => ({
            ready,
            loading,
            error,
            manager,
            connection,
            reload: initialize,
        }),
        [ready, loading, error, manager, connection, initialize],
    );
}
