import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { resolveSchedulerConfig, schedulerOverridesFromUnknown } from "@/lib/scheduler/params";
import { CardQueue, type Card } from "@/lib/types/card";
import type {
    QueueBuildRequest,
    QueueBuildResult,
    SchedulerConfig,
    SchedulerNewCardGatherPriority,
    SchedulerNewCardSortOrder,
    SchedulerReviewMix,
    SchedulerReviewSortOrder,
} from "@/lib/types/scheduler";
import { fromDayNumber, toDayNumber } from "@/lib/scheduler/states";

type LimitKind = "new" | "review";
type BuryKind = "new" | "review" | "interday-learning";

interface SiblingBuryMode {
    readonly buryNew: boolean;
    readonly buryReviews: boolean;
    readonly buryInterdayLearning: boolean;
}

const UNIX_EPOCH_TIMESTAMP_THRESHOLD = 1_000_000_000;
const UNIX_EPOCH_MILLISECONDS_THRESHOLD = 1_000_000_000_000;

interface DeckLimitState {
    reviewLimit: number;
    newLimit: number;
    capNewToReview: boolean;
}

interface StudiedCountsToday {
    readonly newStudied: number;
    readonly reviewStudied: number;
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
        const today = toDayNumber(now, undefined, config.collectionDayOffset);
        const buriedIds = request.buriedCardIds ?? new Set<number>();
        const scopeContext = await this.resolveDeckScopeContext(request.deckId, config, today);
        const activeDeckIds = scopeContext?.activeDeckIds;

        const [
            learningIntradayDueNowRaw,
            previewIntradayDueNow,
            learningIntradayDueAheadRaw,
            previewIntradayDueAhead,
            learningInterdayDue,
            reviewCards,
            allNewCards,
        ] = await Promise.all([
            this.selectCardsByDueRange(CardQueue.Learning, undefined, nowMs, activeDeckIds),
            this.selectCardsByDueRange(CardQueue.Preview, undefined, nowMs, activeDeckIds),
            this.selectCardsByDueRange(CardQueue.Learning, nowMs + 1, learnAheadCutoffMs, activeDeckIds),
            this.selectCardsByDueRange(CardQueue.Preview, nowMs + 1, learnAheadCutoffMs, activeDeckIds),
            this.selectDueCards(CardQueue.DayLearning, today, activeDeckIds),
            this.selectReviewDueCards(
                today,
                activeDeckIds,
                config.reviewSortOrder,
                now,
                config.useFsrs,
                config.collectionDayOffset,
            ),
            this.selectNewCardsForGather(now, activeDeckIds, config.newCardGatherPriority, config.collectionDayOffset),
        ]);

        const learningIntradayDueNow = sortIntradayByDue([...learningIntradayDueNowRaw, ...previewIntradayDueNow]);
        const learningIntradayDueAhead = sortIntradayByDue([
            ...learningIntradayDueAheadRaw,
            ...previewIntradayDueAhead,
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

        if (!scopeContext) {
            const studiedCounts = await this.loadStudiedCountsForToday(activeDeckIds, today);
            flatReviewLimit = Math.max(0, flatReviewLimit - studiedCounts.reviewStudied);
            flatNewLimit = Math.max(0, flatNewLimit - studiedCounts.newStudied);

            if (!config.newCardsIgnoreReviewLimit) {
                flatReviewLimit = Math.max(0, flatReviewLimit - studiedCounts.newStudied);
                flatNewLimit = Math.min(flatNewLimit, flatReviewLimit);
            }
        } else if (!config.newCardsIgnoreReviewLimit) {
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

        const sortedNew = sortNewCards(selectedNew, config.newCardSortOrder, today);

        const mainDue = mergeByReviewMix(selectedReview, selectedInterday, config.interdayLearningMix);
        const main = mergeByReviewMix(mainDue, sortedNew, config.newReviewMix);
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
        today: number,
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

            const studiedCounts = getDeckStudiedCountsForToday(deck, today);
            const capNewToReview = !deckConfig.newCardsIgnoreReviewLimit;

            let reviewLimit = Math.max(0, Math.trunc(deckConfig.limits.reviewsPerDay));
            let newLimitBase = Math.max(0, Math.trunc(deckConfig.limits.newPerDay));

            reviewLimit = Math.max(0, reviewLimit - studiedCounts.reviewStudied);
            newLimitBase = Math.max(0, newLimitBase - studiedCounts.newStudied);

            if (capNewToReview) {
                reviewLimit = Math.max(0, reviewLimit - studiedCounts.newStudied);
            }

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

        const normalizedDueSql =
            `CASE WHEN due > 0 AND due < ${UNIX_EPOCH_MILLISECONDS_THRESHOLD} THEN due * 1000 ELSE due END`;
        const minDueSql = minDue === undefined ? "" : `AND ${normalizedDueSql} >= ?`;
        const minDueParams = minDue === undefined ? [] : [minDue];
        const deckFilter = buildDeckFilter(deckIds);

        const cards = await this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              ${deckFilter.sql}
              ${minDueSql}
              AND ${normalizedDueSql} <= ?
            ORDER BY ${normalizedDueSql} ASC, id ASC
            `,
            [queue, ...deckFilter.params, ...minDueParams, maxDue],
        );

        if (queue !== CardQueue.Learning && queue !== CardQueue.Preview) {
            return cards;
        }

        return cards.map((card) => ({
            ...card,
            due: normalizeIntradayDueToMilliseconds(card.due),
        }));
    }

    private async selectNewCardsForGather(
        now: Date,
        deckIds: readonly number[] | undefined,
        gatherPriority: SchedulerNewCardGatherPriority,
        collectionDayOffset: number,
    ): Promise<Card[]> {
        const day = toDayNumber(now, undefined, collectionDayOffset);
        const gatherSalt = knuthSalt(day);

        if (gatherPriority === "deck" || gatherPriority === "deck-then-random-notes") {
            const orderedDeckIds = deckIds
                ? [...deckIds]
                : (await new DecksRepository(this.connection).list()).map((deck) => deck.id);

            const perDeckPriority: "lowest-position" | "random-notes" =
                gatherPriority === "deck" ? "lowest-position" : "random-notes";

            return this.selectNewCardsByDeck(orderedDeckIds, perDeckPriority, gatherSalt);
        }

        return this.selectNewCardsAcrossActiveDecks(deckIds, gatherPriority, gatherSalt);
    }

    private async selectNewCardsByDeck(
        deckIds: readonly number[],
        gatherPriority: "lowest-position" | "random-notes",
        gatherSalt: number,
    ): Promise<Card[]> {
        const gathered: Card[] = [];

        for (const deckId of deckIds) {
            const cards = await this.selectDeckNewCards(deckId, gatherPriority, gatherSalt);
            if (cards.length > 0) {
                gathered.push(...cards);
            }
        }

        return gathered;
    }

    private async selectDeckNewCards(
        deckId: number,
        gatherPriority: "lowest-position" | "random-notes",
        gatherSalt: number,
    ): Promise<Card[]> {
        const { sql, params } = newCardGatherOrderSql(gatherPriority, gatherSalt);

        return this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              AND did = ?
            ORDER BY ${sql}
            `,
            [CardQueue.New, deckId, ...params],
        );
    }

    private async selectNewCardsAcrossActiveDecks(
        deckIds: readonly number[] | undefined,
        gatherPriority: Exclude<SchedulerNewCardGatherPriority, "deck" | "deck-then-random-notes">,
        gatherSalt: number,
    ): Promise<Card[]> {
        const deckFilter = buildDeckFilter(deckIds);
        const { sql, params } = newCardGatherOrderSql(gatherPriority, gatherSalt);

        return this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              ${deckFilter.sql}
            ORDER BY ${sql}
            `,
            [CardQueue.New, ...deckFilter.params, ...params],
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

    private async selectReviewDueCards(
        maxDue: number,
        deckIds: readonly number[] | undefined,
        sortOrder: SchedulerReviewSortOrder,
        now: Date,
        useFsrs: boolean,
        collectionDayOffset: number,
    ): Promise<Card[]> {
        const deckFilter = buildDeckFilter(deckIds);
        const nowDay = toDayNumber(now, undefined, collectionDayOffset);
        const nextDayAtMs = fromDayNumber(nowDay + 1, undefined, collectionDayOffset).getTime();

        const { sql, params } = reviewSortOrderSql(sortOrder, {
            nowMs: now.getTime(),
            nowDay,
            nextDayAtMs,
        }, useFsrs, deckIds);

        return this.connection.select<Card>(
            `
            SELECT *
            FROM cards
            WHERE queue = ?
              ${deckFilter.sql}
              AND due <= ?
            ORDER BY ${sql}
            `,
            [CardQueue.Review, ...deckFilter.params, maxDue, ...params],
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

    private async loadStudiedCountsForToday(
        deckIds: readonly number[] | undefined,
        today: number,
    ): Promise<StudiedCountsToday> {
        const decks = new DecksRepository(this.connection);
        const allDecks = await decks.list();
        const includedDeckIds = deckIds ? new Set(deckIds) : null;

        let newStudied = 0;
        let reviewStudied = 0;

        for (const deck of allDecks) {
            if (includedDeckIds && !includedDeckIds.has(deck.id)) {
                continue;
            }

            const counts = getDeckStudiedCountsForToday(deck, today);
            newStudied += counts.newStudied;
            reviewStudied += counts.reviewStudied;
        }

        return {
            newStudied,
            reviewStudied,
        };
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

function getDeckStudiedCountsForToday(deck: DeckRecord, today: number): StudiedCountsToday {
    const lastDayStudied = toTruncNumber(deck.lastDayStudied);
    if (lastDayStudied !== today) {
        return {
            newStudied: 0,
            reviewStudied: 0,
        };
    }

    return {
        newStudied: toTruncNumber(deck.newStudied),
        reviewStudied: toTruncNumber(deck.reviewStudied),
    };
}

function toTruncNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }

    return Math.trunc(value);
}

function summarizeCounts(cards: readonly Card[]): QueueBuildResult["counts"] {
    return {
        learning: cards
            .filter(
                (card) =>
                    card.queue === CardQueue.Learning ||
                    card.queue === CardQueue.DayLearning ||
                    card.queue === CardQueue.Preview,
            )
            .length,
        review: cards.filter((card) => card.queue === CardQueue.Review).length,
        new: cards.filter((card) => card.queue === CardQueue.New).length,
    };
}

function sortIntradayByDue(cards: readonly Card[]): Card[] {
    return [...cards].sort((left, right) => {
        if (left.due !== right.due) {
            return left.due - right.due;
        }

        return left.id - right.id;
    });
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

function sortNewCards(
    cards: readonly Card[],
    sortOrder: SchedulerNewCardSortOrder,
    day: number,
): Card[] {
    if (sortOrder === "no-sort") {
        return [...cards];
    }

    const decorated = cards.map((card, index) => ({
        card,
        index,
        cardHash: fnv1a32(`${card.id}|${day}`),
        noteHash: fnv1a32(`${card.nid}|${day}`),
    }));

    if (sortOrder === "template") {
        decorated.sort((left, right) => {
            if (left.card.ord !== right.card.ord) {
                return left.card.ord - right.card.ord;
            }
            return left.index - right.index;
        });
        return decorated.map((entry) => entry.card);
    }

    if (sortOrder === "template-then-random") {
        decorated.sort((left, right) => {
            if (left.card.ord !== right.card.ord) {
                return left.card.ord - right.card.ord;
            }
            if (left.cardHash !== right.cardHash) {
                return left.cardHash - right.cardHash;
            }
            return left.index - right.index;
        });
        return decorated.map((entry) => entry.card);
    }

    if (sortOrder === "random-note-then-template") {
        decorated.sort((left, right) => {
            if (left.noteHash !== right.noteHash) {
                return left.noteHash - right.noteHash;
            }
            if (left.card.ord !== right.card.ord) {
                return left.card.ord - right.card.ord;
            }
            return left.index - right.index;
        });
        return decorated.map((entry) => entry.card);
    }

    decorated.sort((left, right) => {
        if (left.cardHash !== right.cardHash) {
            return left.cardHash - right.cardHash;
        }
        return left.index - right.index;
    });
    return decorated.map((entry) => entry.card);
}

function knuthSalt(baseSalt: number): number {
    return Math.imul(baseSalt, 2_654_435_761) >>> 0;
}

function newCardGatherOrderSql(
    gatherPriority: Exclude<SchedulerNewCardGatherPriority, "deck" | "deck-then-random-notes">,
    gatherSalt: number,
): {
    readonly sql: string;
    readonly params: readonly number[];
} {
    if (gatherPriority === "lowest-position") {
        return { sql: "due ASC, ord ASC, id ASC", params: [] };
    }

    if (gatherPriority === "highest-position") {
        return { sql: "due DESC, ord ASC, id ASC", params: [] };
    }

    if (gatherPriority === "random-notes") {
        return {
            sql: "fnvhash(CAST(nid AS TEXT) || '|' || ?) ASC, ord ASC, id ASC",
            params: [gatherSalt],
        };
    }

    return {
        sql: "fnvhash(CAST(id AS TEXT) || '|' || ?) ASC, id ASC",
        params: [gatherSalt],
    };
}

function fnv1a32(input: string): number {
    const bytes = new TextEncoder().encode(input);
    let hash = 0x811c9dc5;

    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
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

function normalizeIntradayDueToMilliseconds(due: number): number {
    const normalized = Math.trunc(due);
    if (normalized <= UNIX_EPOCH_TIMESTAMP_THRESHOLD) {
        return normalized;
    }

    if (normalized < UNIX_EPOCH_MILLISECONDS_THRESHOLD) {
        return normalized * 1000;
    }

    return normalized;
}

function reviewSortOrderSql(
    sortOrder: SchedulerReviewSortOrder,
    timing: {
        readonly nowMs: number;
        readonly nowDay: number;
        readonly nextDayAtMs: number;
    },
    useFsrs: boolean,
    activeDeckIds?: readonly number[],
): {
    readonly sql: string;
    readonly params: readonly number[];
} {
    const randomTieBreaker = "fnvhash(CAST(id AS TEXT) || '|' || CAST(mod AS TEXT)) ASC";
    const deckOrder = deckOrderSql(activeDeckIds);
    const dueForSort = "CASE WHEN odue != 0 THEN odue ELSE due END";

    if (sortOrder === "due-then-deck") {
        return { sql: `due ASC, ${deckOrder} ASC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "deck-then-due") {
        return { sql: `${deckOrder} ASC, due ASC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "interval-ascending") {
        return { sql: `ivl ASC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "interval-descending") {
        return { sql: `ivl DESC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "ease-ascending") {
        return useFsrs
            ? { sql: `extract_fsrs_variable(data, 'd') DESC, ${randomTieBreaker}`, params: [] }
            : { sql: `factor ASC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "ease-descending") {
        return useFsrs
            ? { sql: `extract_fsrs_variable(data, 'd') ASC, ${randomTieBreaker}`, params: [] }
            : { sql: `factor DESC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "retrievability-ascending") {
        return {
            sql: `extract_fsrs_retrievability(data, ${dueForSort}, ivl, ?, ?, ?) ASC, ${randomTieBreaker}`,
            params: [timing.nowDay, timing.nextDayAtMs, timing.nowMs],
        };
    }

    if (sortOrder === "retrievability-descending") {
        return {
            sql: `extract_fsrs_retrievability(data, ${dueForSort}, ivl, ?, ?, ?) DESC, ${randomTieBreaker}`,
            params: [timing.nowDay, timing.nextDayAtMs, timing.nowMs],
        };
    }

    if (sortOrder === "relative-overdueness") {
        if (useFsrs) {
            return {
                sql: `extract_fsrs_relative_retrievability(data, ${dueForSort}, ivl, ?, ?, ?) ASC, ${randomTieBreaker}`,
                params: [timing.nowDay, timing.nextDayAtMs, timing.nowMs],
            };
        }

        return {
            sql: `-(1 + CAST(? - ${dueForSort} + 0.001 AS REAL) / CASE WHEN ivl <= 0 THEN 1 ELSE ivl END) ASC, ${randomTieBreaker}`,
            params: [timing.nowDay],
        };
    }

    if (sortOrder === "random") {
        return { sql: randomTieBreaker, params: [] };
    }

    if (sortOrder === "added") {
        return { sql: `nid ASC, ord ASC, ${randomTieBreaker}`, params: [] };
    }

    if (sortOrder === "reverse-added") {
        return { sql: `nid DESC, ord ASC, ${randomTieBreaker}`, params: [] };
    }

    return { sql: `due ASC, ${randomTieBreaker}`, params: [] };
}

function deckOrderSql(activeDeckIds: readonly number[] | undefined): string {
    if (!activeDeckIds || activeDeckIds.length === 0) {
        return "did";
    }

    const whenClauses = activeDeckIds
        .map((deckId, index) => `WHEN ${Math.trunc(deckId)} THEN ${index}`)
        .join(" ");

    return `CASE did ${whenClauses} ELSE 2147483647 END`;
}
