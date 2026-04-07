import { toDayNumber } from "@/lib/scheduler/states";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { CardQueue, CardType } from "@/lib/types/card";

export const CUSTOM_STUDY_SESSION_DECK_NAME = "Custom Study Session";

const CUSTOM_STUDY_INCLUDE_TAGS_KEY_PREFIX = "customStudyIncludeTags:";
const CUSTOM_STUDY_EXCLUDE_TAGS_KEY_PREFIX = "customStudyExcludeTags:";
const FILTERED_START_POSITION = -100_000;
const ENCODED_REVLOG_ID_THRESHOLD = 10_000_000_000_000;

export type CustomStudyCramKind = "new" | "due" | "review" | "all";

type CustomStudyOrder = "random" | "due" | "added";

interface CustomStudyFilterMode {
    readonly reschedule: boolean;
    readonly order: CustomStudyOrder;
    readonly limit: number;
    readonly whereSql: string;
    readonly whereParams: readonly (number | string)[];
    readonly orderParams: readonly (number | string)[];
}

interface CandidateCardRow {
    readonly id: number;
    readonly did: number;
    readonly due: number;
    readonly queue: number;
    readonly type: number;
}

export interface CustomStudyTagDefault {
    readonly name: string;
    readonly include: boolean;
    readonly exclude: boolean;
}

export interface CustomStudyDefaults {
    readonly tags: readonly CustomStudyTagDefault[];
    readonly extendNew: number;
    readonly extendReview: number;
    readonly availableNew: number;
    readonly availableReview: number;
    readonly availableNewInChildren: number;
    readonly availableReviewInChildren: number;
}

export interface CustomStudyResult {
    readonly filteredDeckId?: number;
    readonly movedCardCount?: number;
}

export type CustomStudyRequest =
    | {
        readonly deckId: number;
        readonly mode: "new-limit-delta";
        readonly delta: number;
    }
    | {
        readonly deckId: number;
        readonly mode: "review-limit-delta";
        readonly delta: number;
    }
    | {
        readonly deckId: number;
        readonly mode: "forgot-days";
        readonly days: number;
    }
    | {
        readonly deckId: number;
        readonly mode: "review-ahead-days";
        readonly days: number;
    }
    | {
        readonly deckId: number;
        readonly mode: "preview-days";
        readonly days: number;
    }
    | {
        readonly deckId: number;
        readonly mode: "cram";
        readonly cram: {
            readonly kind: CustomStudyCramKind;
            readonly cardLimit: number;
            readonly tagsToInclude: readonly string[];
            readonly tagsToExclude: readonly string[];
        };
    };

export class CustomStudyError extends Error {
    public constructor(
        public readonly code: "NO_MATCHING_CARDS" | "EXISTING_DECK" | "DECK_NOT_FOUND",
        message: string,
    ) {
        super(message);
        this.name = "CustomStudyError";
    }
}

export class CustomStudyService {
    private readonly decks: DecksRepository;
    private readonly cards: CardsRepository;
    private readonly config: ConfigRepository;

    public constructor(private readonly connection: CollectionDatabaseConnection) {
        this.decks = new DecksRepository(connection);
        this.cards = new CardsRepository(connection);
        this.config = new ConfigRepository(connection);
    }

    public async getDefaults(deckId: number): Promise<CustomStudyDefaults> {
        const [allDecks, globalConfig, collectionDayOffset] = await Promise.all([
            this.decks.list(),
            this.config.getGlobalConfig(),
            this.getCollectionDayOffset(),
        ]);

        const deck = allDecks.find((entry) => entry.id === deckId);
        if (!deck) {
            throw new CustomStudyError("DECK_NOT_FOUND", `Deck ${deckId} was not found.`);
        }

        const scopeDecks = scopeDecksForRoot(deck, allDecks);
        const childDeckIds = scopeDecks
            .filter((entry) => entry.id !== deck.id)
            .map((entry) => entry.id);
        const scopeDeckIds = scopeDecks.map((entry) => entry.id);

        const now = new Date();
        const today = toDayNumber(now, undefined, collectionDayOffset);

        const [
            availableNew,
            availableReview,
            availableNewIncludingChildren,
            availableReviewIncludingChildren,
            tagsInDeck,
        ] = await Promise.all([
            countCardsByQueue(this.connection, [deck.id], [CardQueue.New]),
            countReviewDueCards(this.connection, [deck.id], today),
            countCardsByQueue(this.connection, scopeDeckIds, [CardQueue.New]),
            countReviewDueCards(this.connection, scopeDeckIds, today),
            loadDeckTags(this.connection, scopeDeckIds),
        ]);

        const includeTagKey = customStudyIncludeTagKey(deck.id);
        const excludeTagKey = customStudyExcludeTagKey(deck.id);
        const includeTags = new Set(normalizeTagList(globalConfig[includeTagKey]));
        const excludeTags = new Set(normalizeTagList(globalConfig[excludeTagKey]));

        const tags = tagsInDeck.map((name) => ({
            name,
            include: includeTags.has(name),
            exclude: excludeTags.has(name),
        }));

        const availableNewInChildren = Math.max(0, availableNewIncludingChildren - availableNew);
        const availableReviewInChildren = Math.max(0, availableReviewIncludingChildren - availableReview);

        return {
            tags,
            extendNew: toInteger(deck.extendNew),
            extendReview: toInteger(deck.extendRev),
            availableNew,
            availableReview,
            availableNewInChildren,
            availableReviewInChildren,
        };
    }

    public async apply(request: CustomStudyRequest): Promise<CustomStudyResult> {
        if (request.mode === "new-limit-delta") {
            await this.extendLimits(request.deckId, request.delta, 0);
            if (request.delta > 0) {
                await this.decks.update(request.deckId, { extendNew: request.delta });
            }
            return {};
        }

        if (request.mode === "review-limit-delta") {
            await this.extendLimits(request.deckId, 0, request.delta);
            if (request.delta > 0) {
                await this.decks.update(request.deckId, { extendRev: request.delta });
            }
            return {};
        }

        const allDecks = await this.decks.list();
        const collectionDayOffset = await this.getCollectionDayOffset();
        const now = new Date();

        const deck = allDecks.find((entry) => entry.id === request.deckId);
        if (!deck) {
            throw new CustomStudyError("DECK_NOT_FOUND", `Deck ${request.deckId} was not found.`);
        }

        const scopeDeckIds = scopeDecksForRoot(deck, allDecks).map((entry) => entry.id);
        const today = toDayNumber(now, undefined, collectionDayOffset);
        const nowMs = now.getTime();
        const existingSessionDeck = allDecks.find(
            (entry) => entry.name === CUSTOM_STUDY_SESSION_DECK_NAME,
        );

        if (existingSessionDeck && toInteger(existingSessionDeck.dyn) === 0) {
            throw new CustomStudyError(
                "EXISTING_DECK",
                "A normal deck named \"Custom Study Session\" already exists. Rename it first.",
            );
        }

        if (existingSessionDeck) {
            await this.restoreCardsFromSessionDeck(existingSessionDeck.id, nowMs);
        }

        let mode: CustomStudyFilterMode | undefined;
        let cardRows: CandidateCardRow[];

        if (request.mode === "preview-days") {
            cardRows = await this.selectPreviewCandidateCards(scopeDeckIds, nowMs, request.days);
        } else {
            mode = this.buildMode(request, {
                nowMs,
                today,
                scopeDeckIds,
            });
            cardRows = await this.selectCandidateCards(mode);
        }

        if (cardRows.length === 0) {
            throw new CustomStudyError(
                "NO_MATCHING_CARDS",
                "No cards matched the selected Custom Study criteria.",
            );
        }

        const sessionDeck = await this.getOrCreateSessionDeck(deck);
        await this.restoreCardsFromSessionDeck(sessionDeck.id, nowMs);

        let position = FILTERED_START_POSITION;

        for (const card of cardRows) {
            const due = card.due > 0 ? position : card.due;
            const queue = mode?.reschedule ? card.queue : CardQueue.Preview;

            await this.cards.update(card.id, {
                did: sessionDeck.id,
                odid: card.did,
                odue: card.due,
                queue,
                due,
                mod: nowMs,
            });

            position += 1;
        }

        if (request.mode === "cram") {
            await this.config.updateGlobalConfig({
                [customStudyIncludeTagKey(request.deckId)]: normalizeTagList(request.cram.tagsToInclude),
                [customStudyExcludeTagKey(request.deckId)]: normalizeTagList(request.cram.tagsToExclude),
            });
        }

        return {
            filteredDeckId: sessionDeck.id,
            movedCardCount: cardRows.length,
        };
    }

    private buildMode(
        request: Exclude<CustomStudyRequest, { mode: "new-limit-delta" } | { mode: "review-limit-delta" }>,
        context: {
            readonly nowMs: number;
            readonly today: number;
            readonly scopeDeckIds: readonly number[];
        },
    ): CustomStudyFilterMode {
        const baseClauses: string[] = [];
        const baseParams: Array<number | string> = [];

        baseClauses.push(inSqlList("c.did", context.scopeDeckIds, baseParams));
        baseClauses.push("c.odid = 0");
        baseClauses.push("c.queue NOT IN (?, ?, ?)");
        baseParams.push(CardQueue.Suspended, CardQueue.SchedBuried, CardQueue.UserBuried);

        if (request.mode === "forgot-days") {
            const days = Math.max(1, Math.trunc(request.days));
            const cutoffMs = context.nowMs - days * 86_400_000;

            const whereClauses = [...baseClauses];
            const whereParams = [...baseParams];
            whereClauses.push(
                `EXISTS (
                    SELECT 1
                    FROM revlog r
                    WHERE r.cid = c.id
                      AND r.ease = 1
                      AND ${decodeRevlogIdMs("r.id")} >= ?
                )`,
            );
            whereParams.push(cutoffMs);

            return {
                reschedule: false,
                order: "random",
                limit: 99_999,
                whereSql: whereClauses.join(" AND "),
                whereParams,
                orderParams: [],
            };
        }

        if (request.mode === "review-ahead-days") {
            const days = Math.max(1, Math.trunc(request.days));

            const whereClauses = [...baseClauses];
            const whereParams = [...baseParams];
            whereClauses.push("c.queue IN (?, ?)");
            whereClauses.push("c.due <= ?");
            whereParams.push(CardQueue.Review, CardQueue.DayLearning, context.today + days);

            return {
                reschedule: true,
                order: "due",
                limit: 99_999,
                whereSql: whereClauses.join(" AND "),
                whereParams,
                orderParams: [context.nowMs, context.today],
            };
        }

        if (request.mode === "preview-days") {
            const days = Math.max(1, Math.trunc(request.days));
            const cutoffMs = context.nowMs - days * 86_400_000;

            const whereClauses = [...baseClauses];
            const whereParams = [...baseParams];
            whereClauses.push("c.type = ?");
            whereClauses.push("(n.id >= ? OR n.mod >= ?)");
            whereParams.push(CardType.New, cutoffMs, cutoffMs);

            return {
                reschedule: false,
                order: "added",
                limit: 99_999,
                whereSql: whereClauses.join(" AND "),
                whereParams,
                orderParams: [],
            };
        }

        const cramLimit = Math.max(0, Math.trunc(request.cram.cardLimit));
        const includeTags = normalizeTagList(request.cram.tagsToInclude);
        const excludeTags = normalizeTagList(request.cram.tagsToExclude);

        const whereClauses = [...baseClauses];
        const whereParams = [...baseParams];

        if (request.cram.kind === "new") {
            whereClauses.push("c.type = ?");
            whereParams.push(CardType.New);
        } else if (request.cram.kind === "due") {
            whereClauses.push(`(
                (c.queue = ? AND ${normalizeIntradayDueSql("c.due")} <= ?)
                OR (c.queue IN (?, ?) AND c.due <= ?)
            )`);
            whereParams.push(
                CardQueue.Learning,
                context.nowMs,
                CardQueue.Review,
                CardQueue.DayLearning,
                context.today,
            );
        } else if (request.cram.kind === "review") {
            whereClauses.push("c.type != ?");
            whereParams.push(CardType.New);
        }

        applyTagClauses(whereClauses, whereParams, includeTags, excludeTags);

        return {
            reschedule: request.cram.kind !== "all",
            order:
                request.cram.kind === "new"
                    ? "added"
                    : request.cram.kind === "due"
                        ? "due"
                        : "random",
            limit: cramLimit,
            whereSql: whereClauses.join(" AND "),
            whereParams,
            orderParams: request.cram.kind === "due" ? [context.nowMs, context.today] : [],
        };
    }

    private async selectCandidateCards(mode: CustomStudyFilterMode): Promise<CandidateCardRow[]> {
        if (mode.limit <= 0) {
            return [];
        }

        const orderSql =
            mode.order === "added"
                ? "n.id ASC, c.ord ASC, c.id ASC"
                : mode.order === "due"
                    ? `${normalizeDueForSortSql("c.due")} ASC, c.ord ASC, c.id ASC`
                    : "fnvhash(CAST(c.id AS TEXT) || '|' || CAST(c.mod AS TEXT)) ASC, c.id ASC";

        const rows = await this.connection.select<CandidateCardRow>(
            `
            SELECT c.id, c.did, c.due, c.queue, c.type
            FROM cards c
            INNER JOIN notes n ON n.id = c.nid
            WHERE ${mode.whereSql}
            ORDER BY ${orderSql}
            LIMIT ?
            `,
            [...mode.whereParams, ...mode.orderParams, mode.limit],
        );

        return rows;
    }

    private async selectPreviewCandidateCards(
        scopeDeckIds: readonly number[],
        nowMs: number,
        days: number,
    ): Promise<CandidateCardRow[]> {
        if (scopeDeckIds.length === 0) {
            return [];
        }

        const normalizedDays = Math.max(1, Math.trunc(days));
        const cutoffMs = nowMs - normalizedDays * 86_400_000;

        const params: Array<number | string> = [];
        const deckSql = inSqlList("c.did", scopeDeckIds, params);

        const rows = await this.connection.select<CandidateCardRow>(
            `
            SELECT c.id, c.did, c.due, c.queue, c.type
            FROM cards c
            INNER JOIN notes n ON n.id = c.nid
            WHERE ${deckSql}
              AND c.odid = 0
              AND c.queue NOT IN (?, ?, ?)
              AND c.type = ?
              AND (n.id >= ? OR n.mod >= ?)
            ORDER BY n.id ASC, c.ord ASC, c.id ASC
            LIMIT ?
            `,
            [
                ...params,
                CardQueue.Suspended,
                CardQueue.SchedBuried,
                CardQueue.UserBuried,
                CardType.New,
                cutoffMs,
                cutoffMs,
                99_999,
            ],
        );

        return rows;
    }

    private async extendLimits(deckId: number, newDelta: number, reviewDelta: number): Promise<void> {
        const [allDecks, globalConfig, collectionDayOffset] = await Promise.all([
            this.decks.list(),
            this.config.getGlobalConfig(),
            this.getCollectionDayOffset(),
        ]);

        const targetDeck = allDecks.find((deck) => deck.id === deckId);
        if (!targetDeck) {
            throw new CustomStudyError("DECK_NOT_FOUND", `Deck ${deckId} was not found.`);
        }

        const applyAllParentLimits = firstBoolean(
            globalConfig.applyAllParentLimits,
            globalConfig.apply_all_parent_limits,
            false,
        );

        const deckByName = new Map(allDecks.map((deck) => [deck.name, deck]));
        const lineage = [targetDeck];

        if (applyAllParentLimits) {
            const parts = targetDeck.name.split("::").filter((part) => part.length > 0);
            for (let index = parts.length - 1; index >= 1; index -= 1) {
                const parentName = parts.slice(0, index).join("::");
                const parentDeck = deckByName.get(parentName);
                if (parentDeck) {
                    lineage.push(parentDeck);
                }
            }
        }

        const today = toDayNumber(new Date(), undefined, collectionDayOffset);

        for (const deck of lineage) {
            const lastDayStudied = toInteger(deck.lastDayStudied);
            const resetForDay = lastDayStudied !== today;
            const currentNewStudied = resetForDay ? 0 : toInteger(deck.newStudied);
            const currentReviewStudied = resetForDay ? 0 : toInteger(deck.reviewStudied);

            await this.decks.update(deck.id, {
                lastDayStudied: today,
                newStudied: currentNewStudied - Math.trunc(newDelta),
                reviewStudied: currentReviewStudied - Math.trunc(reviewDelta),
            });
        }
    }

    private async getOrCreateSessionDeck(sourceDeck: DeckRecord): Promise<DeckRecord> {
        const allDecks = await this.decks.list();
        const existing = allDecks.find((deck) => deck.name === CUSTOM_STUDY_SESSION_DECK_NAME);

        if (existing && toInteger(existing.dyn) === 0) {
            throw new CustomStudyError(
                "EXISTING_DECK",
                "A normal deck named \"Custom Study Session\" already exists. Rename it first.",
            );
        }

        if (existing) {
            await this.decks.update(existing.id, {
                dyn: 1,
                conf: sourceDeck.conf,
            });

            const refreshed = await this.decks.getById(existing.id);
            if (refreshed) {
                return refreshed;
            }
        }

        return this.decks.create(CUSTOM_STUDY_SESSION_DECK_NAME, {
            conf: sourceDeck.conf,
            dyn: 1,
            desc: "Auto-generated by Custom Study",
        });
    }

    private async restoreCardsFromSessionDeck(sessionDeckId: number, nowMs: number): Promise<void> {
        const rows = await this.connection.select<{
            readonly id: number;
            readonly did: number;
            readonly due: number;
            readonly queue: number;
            readonly type: number;
            readonly odue: number;
            readonly odid: number;
        }>(
            "SELECT id, did, due, queue, type, odue, odid FROM cards WHERE did = ?",
            [sessionDeckId],
        );

        for (const row of rows) {
            if (row.odid === 0) {
                continue;
            }

            const restoredDue = row.odue !== 0 ? row.odue : row.due;
            const restoredQueue = row.queue >= 0 ? restoreQueueFromTypeAndDue(row.type, restoredDue) : row.queue;

            await this.cards.update(row.id, {
                did: row.odid,
                queue: restoredQueue,
                due: restoredDue,
                odid: 0,
                odue: 0,
                mod: nowMs,
            });
        }
    }

    private async getCollectionDayOffset(): Promise<number> {
        const meta = await this.connection.get<{ readonly crt: number }>(
            "SELECT crt FROM col WHERE id = 1 LIMIT 1",
        );

        const createdSeconds = toInteger(meta?.crt);
        if (createdSeconds <= 0) {
            return 0;
        }

        return toDayNumber(new Date(createdSeconds * 1000));
    }
}

function scopeDecksForRoot(rootDeck: DeckRecord, allDecks: readonly DeckRecord[]): DeckRecord[] {
    return allDecks.filter(
        (deck) => deck.id === rootDeck.id || deck.name.startsWith(`${rootDeck.name}::`),
    );
}

async function countCardsByQueue(
    connection: CollectionDatabaseConnection,
    deckIds: readonly number[],
    queues: readonly number[],
): Promise<number> {
    if (deckIds.length === 0 || queues.length === 0) {
        return 0;
    }

    const params: number[] = [];
    const deckSql = inSqlList("did", deckIds, params);
    const queueSql = inSqlList("queue", queues, params);

    const row = await connection.get<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM cards WHERE ${deckSql} AND ${queueSql}`,
        params,
    );

    return Math.max(0, toInteger(row?.count));
}

async function countReviewDueCards(
    connection: CollectionDatabaseConnection,
    deckIds: readonly number[],
    today: number,
): Promise<number> {
    if (deckIds.length === 0) {
        return 0;
    }

    const params: number[] = [];
    const deckSql = inSqlList("did", deckIds, params);

    const row = await connection.get<{ readonly count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM cards
        WHERE ${deckSql}
          AND queue IN (?, ?)
          AND due <= ?
        `,
        [...params, CardQueue.Review, CardQueue.DayLearning, today],
    );

    return Math.max(0, toInteger(row?.count));
}

async function loadDeckTags(
    connection: CollectionDatabaseConnection,
    deckIds: readonly number[],
): Promise<string[]> {
    if (deckIds.length === 0) {
        return [];
    }

    const params: number[] = [];
    const deckSql = inSqlList("c.did", deckIds, params);

    const rows = await connection.select<{ readonly tags: string }>(
        `
        SELECT DISTINCT n.tags AS tags
        FROM notes n
        INNER JOIN cards c ON c.nid = n.id
        WHERE ${deckSql}
        `,
        params,
    );

    const uniqueTags = new Set<string>();
    for (const row of rows) {
        for (const tag of splitTags(row.tags)) {
            uniqueTags.add(tag);
        }
    }

    return [...uniqueTags].sort((left, right) => left.localeCompare(right));
}

function inSqlList(column: string, values: readonly number[], params: Array<number | string>): string {
    if (values.length === 0) {
        return "1 = 0";
    }

    if (values.length === 1) {
        params.push(Math.trunc(values[0] ?? 0));
        return `${column} = ?`;
    }

    const placeholders = values.map(() => "?").join(", ");
    params.push(...values.map((value) => Math.trunc(value)));
    return `${column} IN (${placeholders})`;
}

function splitTags(tags: string | undefined): string[] {
    if (typeof tags !== "string") {
        return [];
    }

    return tags
        .split(" ")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

function normalizeTagList(value: unknown): string[] {
    const tags = Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string")
            .flatMap(splitTags)
        : typeof value === "string"
            ? splitTags(value)
            : [];

    return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
}

function customStudyIncludeTagKey(deckId: number): string {
    return `${CUSTOM_STUDY_INCLUDE_TAGS_KEY_PREFIX}${Math.trunc(deckId)}`;
}

function customStudyExcludeTagKey(deckId: number): string {
    return `${CUSTOM_STUDY_EXCLUDE_TAGS_KEY_PREFIX}${Math.trunc(deckId)}`;
}

function decodeRevlogIdMs(column: string): string {
    return `CASE WHEN ${column} > ${ENCODED_REVLOG_ID_THRESHOLD} THEN CAST(${column} / 10 AS INTEGER) ELSE ${column} END`;
}

function normalizeIntradayDueSql(column: string): string {
    return `CASE WHEN ${column} > 0 AND ${column} < 1000000000000 THEN ${column} * 1000 ELSE ${column} END`;
}

function normalizeDueForSortSql(column: string): string {
    return `CASE
        WHEN ${column} > 1000000000000 THEN ${column}
        WHEN ${column} > 1000000000 THEN ${column} * 1000
        ELSE (? + (${column} - ?) * 86400000)
    END`;
}

function applyTagClauses(
    whereClauses: string[],
    whereParams: Array<number | string>,
    includeTags: readonly string[],
    excludeTags: readonly string[],
): void {
    if (includeTags.length > 0) {
        const includeClauses = includeTags.map(() => "n.tags LIKE ? ESCAPE '\\'").join(" OR ");
        whereClauses.push(`(${includeClauses})`);
        for (const tag of includeTags) {
            whereParams.push(`% ${escapeLike(tag)} %`);
        }
    }

    for (const tag of excludeTags) {
        whereClauses.push("n.tags NOT LIKE ? ESCAPE '\\'");
        whereParams.push(`% ${escapeLike(tag)} %`);
    }
}

function escapeLike(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function restoreQueueFromTypeAndDue(type: number, due: number): number {
    if (type === CardType.New) {
        return CardQueue.New;
    }

    if (type === CardType.Review) {
        return CardQueue.Review;
    }

    if (type === CardType.Learning || type === CardType.Relearning) {
        return due > 1_000_000_000 ? CardQueue.Learning : CardQueue.DayLearning;
    }

    return CardQueue.Review;
}

function toInteger(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }

    return Math.trunc(value);
}

function firstBoolean(...values: unknown[]): boolean {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }

    return false;
}
