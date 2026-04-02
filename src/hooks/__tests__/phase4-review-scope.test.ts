import { beforeEach, describe, expect, it } from "vitest";
import { __reviewNewScope } from "@/hooks/use-review";

describe("Phase 4 review new-card scope", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("persists scoped new-card IDs by deck/day", () => {
        const scopeKey = __reviewNewScope.buildReviewScopeKey(42, 20_180);

        __reviewNewScope.persistScopedNewCardIds(scopeKey, new Set([1001, 1002]));

        const loaded = __reviewNewScope.loadScopedNewCardIds(scopeKey);
        expect(loaded).toEqual(new Set([1001, 1002]));
    });

    it("isolates scoped IDs by day", () => {
        const todayScope = __reviewNewScope.buildReviewScopeKey(7, 20_180);
        const tomorrowScope = __reviewNewScope.buildReviewScopeKey(7, 20_181);

        __reviewNewScope.persistScopedNewCardIds(todayScope, new Set([3001, 3002]));

        expect(__reviewNewScope.loadScopedNewCardIds(todayScope)).toEqual(new Set([3001, 3002]));
        expect(__reviewNewScope.loadScopedNewCardIds(tomorrowScope)).toBeNull();
    });

    it("drops malformed persisted scope payloads", () => {
        const scopeKey = __reviewNewScope.buildReviewScopeKey(99, 20_180);
        const storageKey = __reviewNewScope.scopedNewCardsStorageKey(scopeKey);

        window.localStorage.setItem(storageKey, JSON.stringify({ ids: [1, 2] }));

        expect(__reviewNewScope.loadScopedNewCardIds(scopeKey)).toBeNull();
        expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
});
