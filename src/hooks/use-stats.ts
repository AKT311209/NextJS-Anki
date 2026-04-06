"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { fromDayNumber, toDayNumber } from "@/lib/scheduler/states";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECS = 24 * 60 * 60;
const HEATMAP_LOOKBACK_DAYS = 365;
const RETENTION_WINDOW_DAYS = 30;
const FORECAST_HORIZON_DAYS = 30;
const DEFAULT_CACHE_TTL_MS = 30_000;
const REVLOG_ID_TIMESTAMP_ENCODING_THRESHOLD = 10_000_000_000_000;
const MATURE_INTERVAL_DAYS = 21;

const REVLOG_REVIEW_KIND = {
    Learning: 0,
    Review: 1,
    Relearning: 2,
    Filtered: 3,
    Manual: 4,
    Rescheduled: 5,
} as const;

interface CachedStatsSnapshot {
    readonly createdAt: number;
    readonly payload: StatsSnapshot;
}

const statsSnapshotCache = new Map<string, CachedStatsSnapshot>();

export interface DeckOption {
    readonly id: number;
    readonly name: string;
}

export interface StatsOverview {
    readonly reviewsToday: number;
    readonly correctRateToday: number;
    readonly averageAnswerSecondsToday: number;
    readonly totalCards: number;
    readonly totalNotes: number;
    readonly totalReviews: number;
    readonly dueToday: number;
    readonly stateCounts: {
        readonly new: number;
        readonly learning: number;
        readonly review: number;
        readonly relearning: number;
        readonly suspended: number;
        readonly buried: number;
    };
}

export interface TodayStats {
    readonly answerCount: number;
    readonly answerMillis: number;
    readonly correctCount: number;
    readonly matureCorrect: number;
    readonly matureCount: number;
    readonly learnCount: number;
    readonly reviewCount: number;
    readonly relearnCount: number;
    readonly earlyReviewCount: number;
}

export interface TrueRetentionPeriod {
    readonly youngPassed: number;
    readonly youngFailed: number;
    readonly maturePassed: number;
    readonly matureFailed: number;
}

export interface TrueRetentionStats {
    readonly today: TrueRetentionPeriod;
    readonly yesterday: TrueRetentionPeriod;
    readonly week: TrueRetentionPeriod;
    readonly month: TrueRetentionPeriod;
    readonly year: TrueRetentionPeriod;
    readonly allTime: TrueRetentionPeriod;
}

export interface FutureDuePoint {
    readonly dayOffset: number;
    readonly dueCount: number;
}

export interface FutureDueStats {
    readonly dueByDay: readonly FutureDuePoint[];
    readonly haveBacklog: boolean;
    readonly dailyLoad: number;
}

export interface DailyReviewPoint {
    readonly dayNumber: number;
    readonly dateLabel: string;
    readonly reviews: number;
    readonly retained: number;
    readonly correctRate: number;
}

export interface RetentionPoint {
    readonly dayNumber: number;
    readonly dateLabel: string;
    readonly reviews: number;
    readonly retained: number;
    readonly rate: number;
}

export interface ForecastPoint {
    readonly dayNumber: number;
    readonly dateLabel: string;
    readonly dayOffset: number;
    readonly learning: number;
    readonly review: number;
    readonly newCards: number;
    readonly total: number;
}

export interface DistributionPoint {
    readonly label: string;
    readonly count: number;
}

export interface HourDistributionPoint {
    readonly hour: number;
    readonly count: number;
}

export interface HourlyBreakdownPoint {
    readonly hour: number;
    readonly total: number;
    readonly correct: number;
}

export interface HourlyBreakdown {
    readonly oneMonth: readonly HourlyBreakdownPoint[];
    readonly threeMonths: readonly HourlyBreakdownPoint[];
    readonly oneYear: readonly HourlyBreakdownPoint[];
    readonly allTime: readonly HourlyBreakdownPoint[];
}

export interface DeckRetentionPoint {
    readonly deckId: number;
    readonly deckName: string;
    readonly reviews: number;
    readonly retained: number;
    readonly rate: number;
}

export interface DeckForecastPoint {
    readonly deckId: number;
    readonly deckName: string;
    readonly dueToday: number;
    readonly dueNext7Days: number;
    readonly newCards: number;
    readonly learningCards: number;
    readonly reviewCards: number;
}

export interface DeckFsrsSnapshot {
    readonly deckId: number;
    readonly deckName: string;
    readonly configId: number;
    readonly requestRetention: number | null;
    readonly maximumInterval: number | null;
    readonly learningSteps: readonly string[];
    readonly relearningSteps: readonly string[];
    readonly newPerDay: number | null;
    readonly reviewsPerDay: number | null;
    readonly learningPerDay: number | null;
    readonly enableFuzz: boolean | null;
    readonly burySiblings: boolean | null;
}

export interface StatsSnapshot {
    readonly generatedAt: number;
    readonly deckOptions: readonly DeckOption[];
    readonly scope: {
        readonly selectedDeckId: number | null;
        readonly deckIds: readonly number[] | null;
    };
    readonly overview: StatsOverview;
    readonly today: TodayStats;
    readonly trueRetention: TrueRetentionStats;
    readonly futureDue: FutureDueStats;
    readonly reviewHeatmap: readonly DailyReviewPoint[];
    readonly retention: readonly RetentionPoint[];
    readonly forecast: readonly ForecastPoint[];
    readonly intervalDistribution: readonly DistributionPoint[];
    readonly easeDistribution: readonly DistributionPoint[];
    readonly maturityBreakdown: readonly DistributionPoint[];
    readonly hourlyBreakdown: HourlyBreakdown;
    readonly hourlyDistribution: readonly HourDistributionPoint[];
    readonly deckRetention: readonly DeckRetentionPoint[];
    readonly deckForecast: readonly DeckForecastPoint[];
    readonly fsrs: DeckFsrsSnapshot | null;
}

interface MutableHourlyBreakdownPoint {
    readonly hour: number;
    total: number;
    correct: number;
}

export interface ComputeStatsSnapshotOptions {
    readonly selectedDeckId?: number | null;
    readonly now?: Date;
    readonly decks?: readonly DeckRecord[];
}

export interface UseStatsResult {
    readonly loading: boolean;
    readonly error: string | null;
    readonly selectedDeckId: number | null;
    readonly deckOptions: readonly DeckOption[];
    readonly stats: StatsSnapshot | null;
    readonly setSelectedDeckId: (deckId: number | null) => void;
    readonly reload: () => Promise<void>;
}

interface OverviewRow {
    readonly totalCards: number;
    readonly newCards: number;
    readonly learningCards: number;
    readonly reviewCards: number;
    readonly relearningCards: number;
    readonly suspendedCards: number;
    readonly buriedCards: number;
    readonly dueToday: number;
}

interface CountRow {
    readonly total: number;
}

interface RevlogHistoryRow {
    readonly timestampMs: number;
    readonly ease: number;
    readonly reviewKind: number;
    readonly lastIvl: number;
    readonly factor: number;
    readonly takenMillis: number;
}

interface CardStatsRow {
    readonly did: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
    readonly odue: number;
    readonly odid: number;
    readonly ivl: number;
    readonly factor: number;
}

interface DeckRetentionRow {
    readonly deckId: number;
    readonly total: number;
    readonly retained: number;
}

interface DeckScopeSql {
    readonly whereSql: string;
    readonly params: readonly number[];
}

interface MutableDeckForecast {
    readonly deckId: number;
    readonly deckName: string;
    dueToday: number;
    dueNext7Days: number;
    newCards: number;
    learningCards: number;
    reviewCards: number;
}

const INTERVAL_BUCKETS = [
    { label: "0d", min: 0, max: 0 },
    { label: "1d", min: 1, max: 1 },
    { label: "2-3d", min: 2, max: 3 },
    { label: "4-7d", min: 4, max: 7 },
    { label: "8-14d", min: 8, max: 14 },
    { label: "15-30d", min: 15, max: 30 },
    { label: "31-90d", min: 31, max: 90 },
    { label: "91-180d", min: 91, max: 180 },
    { label: "181-365d", min: 181, max: 365 },
    { label: "365+d", min: 366, max: Number.POSITIVE_INFINITY },
] as const;

const EASE_BUCKETS = [
    { label: "<1300", min: Number.NEGATIVE_INFINITY, max: 1299 },
    { label: "1300-1699", min: 1300, max: 1699 },
    { label: "1700-2099", min: 1700, max: 2099 },
    { label: "2100-2499", min: 2100, max: 2499 },
    { label: "2500-2899", min: 2500, max: 2899 },
    { label: "2900+", min: 2900, max: Number.POSITIVE_INFINITY },
] as const;

const MATURITY_LABELS = {
    new: "New",
    learning: "Learning/Relearning",
    young: "Young (<21d)",
    mature: "Mature (≥21d)",
    suspended: "Suspended/Buried",
} as const;

export function useStats(initialDeckId: number | null = null): UseStatsResult {
    const collection = useCollection();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedDeckId, setSelectedDeckId] = useState<number | null>(initialDeckId);
    const [deckOptions, setDeckOptions] = useState<DeckOption[]>([]);
    const [stats, setStats] = useState<StatsSnapshot | null>(null);

    const requestToken = useRef(0);

    const loadStats = useCallback(
        async (force: boolean) => {
            if (!collection.connection || !collection.ready) {
                return;
            }

            const now = new Date();
            const token = requestToken.current + 1;
            requestToken.current = token;

            setLoading(true);
            setError(null);

            try {
                await ensureCollectionBootstrap(collection.connection);

                const cacheKey = buildCacheKey(selectedDeckId, toDayNumber(now));
                const cached = statsSnapshotCache.get(cacheKey);
                if (
                    !force &&
                    cached &&
                    now.getTime() - cached.createdAt <= DEFAULT_CACHE_TTL_MS
                ) {
                    if (requestToken.current !== token) {
                        return;
                    }

                    setStats(cached.payload);
                    setDeckOptions([...cached.payload.deckOptions]);
                    setLoading(false);
                    return;
                }

                const snapshot = await computeStatsSnapshot(collection.connection, {
                    selectedDeckId,
                    now,
                });

                if (requestToken.current !== token) {
                    return;
                }

                statsSnapshotCache.set(cacheKey, {
                    createdAt: now.getTime(),
                    payload: snapshot,
                });

                setStats(snapshot);
                setDeckOptions([...snapshot.deckOptions]);

                if (snapshot.scope.selectedDeckId !== selectedDeckId) {
                    setSelectedDeckId(snapshot.scope.selectedDeckId);
                }

                setLoading(false);
            } catch (cause) {
                if (requestToken.current !== token) {
                    return;
                }

                const message = cause instanceof Error ? cause.message : "Failed to load stats.";
                setError(message);
                setLoading(false);
            }
        },
        [collection.connection, collection.ready, selectedDeckId],
    );

    useEffect(() => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        let disposed = false;

        queueMicrotask(() => {
            if (disposed) {
                return;
            }

            void loadStats(false);
        });

        return () => {
            disposed = true;
        };
    }, [collection.connection, collection.ready, loadStats]);

    return useMemo(
        () => ({
            loading: loading || collection.loading,
            error: error ?? collection.error,
            selectedDeckId,
            deckOptions,
            stats,
            setSelectedDeckId,
            reload: async () => {
                await loadStats(true);
            },
        }),
        [collection.error, collection.loading, deckOptions, error, loadStats, loading, selectedDeckId, stats],
    );
}

export async function computeStatsSnapshot(
    connection: CollectionDatabaseConnection,
    options: ComputeStatsSnapshotOptions = {},
): Promise<StatsSnapshot> {
    const now = options.now ?? new Date();
    const decks = options.decks ?? (await new DecksRepository(connection).list());

    const selectedDeckId = normalizeSelectedDeckId(options.selectedDeckId ?? null, decks);
    const scopedDeckIds = resolveDeckScopeIds(selectedDeckId, decks);
    const deckOptions = decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
    }));
    const deckNameById = new Map(decks.map((deck) => [deck.id, deck.name]));

    const cardScope = buildDeckScopeSql("c", scopedDeckIds);

    const nowMs = now.getTime();
    const todayDay = toDayNumber(now);
    const nextDayStartMs = fromDayNumber(todayDay + 1).getTime();
    const historyStartDay = todayDay - (HEATMAP_LOOKBACK_DAYS - 1);
    const revlogTimestampExpr = revlogTimestampSql("r");

    const [
        overviewRow,
        totalNotesRow,
        totalReviewsRow,
        revlogHistoryRows,
        deckRetentionRows,
        cardRows,
    ] = await Promise.all([
        connection.get<OverviewRow>(
            `
            SELECT
                COUNT(*) AS totalCards,
                SUM(CASE WHEN c.type = 0 THEN 1 ELSE 0 END) AS newCards,
                SUM(CASE WHEN c.type = 1 THEN 1 ELSE 0 END) AS learningCards,
                SUM(CASE WHEN c.type = 2 THEN 1 ELSE 0 END) AS reviewCards,
                SUM(CASE WHEN c.type = 3 THEN 1 ELSE 0 END) AS relearningCards,
                SUM(CASE WHEN c.queue = -1 THEN 1 ELSE 0 END) AS suspendedCards,
                SUM(CASE WHEN c.queue IN (-2, -3) THEN 1 ELSE 0 END) AS buriedCards,
                SUM(
                    CASE
                        WHEN c.queue = 1 AND c.due <= ? THEN 1
                        WHEN c.queue IN (2, 3) AND c.due <= ? THEN 1
                        ELSE 0
                    END
                ) AS dueToday
            FROM cards c
            WHERE ${cardScope.whereSql}
            `,
            [nowMs, todayDay, ...cardScope.params],
        ),
        connection.get<CountRow>(
            `
            SELECT COUNT(DISTINCT c.nid) AS total
            FROM cards c
            WHERE ${cardScope.whereSql}
            `,
            [...cardScope.params],
        ),
        connection.get<CountRow>(
            `
            SELECT COUNT(*) AS total
            FROM revlog r
            INNER JOIN cards c ON c.id = r.cid
            WHERE ${cardScope.whereSql}
            `,
            [...cardScope.params],
        ),
        connection.select<RevlogHistoryRow>(
            `
            SELECT
                ${revlogTimestampExpr} AS timestampMs,
                r.ease,
                r.type AS reviewKind,
                r.lastIvl,
                r.factor,
                r.time AS takenMillis
            FROM revlog r
            INNER JOIN cards c ON c.id = r.cid
            WHERE ${cardScope.whereSql}
            ORDER BY timestampMs ASC
            `,
            [...cardScope.params],
        ),
        connection.select<DeckRetentionRow>(
            `
            SELECT
                c.did AS deckId,
                COUNT(*) AS total,
                SUM(CASE WHEN r.ease > 1 THEN 1 ELSE 0 END) AS retained
            FROM revlog r
            INNER JOIN cards c ON c.id = r.cid
            WHERE ${cardScope.whereSql}
            GROUP BY c.did
            ORDER BY total DESC, c.did ASC
            LIMIT 12
            `,
            [...cardScope.params],
        ),
        connection.select<CardStatsRow>(
            `
            SELECT c.did, c.type, c.queue, c.due, c.odue, c.odid, c.ivl, c.factor
            FROM cards c
            WHERE ${cardScope.whereSql}
            `,
            [...cardScope.params],
        ),
    ]);

    const configRepository = new ConfigRepository(connection);
    const deckConfigs = await configRepository.getDeckConfigs();

    const newCardsByDeck = new Map<number, number>();
    for (const card of cardRows) {
        if (asFiniteInteger(card.queue) === 0) {
            const deckId = asFiniteInteger(card.did);
            newCardsByDeck.set(deckId, (newCardsByDeck.get(deckId) ?? 0) + 1);
        }
    }

    let remainingNewToday = 0;
    for (const [deckId, available] of newCardsByDeck) {
        if (!scopedDeckIds || scopedDeckIds.includes(deckId)) {
            const deck = decks.find((d) => d.id === deckId);
            const confId = String(deck?.conf ?? 1);
            const conf = deckConfigs[confId];
            const confRecord =
                conf && typeof conf === "object" && !Array.isArray(conf)
                    ? (conf as Record<string, unknown>)
                    : undefined;
            const quota = readNumber(confRecord?.newPerDay, readNestedNumber(confRecord?.new, "perDay")) ?? 20;

            const studied = getDeckNewStudiedToday(deck, todayDay);
            remainingNewToday += Math.min(available, Math.max(0, quota - studied));
        }
    }

    const dueTodayLearningAndReview = asFiniteInteger(overviewRow?.dueToday);
    const todayStats = buildTodayStats(revlogHistoryRows, nextDayStartMs);

    const overview: StatsOverview = {
        reviewsToday: todayStats.answerCount,
        correctRateToday: ratio(todayStats.correctCount, todayStats.answerCount),
        averageAnswerSecondsToday:
            todayStats.answerCount > 0
                ? todayStats.answerMillis / todayStats.answerCount / 1000
                : 0,
        totalCards: asFiniteInteger(overviewRow?.totalCards),
        totalNotes: asFiniteInteger(totalNotesRow?.total),
        totalReviews: asFiniteInteger(totalReviewsRow?.total),
        dueToday: dueTodayLearningAndReview + remainingNewToday,
        stateCounts: {
            new: asFiniteInteger(overviewRow?.newCards),
            learning: asFiniteInteger(overviewRow?.learningCards),
            review: asFiniteInteger(overviewRow?.reviewCards),
            relearning: asFiniteInteger(overviewRow?.relearningCards),
            suspended: asFiniteInteger(overviewRow?.suspendedCards),
            buried: asFiniteInteger(overviewRow?.buriedCards),
        },
    };

    const reviewHeatmap = buildReviewHeatmap(historyStartDay, todayDay, revlogHistoryRows);
    const retention = buildRetentionSeries(reviewHeatmap);
    const trueRetention = buildTrueRetentionStats(revlogHistoryRows, nextDayStartMs);
    const futureDue = buildFutureDueStats(cardRows, nextDayStartMs, todayDay);
    const hourlyBreakdown = buildHourlyBreakdown(revlogHistoryRows, nextDayStartMs, now);
    const hourlyDistribution = hourlyBreakdown.allTime.map((point) => ({
        hour: point.hour,
        count: point.total,
    }));
    const intervalDistribution = buildIntervalDistribution(cardRows);
    const easeDistribution = buildEaseDistribution(cardRows);
    const maturityBreakdown = buildMaturityBreakdown(cardRows);
    const forecast = buildForecast(cardRows, nowMs, todayDay);
    const deckForecast = buildDeckForecast(cardRows, deckNameById, nowMs, todayDay);
    const deckRetention = deckRetentionRows.map((row) => {
        const reviews = asFiniteInteger(row.total);
        const retained = asFiniteInteger(row.retained);
        return {
            deckId: asFiniteInteger(row.deckId),
            deckName: deckNameById.get(asFiniteInteger(row.deckId)) ?? `Deck ${row.deckId}`,
            reviews,
            retained,
            rate: ratio(retained, reviews),
        } satisfies DeckRetentionPoint;
    });

    const fsrs = await resolveDeckFsrsSnapshot(connection, selectedDeckId, decks);

    return {
        generatedAt: now.getTime(),
        deckOptions,
        scope: {
            selectedDeckId,
            deckIds: scopedDeckIds,
        },
        overview,
        today: todayStats,
        trueRetention,
        futureDue,
        reviewHeatmap,
        retention,
        forecast,
        intervalDistribution,
        easeDistribution,
        maturityBreakdown,
        hourlyBreakdown,
        hourlyDistribution,
        deckRetention,
        deckForecast,
        fsrs,
    };
}

function buildTodayStats(
    historyRows: readonly RevlogHistoryRow[],
    nextDayStartMs: number,
): TodayStats {
    const startOfTodayMs = nextDayStartMs - DAY_MS;

    const today: {
        answerCount: number;
        answerMillis: number;
        correctCount: number;
        matureCorrect: number;
        matureCount: number;
        learnCount: number;
        reviewCount: number;
        relearnCount: number;
        earlyReviewCount: number;
    } = {
        answerCount: 0,
        answerMillis: 0,
        correctCount: 0,
        matureCorrect: 0,
        matureCount: 0,
        learnCount: 0,
        reviewCount: 0,
        relearnCount: 0,
        earlyReviewCount: 0,
    };

    for (let index = historyRows.length - 1; index >= 0; index -= 1) {
        const row = historyRows[index];
        const timestampMs = asFiniteNumber(row.timestampMs);
        if (timestampMs < startOfTodayMs) {
            break;
        }

        const reviewKind = asFiniteInteger(row.reviewKind);
        if (
            reviewKind === REVLOG_REVIEW_KIND.Manual ||
            reviewKind === REVLOG_REVIEW_KIND.Rescheduled
        ) {
            continue;
        }

        today.answerCount += 1;
        today.answerMillis += Math.max(0, asFiniteInteger(row.takenMillis));

        if (asFiniteInteger(row.ease) > 1) {
            today.correctCount += 1;
        }

        if (asFiniteInteger(row.lastIvl) >= MATURE_INTERVAL_DAYS) {
            today.matureCount += 1;
            if (asFiniteInteger(row.ease) > 1) {
                today.matureCorrect += 1;
            }
        }

        if (reviewKind === REVLOG_REVIEW_KIND.Learning) {
            today.learnCount += 1;
        } else if (reviewKind === REVLOG_REVIEW_KIND.Review) {
            today.reviewCount += 1;
        } else if (reviewKind === REVLOG_REVIEW_KIND.Relearning) {
            today.relearnCount += 1;
        } else if (reviewKind === REVLOG_REVIEW_KIND.Filtered) {
            today.earlyReviewCount += 1;
        }
    }

    return today;
}

function buildTrueRetentionStats(
    historyRows: readonly RevlogHistoryRow[],
    nextDayStartMs: number,
): TrueRetentionStats {
    const nextDayStartSecs = Math.trunc(nextDayStartMs / 1000);
    const day = DAY_SECS;

    const periods = [
        {
            key: "today",
            startSec: nextDayStartSecs - day,
            endSec: nextDayStartSecs,
        },
        {
            key: "yesterday",
            startSec: nextDayStartSecs - day * 2,
            endSec: nextDayStartSecs - day,
        },
        {
            key: "week",
            startSec: nextDayStartSecs - day * 7,
            endSec: nextDayStartSecs,
        },
        {
            key: "month",
            startSec: nextDayStartSecs - day * 30,
            endSec: nextDayStartSecs,
        },
        {
            key: "year",
            startSec: nextDayStartSecs - day * 365,
            endSec: nextDayStartSecs,
        },
        {
            key: "allTime",
            startSec: 0,
            endSec: nextDayStartSecs,
        },
    ] as const;

    const stats: Record<
        (typeof periods)[number]["key"],
        {
            youngPassed: number;
            youngFailed: number;
            maturePassed: number;
            matureFailed: number;
        }
    > = {
        today: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
        yesterday: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
        week: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
        month: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
        year: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
        allTime: { youngPassed: 0, youngFailed: 0, maturePassed: 0, matureFailed: 0 },
    };

    for (const row of historyRows) {
        const reviewKind = asFiniteInteger(row.reviewKind);
        const ease = asFiniteInteger(row.ease);
        const factor = asFiniteInteger(row.factor);
        const lastInterval = asFiniteInteger(row.lastIvl);

        const affectsScheduling = ease > 0 && !(reviewKind === REVLOG_REVIEW_KIND.Filtered && factor === 0);
        if (!affectsScheduling) {
            continue;
        }

        const qualifiesForTrueRetention =
            reviewKind === REVLOG_REVIEW_KIND.Review ||
            lastInterval <= -DAY_SECS ||
            lastInterval >= 1;
        if (!qualifiesForTrueRetention) {
            continue;
        }

        const reviewSec = Math.trunc(asFiniteNumber(row.timestampMs) / 1000);
        const isYoung = lastInterval < MATURE_INTERVAL_DAYS;
        const failed = ease === 1;

        for (const period of periods) {
            if (reviewSec < period.startSec || reviewSec >= period.endSec) {
                continue;
            }

            const target = stats[period.key];
            if (isYoung) {
                if (failed) {
                    target.youngFailed += 1;
                } else {
                    target.youngPassed += 1;
                }
            } else if (failed) {
                target.matureFailed += 1;
            } else {
                target.maturePassed += 1;
            }
        }
    }

    return {
        today: stats.today,
        yesterday: stats.yesterday,
        week: stats.week,
        month: stats.month,
        year: stats.year,
        allTime: stats.allTime,
    };
}

function buildFutureDueStats(
    cardRows: readonly CardStatsRow[],
    nextDayStartMs: number,
    todayDay: number,
): FutureDueStats {
    const dueByDay = new Map<number, number>();
    let haveBacklog = false;
    let dailyLoad = 0;

    for (const card of cardRows) {
        const cardType = asFiniteInteger(card.type);
        if (cardType === 0) {
            continue;
        }

        const queue = asFiniteInteger(card.queue);
        if (queue === -1) {
            continue;
        }

        const rawDue = originalOrCurrentDue(card);
        const dueDay = isUnixEpochTimestamp(rawDue)
            ? Math.trunc((normalizeEpochTimestampToMs(rawDue) - nextDayStartMs) / DAY_MS)
            : rawDue - todayDay;

        dailyLoad += 1 / Math.max(1, asFiniteInteger(card.ivl));

        if (dueDay <= 0 && (queue === -2 || queue === -3)) {
            continue;
        }

        haveBacklog ||= dueDay < 0;
        dueByDay.set(dueDay, (dueByDay.get(dueDay) ?? 0) + 1);
    }

    return {
        dueByDay: [...dueByDay.entries()]
            .sort((left, right) => left[0] - right[0])
            .map(([dayOffset, dueCount]) => ({
                dayOffset,
                dueCount,
            })),
        haveBacklog,
        dailyLoad: Math.max(0, Math.trunc(dailyLoad)),
    };
}

function originalOrCurrentDue(card: CardStatsRow): number {
    const originalDeckId = asFiniteInteger(card.odid);
    if (originalDeckId !== 0) {
        return asFiniteInteger(card.odue);
    }

    return asFiniteInteger(card.due);
}

function isUnixEpochTimestamp(value: number): boolean {
    return value > 1_000_000_000;
}

function normalizeEpochTimestampToMs(value: number): number {
    if (value >= 1_000_000_000_000) {
        return value;
    }

    return value * 1000;
}

function buildReviewHeatmap(
    startDay: number,
    endDay: number,
    historyRows: readonly RevlogHistoryRow[],
): DailyReviewPoint[] {
    const perDay = new Map<number, { reviews: number; retained: number }>();

    for (const row of historyRows) {
        const reviewKind = asFiniteInteger(row.reviewKind);
        if (
            reviewKind === REVLOG_REVIEW_KIND.Manual ||
            reviewKind === REVLOG_REVIEW_KIND.Rescheduled
        ) {
            continue;
        }

        const timestamp = asFiniteNumber(row.timestampMs);
        const day = Math.floor(timestamp / DAY_MS);

        const existing = perDay.get(day) ?? { reviews: 0, retained: 0 };
        existing.reviews += 1;
        if (asFiniteInteger(row.ease) > 1) {
            existing.retained += 1;
        }

        perDay.set(day, existing);
    }

    const points: DailyReviewPoint[] = [];
    for (let day = startDay; day <= endDay; day += 1) {
        const daily = perDay.get(day);
        const reviews = daily?.reviews ?? 0;
        const retained = daily?.retained ?? 0;

        points.push({
            dayNumber: day,
            dateLabel: formatDay(day),
            reviews,
            retained,
            correctRate: ratio(retained, reviews),
        });
    }

    return points;
}

function buildRetentionSeries(heatmap: readonly DailyReviewPoint[]): RetentionPoint[] {
    return heatmap.slice(-RETENTION_WINDOW_DAYS).map((point) => ({
        dayNumber: point.dayNumber,
        dateLabel: point.dateLabel,
        reviews: point.reviews,
        retained: point.retained,
        rate: point.correctRate,
    }));
}

function buildHourlyBreakdown(
    historyRows: readonly RevlogHistoryRow[],
    nextDayStartMs: number,
    now: Date,
): HourlyBreakdown {
    const oneMonth = createMutableHourlyBreakdownPoints();
    const threeMonths = createMutableHourlyBreakdownPoints();
    const oneYear = createMutableHourlyBreakdownPoints();
    const allTime = createMutableHourlyBreakdownPoints();

    const oneMonthCutoffSec = Math.trunc((nextDayStartMs - 30 * DAY_MS) / 1000);
    const threeMonthsCutoffSec = Math.trunc((nextDayStartMs - 90 * DAY_MS) / 1000);
    const oneYearCutoffSec = Math.trunc((nextDayStartMs - 365 * DAY_MS) / 1000);
    const localOffsetSecs = -now.getTimezoneOffset() * 60;

    for (const row of historyRows) {
        const reviewKind = asFiniteInteger(row.reviewKind);
        if (
            reviewKind === REVLOG_REVIEW_KIND.Filtered ||
            reviewKind === REVLOG_REVIEW_KIND.Manual ||
            reviewKind === REVLOG_REVIEW_KIND.Rescheduled
        ) {
            continue;
        }

        const reviewSecs = Math.trunc(asFiniteNumber(row.timestampMs) / 1000);
        const hour = toHourOfDayIndex(reviewSecs + localOffsetSecs);
        const correct = asFiniteInteger(row.ease) > 1;

        incrementHourlyBucket(allTime, hour, correct);

        if (reviewSecs < oneYearCutoffSec) {
            continue;
        }
        incrementHourlyBucket(oneYear, hour, correct);

        if (reviewSecs < threeMonthsCutoffSec) {
            continue;
        }
        incrementHourlyBucket(threeMonths, hour, correct);

        if (reviewSecs < oneMonthCutoffSec) {
            continue;
        }
        incrementHourlyBucket(oneMonth, hour, correct);
    }

    return {
        oneMonth,
        threeMonths,
        oneYear,
        allTime,
    };
}

function createMutableHourlyBreakdownPoints(): MutableHourlyBreakdownPoint[] {
    return Array.from({ length: 24 }, (_, hour) => ({
        hour,
        total: 0,
        correct: 0,
    }));
}

function incrementHourlyBucket(
    bucket: MutableHourlyBreakdownPoint[],
    hour: number,
    correct: boolean,
): void {
    const point = bucket[hour];
    if (!point) {
        return;
    }

    point.total += 1;
    if (correct) {
        point.correct += 1;
    }
}

function toHourOfDayIndex(hourSeed: number): number {
    const base = Math.trunc(hourSeed / 3600);
    const normalized = base % 24;
    return normalized >= 0 ? normalized : normalized + 24;
}

function buildIntervalDistribution(cardRows: readonly CardStatsRow[]): DistributionPoint[] {
    const counts = Array.from({ length: INTERVAL_BUCKETS.length }, () => 0);

    for (const card of cardRows) {
        const interval = Math.max(0, asFiniteInteger(card.ivl));
        const bucketIndex = findBucketIndex(interval, INTERVAL_BUCKETS);
        if (bucketIndex >= 0) {
            counts[bucketIndex] += 1;
        }
    }

    return INTERVAL_BUCKETS.map((bucket, index) => ({
        label: bucket.label,
        count: counts[index],
    }));
}

function buildEaseDistribution(cardRows: readonly CardStatsRow[]): DistributionPoint[] {
    const counts = Array.from({ length: EASE_BUCKETS.length }, () => 0);

    for (const card of cardRows) {
        const factor = asFiniteInteger(card.factor);
        const bucketIndex = findBucketIndex(factor, EASE_BUCKETS);
        if (bucketIndex >= 0) {
            counts[bucketIndex] += 1;
        }
    }

    return EASE_BUCKETS.map((bucket, index) => ({
        label: bucket.label,
        count: counts[index],
    }));
}

function buildMaturityBreakdown(cardRows: readonly CardStatsRow[]): DistributionPoint[] {
    const counts = {
        new: 0,
        learning: 0,
        young: 0,
        mature: 0,
        suspended: 0,
    };

    for (const card of cardRows) {
        const queue = asFiniteInteger(card.queue);
        const type = asFiniteInteger(card.type);
        const interval = Math.max(0, asFiniteInteger(card.ivl));

        if (queue < 0) {
            counts.suspended += 1;
            continue;
        }

        if (type === 0 || queue === 0) {
            counts.new += 1;
            continue;
        }

        if (type === 1 || type === 3 || queue === 1 || queue === 3) {
            counts.learning += 1;
            continue;
        }

        if (interval < 21) {
            counts.young += 1;
            continue;
        }

        counts.mature += 1;
    }

    return [
        { label: MATURITY_LABELS.new, count: counts.new },
        { label: MATURITY_LABELS.learning, count: counts.learning },
        { label: MATURITY_LABELS.young, count: counts.young },
        { label: MATURITY_LABELS.mature, count: counts.mature },
        { label: MATURITY_LABELS.suspended, count: counts.suspended },
    ];
}

function buildForecast(
    cardRows: readonly CardStatsRow[],
    nowMs: number,
    todayDay: number,
): ForecastPoint[] {
    const points = Array.from({ length: FORECAST_HORIZON_DAYS + 1 }, (_, dayOffset) => ({
        dayNumber: todayDay + dayOffset,
        dateLabel: formatDay(todayDay + dayOffset),
        dayOffset,
        learning: 0,
        review: 0,
        newCards: 0,
        total: 0,
    }));

    for (const card of cardRows) {
        const queue = asFiniteInteger(card.queue);
        if (queue < 0 || queue === 4) {
            continue;
        }

        if (queue === 0) {
            points[0].newCards += 1;
            continue;
        }

        if (queue === 1) {
            const dueTimestampMs = normalizeEpochTimestampToMs(asFiniteNumber(card.due));
            const dueDay = Math.floor(dueTimestampMs / DAY_MS);
            const offset = normalizeForecastOffset(dueDay - todayDay);
            if (offset !== null) {
                points[offset].learning += 1;
            }
            continue;
        }

        if (queue === 2 || queue === 3) {
            const dueDay = asFiniteInteger(card.due);
            const offset = normalizeForecastOffset(dueDay - todayDay);
            if (offset !== null) {
                points[offset].review += 1;
            }
        }
    }

    for (const point of points) {
        point.total = point.learning + point.review + point.newCards;
    }

    return points;
}

function buildDeckForecast(
    cardRows: readonly CardStatsRow[],
    deckNameById: ReadonlyMap<number, string>,
    nowMs: number,
    todayDay: number,
): DeckForecastPoint[] {
    const forecasts = new Map<number, MutableDeckForecast>();

    for (const card of cardRows) {
        const deckId = asFiniteInteger(card.did);
        const queue = asFiniteInteger(card.queue);

        const entry =
            forecasts.get(deckId) ??
            {
                deckId,
                deckName: deckNameById.get(deckId) ?? `Deck ${deckId}`,
                dueToday: 0,
                dueNext7Days: 0,
                newCards: 0,
                learningCards: 0,
                reviewCards: 0,
            };

        if (queue === 0) {
            entry.newCards += 1;
        } else if (queue === 1) {
            entry.learningCards += 1;

            const dueTimestamp = normalizeEpochTimestampToMs(asFiniteNumber(card.due));
            if (dueTimestamp <= nowMs) {
                entry.dueToday += 1;
            }

            const dueDay = Math.floor(dueTimestamp / DAY_MS);
            if (dueDay <= todayDay + 6) {
                entry.dueNext7Days += 1;
            }
        } else if (queue === 2 || queue === 3) {
            if (queue === 2) {
                entry.reviewCards += 1;
            } else {
                entry.learningCards += 1;
            }

            const dueDay = asFiniteInteger(card.due);
            if (dueDay <= todayDay) {
                entry.dueToday += 1;
            }
            if (dueDay <= todayDay + 6) {
                entry.dueNext7Days += 1;
            }
        }

        forecasts.set(deckId, entry);
    }

    return [...forecasts.values()]
        .sort((left, right) => {
            if (right.dueToday !== left.dueToday) {
                return right.dueToday - left.dueToday;
            }
            if (right.dueNext7Days !== left.dueNext7Days) {
                return right.dueNext7Days - left.dueNext7Days;
            }
            return left.deckName.localeCompare(right.deckName);
        })
        .slice(0, 12)
        .map((entry) => ({
            deckId: entry.deckId,
            deckName: entry.deckName,
            dueToday: entry.dueToday,
            dueNext7Days: entry.dueNext7Days,
            newCards: entry.newCards,
            learningCards: entry.learningCards,
            reviewCards: entry.reviewCards,
        }));
}

async function resolveDeckFsrsSnapshot(
    connection: CollectionDatabaseConnection,
    selectedDeckId: number | null,
    decks: readonly DeckRecord[],
): Promise<DeckFsrsSnapshot | null> {
    if (selectedDeckId === null) {
        return null;
    }

    const selectedDeck = decks.find((deck) => deck.id === selectedDeckId);
    if (!selectedDeck) {
        return null;
    }

    const configId = selectedDeck.conf ?? 1;
    const configRepository = new ConfigRepository(connection);
    const config = await configRepository.getDeckConfig(configId);

    return {
        deckId: selectedDeck.id,
        deckName: selectedDeck.name,
        configId,
        requestRetention: readNumber(config?.requestRetention),
        maximumInterval: readNumber(config?.maximumInterval, readNestedNumber(config?.rev, "maxIvl")),
        learningSteps: readStepList(config?.learningSteps, readNestedValue(config?.new, "delays")),
        relearningSteps: readStepList(config?.relearningSteps, readNestedValue(config?.lapse, "delays")),
        newPerDay: readNumber(config?.newPerDay, readNestedNumber(config?.new, "perDay")),
        reviewsPerDay: readNumber(config?.reviewsPerDay, readNestedNumber(config?.rev, "perDay")),
        learningPerDay: readNumber(config?.learningPerDay),
        enableFuzz: readBoolean(config?.enableFuzz),
        burySiblings: readBoolean(config?.burySiblings),
    };
}

function normalizeSelectedDeckId(deckId: number | null, decks: readonly DeckRecord[]): number | null {
    if (deckId === null) {
        return null;
    }

    const exists = decks.some((deck) => deck.id === deckId);
    return exists ? deckId : null;
}

function resolveDeckScopeIds(selectedDeckId: number | null, decks: readonly DeckRecord[]): number[] | null {
    if (selectedDeckId === null) {
        return null;
    }

    const selected = decks.find((deck) => deck.id === selectedDeckId);
    if (!selected) {
        return [];
    }

    const normalizedPrefix = selected.name.trim().toLowerCase();

    return decks
        .filter((deck) => {
            const normalizedName = deck.name.trim().toLowerCase();
            return (
                normalizedName === normalizedPrefix ||
                normalizedName.startsWith(`${normalizedPrefix}::`)
            );
        })
        .map((deck) => deck.id)
        .sort((left, right) => left - right);
}

function buildDeckScopeSql(alias: string, deckIds: readonly number[] | null): DeckScopeSql {
    if (deckIds === null) {
        return {
            whereSql: "1 = 1",
            params: [],
        };
    }

    if (deckIds.length === 0) {
        return {
            whereSql: "1 = 0",
            params: [],
        };
    }

    const placeholders = deckIds.map(() => "?").join(", ");
    return {
        whereSql: `${alias}.did IN (${placeholders})`,
        params: [...deckIds],
    };
}

function findBucketIndex(
    value: number,
    buckets: readonly {
        readonly min: number;
        readonly max: number;
    }[],
): number {
    for (let index = 0; index < buckets.length; index += 1) {
        const bucket = buckets[index];
        if (value >= bucket.min && value <= bucket.max) {
            return index;
        }
    }
    return -1;
}

function normalizeForecastOffset(rawOffset: number): number | null {
    const nonNegative = Math.max(0, rawOffset);
    if (nonNegative > FORECAST_HORIZON_DAYS) {
        return null;
    }
    return nonNegative;
}

function ratio(numerator: number, denominator: number): number {
    if (!Number.isFinite(denominator) || denominator <= 0) {
        return 0;
    }

    const value = numerator / denominator;
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }

    if (value > 1) {
        return 1;
    }

    return value;
}

function readStepList(primary: unknown, fallback: unknown): string[] {
    const source = Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : [];
    const values = source
        .map((value) => {
            if (typeof value === "string") {
                const normalized = value.trim().toLowerCase();
                if (/^\d+(m|h|d)$/.test(normalized)) {
                    return normalized;
                }
                return null;
            }

            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                return `${Math.trunc(value)}m`;
            }

            return null;
        })
        .filter((value): value is string => value !== null);

    return values;
}

function readNestedValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    return (value as Record<string, unknown>)[key];
}

function readNestedNumber(value: unknown, key: string): number | null {
    const nested = readNestedValue(value, key);
    return readNumber(nested);
}

function readNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}

function readBoolean(...values: unknown[]): boolean | null {
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return null;
}

function asFiniteInteger(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    return 0;
}

function asFiniteNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return 0;
}

function formatDay(dayNumber: number): string {
    return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function buildCacheKey(selectedDeckId: number | null, dayNumber: number): string {
    if (selectedDeckId === null) {
        return `day:${dayNumber}:all`;
    }
    return `day:${dayNumber}:deck:${selectedDeckId}`;
}

function revlogTimestampSql(alias: string): string {
    return `
        CASE
            WHEN ${alias}.id >= ${REVLOG_ID_TIMESTAMP_ENCODING_THRESHOLD}
                THEN CAST(${alias}.id / 10 AS INTEGER)
            ELSE ${alias}.id
        END
    `;
}

function getDeckNewStudiedToday(deck: DeckRecord | undefined, todayDay: number): number {
    if (!deck) return 0;
    const lastDay = typeof deck.lastDayStudied === "number" && Number.isFinite(deck.lastDayStudied)
        ? Math.trunc(deck.lastDayStudied)
        : -1;
    if (lastDay !== todayDay) return 0;
    const studied = deck.newStudied;
    return typeof studied === "number" && Number.isFinite(studied) ? Math.trunc(studied) : 0;
}
