import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { resolveSchedulerConfig, schedulerOverridesFromUnknown } from "@/lib/scheduler/params";
import { CardQueue, type Card } from "@/lib/types/card";
import type {
    QueueBuildRequest,
    QueueBuildResult,
    SchedulerConfig,
    SchedulerReviewMix,
} from "@/lib/types/scheduler";
import { toDayNumber } from "@/lib/scheduler/states";

type LimitKind = "new" | "review";
type BuryKind = "new" | "review" | "interday-learning";

interface SiblingBuryMode {
    readonly buryNew: boolean;
    readonly buryReviews: boolean;
    readonly buryInterdayLearning: boolean;
}

interface DeckLimitState {
    reviewLimit: number;
    newLimit: number;
    capNewToReview: boolean;
}

interface DeckScopeContext {
    readonly activeDeckIds: readonly number[];
    readonly rootDeckIds: readonly number[];
    readonly limitsByDeckId: Map<number, DeckLimitState>;
    readonly parentDeckIdByDeckId: Map<number, number | null>;
    readonly childDeckIdsByDeckId: Map<number, number[]>;
    readonly buryModeByDeckId: Map<number, SiblingBuryMode>;
}

export class SchedulerQueueBuilder {
    public constructor(private readonly connection: CollectionDatabaseConnection) { }

    public async buildQueue(request: QueueBuildRequest): Promise<QueueBuildResult> {
        const config = resolveSchedulerConfig(request.config);
        const now = request.now;
        const nowMs = now.getTime();
        const learnAheadCutoffMs = nowMs + config.learnAheadSeconds * 1000;
        const today = toDayNumber(now);
        const buriedIds = request.buriedCardIds ?? new Set<number>();
        const scopeContext = await this.resolveDeckScopeContext(request.deckId, config);
        const activeDeckIds = scopeContext?.activeDeckIds;

        const [
            learningIntradayDueNow,
            learningIntradayDueAhead,
            learningInterdayDue,
            reviewCards,
            allNewCards,
        ] = await Promise.all([
            this.selectCardsByDueRange(CardQueue.Learning, undefined, nowMs, activeDeckIds),
            this.selectCardsByDueRange(CardQueue.Learning, nowMs + 1, learnAheadCutoffMs, activeDeckIds),
            this.selectDueCards(CardQueue.DayLearning, today, activeDeckIds),
            this.selectDueCards(CardQueue.Review, today, activeDeckIds),
            this.selectDueCards(CardQueue.New, Number.MAX_SAFE_INTEGER, activeDeckIds),
        ]);

        const allowedNewCardIds = request.allowedNewCardIds;
        const newCards = allowedNewCardIds
            ? allNewCards.filter((card) => allowedNewCardIds.has(card.id))
            : allNewCards;

        const intradayNow = this.filterVisibleCards(learningIntradayDueNow, buriedIds);
        const intradayAhead = this.filterVisibleCards(learningIntradayDueAhead, buriedIds);
        const interday = this.filterVisibleCards(learningInterdayDue, buriedIds);
        const review = this.filterVisibleCards(reviewCards, buriedIds);
        const fresh = this.filterVisibleCards(newCards, buriedIds);

        const seenNoteModes = new Map<number, SiblingBuryMode>();
        for (const card of intradayNow) {
            this.getAndUpdateSeenBuryMode(
                seenNoteModes,
                card.nid,
                this.resolveCardBuryMode(card, config, scopeContext),
            );
        }
        for (const card of intradayAhead) {
            this.getAndUpdateSeenBuryMode(
                seenNoteModes,
                card.nid,
                this.resolveCardBuryMode(card, config, scopeContext),
            );
        }

        let flatReviewLimit = Math.max(0, Math.trunc(config.limits.reviewsPerDay));
        let flatNewLimit = Math.max(0, Math.trunc(config.limits.newPerDay));

        if (!config.newCardsIgnoreReviewLimit) {
            flatNewLimit = Math.min(flatNewLimit, flatReviewLimit);
        }

        const rootLimitReached = (kind: LimitKind): boolean => {
            if (scopeContext) {
                return this.rootLimitReached(scopeContext, kind);
            }

            return kind === "review" ? flatReviewLimit <= 0 : flatNewLimit <= 0;
        };

        const deckLimitReached = (deckId: number, kind: LimitKind): boolean => {
            if (scopeContext) {
                return this.deckLimitReached(scopeContext, deckId, kind);
            }

            return kind === "review" ? flatReviewLimit <= 0 : flatNewLimit <= 0;
        };

        const consumeLimit = (deckId: number, kind: LimitKind): void => {
            if (scopeContext) {
                this.decrementDeckAndParentLimits(scopeContext, deckId, kind);
                return;
            }

            if (kind === "review") {
                flatReviewLimit = Math.max(0, flatReviewLimit - 1);
                if (!config.newCardsIgnoreReviewLimit) {
                    flatNewLimit = Math.min(flatNewLimit, flatReviewLimit);
                }
            } else {
                flatNewLimit = Math.max(0, flatNewLimit - 1);
            }
        };

        const selectedInterday: Card[] = [];
        for (const card of interday) {
            if (rootLimitReached("review")) {
                break;
            }
            if (deckLimitReached(card.did, "review")) {
                continue;
            }
            if (this.shouldBuryCard(card, "interday-learning", config, scopeContext, seenNoteModes)) {
                continue;
            }

            selectedInterday.push(card);
            consumeLimit(card.did, "review");
        }

        const selectedReview: Card[] = [];
        for (const card of review) {
            if (rootLimitReached("review")) {
                break;
            }
            if (deckLimitReached(card.did, "review")) {
                continue;
            }
            if (this.shouldBuryCard(card, "review", config, scopeContext, seenNoteModes)) {
                continue;
            }

            selectedReview.push(card);
            consumeLimit(card.did, "review");
        }

        const selectedNew: Card[] = [];
        for (const card of fresh) {
            if (rootLimitReached("new")) {
                break;
            }
            if (deckLimitReached(card.did, "new")) {
                continue;
            }
            if (this.shouldBuryCard(card, "new", config, scopeContext, seenNoteModes)) {
                continue;
            }

            selectedNew.push(card);
            consumeLimit(card.did, "new");
        }

        const mainDue = mergeByReviewMix(selectedReview, selectedInterday, config.interdayLearningMix);
        const main = mergeByReviewMix(mainDue, selectedNew, config.newReviewMix);
        const postNowQueue = config.newReviewMix === "mix-with-reviews"
            ? intersperse(main, intradayAhead)
            : [...main, ...intradayAhead];

        const cards = maybeDeferCollapsedLearningRepeat([...intradayNow, ...postNowQueue], {
            cardId: request.avoidImmediateLearningRepeatCardId,
            learnAheadCutoffMs,
            mainQueueCollapsed: main.length === 0,
        });

        const counts = summarizeCounts(cards);

        return {
            now,
            cards,
            counts,
        };
    }

    private async resolveDeckScopeContext(
        deckId: number | undefined,
        baseConfig: SchedulerConfig,
    ): Promise<DeckScopeContext | undefined> {
        if (deckId === undefined) {
            return undefined;
        }

        const decks = new DecksRepository(this.connection);
        const config = new ConfigRepository(this.connection);
        const [allDecks, deckConfigs] = await Promise.all([
            decks.list(),
            config.getDeckConfigs(),
        ]);

        const rootDeck = allDecks.find((deck) => deck.id === deckId);
        if (!rootDeck) {
            return undefined;
        }

        const deckByName = new Map(allDecks.map((deck) => [deck.name, deck]));

        const activeDecks = allDecks.filter(
            (deck) => deck.id === rootDeck.id || deck.name.startsWith(`${rootDeck.name}::`),
        );

        const limitDecks = new Map<number, DeckRecord>(activeDecks.map((deck) => [deck.id, deck]));
        if (baseConfig.applyAllParentLimits) {
            const parts = rootDeck.name.split("::").filter((part) => part.length > 0);
            for (let index = 1; index < parts.length; index += 1) {
                const parentName = parts.slice(0, index).join("::");
                const parent = deckByName.get(parentName);
                if (parent) {
                    limitDecks.set(parent.id, parent);
                }
            }
        }

        const limitsByDeckId = new Map<number, DeckLimitState>();
        const buryModeByDeckId = new Map<number, SiblingBuryMode>();

        for (const deck of limitDecks.values()) {
            const rawDeckConfig =
                deck.conf !== undefined && deckConfigs && typeof deckConfigs === "object" && !Array.isArray(deckConfigs)
                    ? (deckConfigs as Record<string, unknown>)[String(deck.conf)]
                    : undefined;

            const overrides = schedulerOverridesFromUnknown(rawDeckConfig);
            const deckConfig = resolveSchedulerConfig({
                ...baseConfig,
                ...overrides,
                limits: {
                    ...baseConfig.limits,
                    ...(overrides.limits ?? {}),
                },
            });

            const reviewLimit = Math.max(0, Math.trunc(deckConfig.limits.reviewsPerDay));
            const newLimitBase = Math.max(0, Math.trunc(deckConfig.limits.newPerDay));
            const capNewToReview = !deckConfig.newCardsIgnoreReviewLimit;

            limitsByDeckId.set(deck.id, {
                reviewLimit,
                newLimit: capNewToReview ? Math.min(newLimitBase, reviewLimit) : newLimitBase,
                capNewToReview,
            });
            buryModeByDeckId.set(deck.id, schedulerConfigToBuryMode(deckConfig));
        }

        const sortedLimitDecks = [...limitDecks.values()].sort(
            (left, right) => deckDepth(left.name) - deckDepth(right.name),
        );
        const limitDeckNameToId = new Map(sortedLimitDecks.map((deck) => [deck.name, deck.id]));

        const parentDeckIdByDeckId = new Map<number, number | null>();
        const childDeckIdsByDeckId = new Map<number, number[]>();
        for (const deck of sortedLimitDecks) {
            childDeckIdsByDeckId.set(deck.id, []);
        }

        for (const deck of sortedLimitDecks) {
            const parentId = findNearestParentDeckId(deck.name, limitDeckNameToId);
            parentDeckIdByDeckId.set(deck.id, parentId);
            if (parentId !== null) {
                childDeckIdsByDeckId.get(parentId)?.push(deck.id);
            }
        }

        for (const deck of sortedLimitDecks) {
            const parentId = parentDeckIdByDeckId.get(deck.id) ?? null;
            if (parentId === null) {
                continue;
            }

            const parentLimits = limitsByDeckId.get(parentId);
            const childLimits = limitsByDeckId.get(deck.id);
            if (!parentLimits || !childLimits) {
                continue;
            }

            this.capLimitStateToParent(childLimits, parentLimits);
        }

        const rootDeckIds = sortedLimitDecks
            .filter((deck) => (parentDeckIdByDeckId.get(deck.id) ?? null) === null)
            .map((deck) => deck.id);

        // Ensure we have mode entries for active decks that may not carry their own limits.
        const fallbackMode = schedulerConfigToBuryMode(baseConfig);
        for (const deck of activeDecks) {
            if (!buryModeByDeckId.has(deck.id)) {
                buryModeByDeckId.set(deck.id, fallbackMode);
            }
        }

        return {
            activeDeckIds: activeDecks.map((deck) => deck.id),
            rootDeckIds,
            limitsByDeckId,
            parentDeckIdByDeckId,
            childDeckIdsByDeckId,
            buryModeByDeckId,
        };
    }

    private rootLimitReached(scope: DeckScopeContext, kind: LimitKind): boolean {
        if (scope.rootDeckIds.length === 0) {
            return false;
        }

        return scope.rootDeckIds.every((deckId) => this.deckLimitReached(scope, deckId, kind));
    }

    private deckLimitReached(scope: DeckScopeContext, deckId: number, kind: LimitKind): boolean {
        const limits = scope.limitsByDeckId.get(deckId);
        if (!limits) {
            return false;
        }

        return kind === "review" ? limits.reviewLimit <= 0 : limits.newLimit <= 0;
    }

    private decrementDeckAndParentLimits(scope: DeckScopeContext, deckId: number, kind: LimitKind): void {
        let currentDeckId: number | null = deckId;
        const decremented = new Set<number>();

        while (currentDeckId !== null) {
            this.decrementDeckLimit(scope, currentDeckId, kind);
            decremented.add(currentDeckId);

            currentDeckId = scope.parentDeckIdByDeckId.get(currentDeckId) ?? null;
        }

        for (const rootDeckId of scope.rootDeckIds) {
            if (decremented.has(rootDeckId)) {
                continue;
            }
            this.decrementDeckLimit(scope, rootDeckId, kind);
        }
    }

    private decrementDeckLimit(scope: DeckScopeContext, deckId: number, kind: LimitKind): void {
        const limits = scope.limitsByDeckId.get(deckId);
        if (!limits) {
            return;
        }

        if (kind === "review") {
            limits.reviewLimit = Math.max(0, limits.reviewLimit - 1);
            if (limits.capNewToReview) {
                limits.newLimit = Math.min(limits.newLimit, limits.reviewLimit);
            }
        } else {
            limits.newLimit = Math.max(0, limits.newLimit - 1);
        }

        this.capDescendantLimits(scope, deckId, limits);
    }

    private capDescendantLimits(
        scope: DeckScopeContext,
        parentDeckId: number,
        parentLimits: DeckLimitState,
    ): void {
        const childDeckIds = scope.childDeckIdsByDeckId.get(parentDeckId) ?? [];
        for (const childDeckId of childDeckIds) {
            const childLimits = scope.limitsByDeckId.get(childDeckId);
            if (!childLimits) {
                continue;
            }

            this.capLimitStateToParent(childLimits, parentLimits);
            this.capDescendantLimits(scope, childDeckId, childLimits);
        }
    }

    private capLimitStateToParent(child: DeckLimitState, parent: DeckLimitState): void {
        child.reviewLimit = Math.min(child.reviewLimit, parent.reviewLimit);
        child.newLimit = Math.min(child.newLimit, parent.newLimit);
        if (child.capNewToReview) {
            child.newLimit = Math.min(child.newLimit, child.reviewLimit);
        }
    }

    private resolveCardBuryMode(
        card: Card,
        fallbackConfig: SchedulerConfig,
        scope?: DeckScopeContext,
    ): SiblingBuryMode {
        return scope?.buryModeByDeckId.get(card.did) ?? schedulerConfigToBuryMode(fallbackConfig);
    }

    private shouldBuryCard(
        card: Card,
        kind: BuryKind,
        fallbackConfig: SchedulerConfig,
        scope: DeckScopeContext | undefined,
        seenModes: Map<number, SiblingBuryMode>,
    ): boolean {
        const mode = this.resolveCardBuryMode(card, fallbackConfig, scope);
        const previous = this.getAndUpdateSeenBuryMode(seenModes, card.nid, mode);
        if (!previous) {
            return false;
        }

        if (kind === "new") {
            return previous.buryNew;
        }
        if (kind === "review") {
            return previous.buryReviews;
        }
        return previous.buryInterdayLearning;
    }

    private getAndUpdateSeenBuryMode(
        seenModes: Map<number, SiblingBuryMode>,
        noteId: number,
        mode: SiblingBuryMode,
    ): SiblingBuryMode | undefined {
        const previous = seenModes.get(noteId);

        if (!previous) {
            seenModes.set(noteId, mode);
            return undefined;
        }

        seenModes.set(noteId, {
            buryNew: previous.buryNew || mode.buryNew,
            buryReviews: previous.buryReviews || mode.buryReviews,
            buryInterdayLearning: previous.buryInterdayLearning || mode.buryInterdayLearning,
        });

        return previous;
    }

    private async selectCardsByDueRange(
        queue: CardQueue,
        minDue: number | undefined,
        maxDue: number,
        deckIds?: readonly number[],
    ): Promise<Card[]> {
        if (minDue !== undefined && minDue > maxDue) {
            return [];
        }

        const minDueSql = minDue === undefined ? "" : "AND due >= ?";
        const minDueParams = minDue === undefined ? [] : [minDue];
        const deckFilter = buildDeckFilter(deckIds);

        return this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              ${deckFilter.sql}
              ${minDueSql}
              AND due <= ?
            ORDER BY due ASC, id ASC
            `,
            [queue, ...deckFilter.params, ...minDueParams, maxDue],
        );
    }

    private async selectDueCards(queue: CardQueue, maxDue: number, deckIds?: readonly number[]): Promise<Card[]> {
        const deckFilter = buildDeckFilter(deckIds);

        return this.connection.select<Card>(
            `
			SELECT *
			FROM cards
			WHERE queue = ?
			  ${deckFilter.sql}
			  AND due <= ?
			ORDER BY due ASC, id ASC
			`,
            [queue, ...deckFilter.params, maxDue],
        );
    }

    private filterVisibleCards(cards: Card[], buriedIds: ReadonlySet<number>): Card[] {
        return cards.filter((card) => {
            if (buriedIds.has(card.id)) {
                return false;
            }
            if (card.queue === CardQueue.Suspended || card.queue === CardQueue.SchedBuried || card.queue === CardQueue.UserBuried) {
                return false;
            }
            return true;
        });
    }
}

function schedulerConfigToBuryMode(config: SchedulerConfig): SiblingBuryMode {
    return {
        buryNew: config.buryNew,
        buryReviews: config.buryReviews,
        buryInterdayLearning: config.buryInterdayLearning,
    };
}

function buildDeckFilter(deckIds?: readonly number[]): { sql: string; params: readonly number[] } {
    if (!deckIds || deckIds.length === 0) {
        return {
            sql: "",
            params: [],
        };
    }

    const placeholders = deckIds.map(() => "?").join(", ");

    return {
        sql: `AND did IN (${placeholders})`,
        params: deckIds,
    };
}

function findNearestParentDeckId(
    name: string,
    deckNameToId: ReadonlyMap<string, number>,
): number | null {
    const parts = name.split("::").filter((part) => part.length > 0);
    for (let index = parts.length - 1; index >= 1; index -= 1) {
        const candidateName = parts.slice(0, index).join("::");
        const candidate = deckNameToId.get(candidateName);
        if (candidate !== undefined) {
            return candidate;
        }
    }

    return null;
}

function deckDepth(name: string): number {
    return name.split("::").filter((part) => part.length > 0).length;
}

function summarizeCounts(cards: readonly Card[]): QueueBuildResult["counts"] {
    return {
        learning: cards
            .filter((card) => card.queue === CardQueue.Learning || card.queue === CardQueue.DayLearning)
            .length,
        review: cards.filter((card) => card.queue === CardQueue.Review).length,
        new: cards.filter((card) => card.queue === CardQueue.New).length,
    };
}

function mergeByReviewMix<T>(
    reviews: readonly T[],
    alternate: readonly T[],
    mode: SchedulerReviewMix,
): T[] {
    if (mode === "before-reviews") {
        return [...alternate, ...reviews];
    }
    if (mode === "after-reviews") {
        return [...reviews, ...alternate];
    }
    return intersperse(reviews, alternate);
}

function intersperse<T>(one: readonly T[], two: readonly T[]): T[] {
    const merged: T[] = [];
    let oneIndex = 0;
    let twoIndex = 0;

    const ratio = (one.length + 1) / (two.length + 1);

    while (oneIndex < one.length || twoIndex < two.length) {
        if (oneIndex < one.length && twoIndex < two.length) {
            const relativeTwoIndex = (twoIndex + 1) * ratio;
            if (relativeTwoIndex < oneIndex + 1) {
                merged.push(two[twoIndex]);
                twoIndex += 1;
            } else {
                merged.push(one[oneIndex]);
                oneIndex += 1;
            }
            continue;
        }

        if (oneIndex < one.length) {
            merged.push(one[oneIndex]);
            oneIndex += 1;
            continue;
        }

        merged.push(two[twoIndex]);
        twoIndex += 1;
    }

    return merged;
}

interface LearningRepeatDeferralOptions {
    readonly cardId?: number;
    readonly learnAheadCutoffMs: number;
    readonly mainQueueCollapsed: boolean;
}

function maybeDeferCollapsedLearningRepeat(
    cards: readonly Card[],
    options: LearningRepeatDeferralOptions,
): Card[] {
    if (options.cardId === undefined || !options.mainQueueCollapsed) {
        return [...cards];
    }

    const targetIndex = cards.findIndex((card) => card.id === options.cardId);
    if (targetIndex < 0) {
        return [...cards];
    }

    const target = cards[targetIndex];
    if (!target || target.queue !== CardQueue.Learning || target.due > options.learnAheadCutoffMs) {
        return [...cards];
    }

    const nextLearning = cards.find(
        (card, index) => index !== targetIndex && card.queue === CardQueue.Learning,
    );
    if (!nextLearning) {
        return [...cards];
    }

    // Mirror Anki's queue::learning::requeue_learning_entry() behavior:
    // when the main queue is collapsed, avoid immediate repeats by placing the
    // just-answered learning card after the next queued learning card.
    if (nextLearning.due < target.due || nextLearning.due + 1_000 >= options.learnAheadCutoffMs) {
        return [...cards];
    }

    const reordered = [...cards];
    reordered.splice(targetIndex, 1);

    let insertIndex = reordered.findIndex((card) => card.queue !== CardQueue.Learning || card.due > nextLearning.due);
    if (insertIndex < 0) {
        insertIndex = reordered.length;
    }

    reordered.splice(insertIndex, 0, target);
    return reordered;
}
