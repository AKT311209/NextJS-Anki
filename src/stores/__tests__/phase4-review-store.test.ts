import { beforeEach, describe, expect, it } from "vitest";
import { CardQueue, CardType, type Card } from "@/lib/types/card";
import type { ReviewRating, SchedulerPreview } from "@/lib/types/scheduler";
import { DEFAULT_SCHEDULER_CONFIG } from "@/lib/types/scheduler";
import { useReviewStore, type ActiveReviewCard } from "@/stores/review-store";

const NOW = new Date("2026-04-01T12:00:00.000Z");

describe("Phase 4 review store", () => {
    beforeEach(() => {
        useReviewStore.getState().reset();
    });

    it("starts in question mode and reveals answer", () => {
        const current = createActiveCard(1001);

        useReviewStore.getState().startSession({
            deckId: 1,
            config: DEFAULT_SCHEDULER_CONFIG,
            queueResult: {
                now: NOW,
                cards: [current.card],
                counts: { learning: 0, review: 0, new: 1 },
            },
            currentCard: current,
        });

        let state = useReviewStore.getState();
        expect(state.stage).toBe("question");
        expect(state.currentCard?.card.id).toBe(1001);
        expect(state.queue).toHaveLength(1);

        state.revealAnswer();
        state = useReviewStore.getState();
        expect(state.stage).toBe("answer");
    });

    it("records answers and applies undo snapshots", () => {
        const first = createActiveCard(2001);
        const second = createActiveCard(2002);

        useReviewStore.getState().startSession({
            deckId: 1,
            config: DEFAULT_SCHEDULER_CONFIG,
            queueResult: {
                now: NOW,
                cards: [first.card, second.card],
                counts: { learning: 1, review: 1, new: 0 },
            },
            currentCard: first,
        });

        useReviewStore.getState().recordAnswer({
            queueResult: {
                now: NOW,
                cards: [second.card],
                counts: { learning: 0, review: 1, new: 0 },
            },
            nextCard: second,
            undoEntry: {
                revlogId: 999001,
                previousCard: first.card,
                previousSiblingCards: [],
                rating: "good",
                answeredAt: NOW.getTime(),
            },
        });

        let state = useReviewStore.getState();
        expect(state.answered).toBe(1);
        expect(state.currentCard?.card.id).toBe(2002);
        expect(state.history).toHaveLength(1);
        expect(state.stage).toBe("question");

        useReviewStore.getState().applyUndo({
            queueResult: {
                now: NOW,
                cards: [first.card, second.card],
                counts: { learning: 1, review: 1, new: 0 },
            },
            currentCard: first,
        });

        state = useReviewStore.getState();
        expect(state.answered).toBe(0);
        expect(state.currentCard?.card.id).toBe(2001);
        expect(state.history).toHaveLength(0);
        expect(state.stage).toBe("question");
    });

    it("moves to completed when queue is empty", () => {
        useReviewStore.getState().startSession({
            deckId: 1,
            config: DEFAULT_SCHEDULER_CONFIG,
            queueResult: {
                now: NOW,
                cards: [],
                counts: { learning: 0, review: 0, new: 0 },
            },
            currentCard: null,
        });

        const state = useReviewStore.getState();
        expect(state.stage).toBe("completed");
        expect(state.currentCard).toBeNull();
    });
});

function createActiveCard(cardId: number): ActiveReviewCard {
    const card = createCard(cardId);

    return {
        card,
        questionHtml: `<div>Question ${cardId}</div>`,
        answerHtml: `<div>Answer ${cardId}</div>`,
        css: ".card { color: red; }",
        templateName: "Basic",
        preview: createPreview(card),
        intervalLabels: {
            again: "<1m",
            hard: "<10m",
            good: "<1d",
            easy: "4d",
        },
        audioTags: {
            question: [],
            answer: [],
        },
    };
}

function createCard(cardId: number): Card {
    return {
        id: cardId,
        nid: cardId * 10,
        did: 1,
        ord: 0,
        mod: NOW.getTime(),
        usn: 0,
        type: CardType.New,
        queue: CardQueue.New,
        due: 0,
        ivl: 0,
        factor: 2500,
        reps: 0,
        lapses: 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: "",
    };
}

function createPreview(card: Card): SchedulerPreview {
    return {
        again: createPreviewTransition(card, "again"),
        hard: createPreviewTransition(card, "hard"),
        good: createPreviewTransition(card, "good"),
        easy: createPreviewTransition(card, "easy"),
    };
}

function createPreviewTransition(card: Card, rating: ReviewRating): SchedulerPreview[ReviewRating] {
    return {
        rating,
        nextCard: card,
        due: NOW,
        scheduledDays: 0,
        reviewKind: 0,
    };
}
