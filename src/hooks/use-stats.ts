"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { toDayNumber } from "@/lib/scheduler/states";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_LOOKBACK_DAYS = 365;
const RETENTION_WINDOW_DAYS = 30;
const FORECAST_HORIZON_DAYS = 30;
const DEFAULT_CACHE_TTL_MS = 30_000;

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
    readonly reviewHeatmap: readonly DailyReviewPoint[];
    readonly retention: readonly RetentionPoint[];
    readonly forecast: readonly ForecastPoint[];
    readonly intervalDistribution: readonly DistributionPoint[];
    readonly easeDistribution: readonly DistributionPoint[];
    readonly maturityBreakdown: readonly DistributionPoint[];
    readonly hourlyDistribution: readonly HourDistributionPoint[];
    readonly deckRetention: readonly DeckRetentionPoint[];
    readonly deckForecast: readonly DeckForecastPoint[];
    readonly fsrs: DeckFsrsSnapshot | null;
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

interface TodayReviewRow {
    readonly total: number;
    readonly retained: number;
    readonly averageTimeMs: number;
}

interface RevlogHistoryRow {
    readonly id: number;
    readonly ease: number;
}

interface CardStatsRow {
    readonly did: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
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
    const dayStartMs = startOfDayMs(now);
    const dayEndMs = dayStartMs + DAY_MS - 1;
    const historyStartDay = todayDay - (HEATMAP_LOOKBACK_DAYS - 1);
    const historyStartMs = historyStartDay * DAY_MS;

    const [
        overviewRow,
        totalNotesRow,
        totalReviewsRow,
        reviewsTodayRow,
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
                        WHEN c.queue = 0 THEN 1
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
        connection.get<TodayReviewRow>(
            `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN r.ease > 1 THEN 1 ELSE 0 END) AS retained,
                AVG(r.time) AS averageTimeMs
            FROM revlog r
            INNER JOIN cards c ON c.id = r.cid
            WHERE r.id BETWEEN ? AND ?
              AND ${cardScope.whereSql}
            `,
            [dayStartMs, dayEndMs, ...cardScope.params],
        ),
        connection.select<RevlogHistoryRow>(
            `
            SELECT r.id, r.ease
            FROM revlog r
            INNER JOIN cards c ON c.id = r.cid
            WHERE r.id >= ?
              AND ${cardScope.whereSql}
            ORDER BY r.id ASC
            `,
            [historyStartMs, ...cardScope.params],
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
            SELECT c.did, c.type, c.queue, c.due, c.ivl, c.factor
            FROM cards c
            WHERE ${cardScope.whereSql}
            `,
            [...cardScope.params],
        ),
    ]);

    const overview: StatsOverview = {
        reviewsToday: asFiniteInteger(reviewsTodayRow?.total),
        correctRateToday: ratio(
            asFiniteInteger(reviewsTodayRow?.retained),
            asFiniteInteger(reviewsTodayRow?.total),
        ),
        averageAnswerSecondsToday: asFiniteNumber(reviewsTodayRow?.averageTimeMs) / 1000,
        totalCards: asFiniteInteger(overviewRow?.totalCards),
        totalNotes: asFiniteInteger(totalNotesRow?.total),
        totalReviews: asFiniteInteger(totalReviewsRow?.total),
        dueToday: asFiniteInteger(overviewRow?.dueToday),
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
    const hourlyDistribution = buildHourlyDistribution(revlogHistoryRows);
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
        reviewHeatmap,
        retention,
        forecast,
        intervalDistribution,
        easeDistribution,
        maturityBreakdown,
        hourlyDistribution,
        deckRetention,
        deckForecast,
        fsrs,
    };
}

function buildReviewHeatmap(
    startDay: number,
    endDay: number,
    historyRows: readonly RevlogHistoryRow[],
): DailyReviewPoint[] {
    const perDay = new Map<number, { reviews: number; retained: number }>();

    for (const row of historyRows) {
        const timestamp = asFiniteNumber(row.id);
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

function buildHourlyDistribution(historyRows: readonly RevlogHistoryRow[]): HourDistributionPoint[] {
    const counts = Array.from({ length: 24 }, () => 0);

    for (const row of historyRows) {
        const timestamp = asFiniteNumber(row.id);
        const hour = new Date(timestamp).getHours();
        if (hour >= 0 && hour < 24) {
            counts[hour] += 1;
        }
    }

    return counts.map((count, hour) => ({
        hour,
        count,
    }));
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
            const dueDay = Math.floor(asFiniteNumber(card.due) / DAY_MS);
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
            entry.dueToday += 1;
            entry.dueNext7Days += 1;
        } else if (queue === 1) {
            entry.learningCards += 1;

            const dueTimestamp = asFiniteNumber(card.due);
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

function startOfDayMs(value: Date): number {
    const day = new Date(value.getTime());
    day.setHours(0, 0, 0, 0);
    return day.getTime();
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
