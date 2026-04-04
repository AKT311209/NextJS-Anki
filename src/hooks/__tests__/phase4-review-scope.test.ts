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

    it("keeps scope stable when ordering fingerprint changes", () => {
        const baselineScope = __reviewNewScope.buildReviewScopeKey(7, 20_180, {
            newCardGatherPriority: "deck",
            newCardSortOrder: "template",
            newReviewMix: "mix-with-reviews",
            interdayLearningMix: "mix-with-reviews",
            reviewSortOrder: "due",
            newPerDay: 20,
            reviewsPerDay: 200,
            newCardsIgnoreReviewLimit: false,
        });

        const changedGatherScope = __reviewNewScope.buildReviewScopeKey(7, 20_180, {
            newCardGatherPriority: "lowest-position",
            newCardSortOrder: "template",
            newReviewMix: "mix-with-reviews",
            interdayLearningMix: "mix-with-reviews",
            reviewSortOrder: "due",
            newPerDay: 20,
            reviewsPerDay: 200,
            newCardsIgnoreReviewLimit: false,
        });

        const changedSortScope = __reviewNewScope.buildReviewScopeKey(7, 20_180, {
            newCardGatherPriority: "deck",
            newCardSortOrder: "random-card",
            newReviewMix: "mix-with-reviews",
            interdayLearningMix: "mix-with-reviews",
            reviewSortOrder: "due",
            newPerDay: 20,
            reviewsPerDay: 200,
            newCardsIgnoreReviewLimit: false,
        });

        __reviewNewScope.persistScopedNewCardIds(baselineScope, new Set([4001, 4002]));

        expect(changedGatherScope).toBe(baselineScope);
        expect(changedSortScope).toBe(baselineScope);
        expect(__reviewNewScope.loadScopedNewCardIds(baselineScope)).toEqual(new Set([4001, 4002]));
        expect(__reviewNewScope.loadScopedNewCardIds(changedGatherScope)).toEqual(new Set([4001, 4002]));
        expect(__reviewNewScope.loadScopedNewCardIds(changedSortScope)).toEqual(new Set([4001, 4002]));
    });

    it("drops malformed persisted scope payloads", () => {
        const scopeKey = __reviewNewScope.buildReviewScopeKey(99, 20_180);
        const storageKey = __reviewNewScope.scopedNewCardsStorageKey(scopeKey);

        window.localStorage.setItem(storageKey, JSON.stringify({ ids: [1, 2] }));

        expect(__reviewNewScope.loadScopedNewCardIds(scopeKey)).toBeNull();
        expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
});
