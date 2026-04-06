"use client";

import { useMemo, useState } from "react";
import type { FutureDueStats } from "@/hooks/use-stats";

type FutureRange = "month" | "threeMonths" | "year" | "all";

export interface FutureDueCardProps {
    readonly futureDue: FutureDueStats;
}

interface Bucket {
    readonly startDay: number;
    readonly endDay: number;
    readonly count: number;
    readonly runningTotal: number;
}

const RANGE_LIMITS: Record<FutureRange, number> = {
    month: 31,
    threeMonths: 90,
    year: 365,
    all: Number.POSITIVE_INFINITY,
};

export function FutureDueCard({ futureDue }: FutureDueCardProps) {
    const [range, setRange] = useState<FutureRange>("month");
    const [includeBacklog, setIncludeBacklog] = useState(true);

    const computed = useMemo(() => {
        const dueByDay = new Map<number, number>();
        for (const point of futureDue.dueByDay) {
            dueByDay.set(point.dayOffset, point.dueCount);
        }

        const minOffsetRaw = futureDue.dueByDay.length > 0
            ? Math.min(...futureDue.dueByDay.map((point) => point.dayOffset))
            : 0;
        const maxOffsetRaw = futureDue.dueByDay.length > 0
            ? Math.max(...futureDue.dueByDay.map((point) => point.dayOffset))
            : 0;

        const maxOffset = Number.isFinite(RANGE_LIMITS[range])
            ? Math.min(maxOffsetRaw, RANGE_LIMITS[range])
            : maxOffsetRaw;
        const minOffset = includeBacklog ? Math.min(0, minOffsetRaw) : 0;

        if (maxOffset < minOffset) {
            return {
                buckets: [] as Bucket[],
                total: 0,
                periodDays: 1,
                dueTomorrow: dueByDay.get(1) ?? 0,
            };
        }

        const spanDays = maxOffset - minOffset + 1;
        const desiredBars = Math.max(1, Math.min(70, spanDays));
        const bucketSize = Math.max(1, Math.ceil(spanDays / desiredBars));

        const buckets: Bucket[] = [];
        let runningTotal = 0;

        for (let startDay = minOffset; startDay <= maxOffset; startDay += bucketSize) {
            const endDay = Math.min(maxOffset, startDay + bucketSize - 1);
            let count = 0;
            for (let day = startDay; day <= endDay; day += 1) {
                count += dueByDay.get(day) ?? 0;
            }

            runningTotal += count;
            buckets.push({
                startDay,
                endDay,
                count,
                runningTotal,
            });
        }

        return {
            buckets,
            total: runningTotal,
            periodDays: spanDays,
            dueTomorrow: dueByDay.get(1) ?? 0,
        };
    }, [futureDue.dueByDay, includeBacklog, range]);

    const maxBucket = computed.buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Future due</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {futureDue.haveBacklog ? (
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="checkbox"
                                checked={includeBacklog}
                                onChange={(event) => {
                                    setIncludeBacklog(event.currentTarget.checked);
                                }}
                            />
                            Include backlog
                        </label>
                    ) : null}

                    <select
                        value={range}
                        onChange={(event) => {
                            setRange(event.currentTarget.value as FutureRange);
                        }}
                        className="rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100"
                    >
                        <option value="month">1 month</option>
                        <option value="threeMonths">3 months</option>
                        <option value="year">1 year</option>
                        <option value="all">All time</option>
                    </select>
                </div>
            </header>

            {computed.buckets.length === 0 ? (
                <p className="text-sm text-slate-400">No cards due in the selected range.</p>
            ) : (
                <>
                    <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
                        {computed.buckets.map((bucket, index) => {
                            const height = maxBucket > 0 ? Math.max(2, Math.round((bucket.count / maxBucket) * 100)) : 0;
                            const ratio = computed.buckets.length > 1 ? index / (computed.buckets.length - 1) : 0;
                            const color = `hsl(145 60% ${Math.round(42 - ratio * 18)}%)`;

                            const label = bucket.startDay === bucket.endDay
                                ? `Day ${bucket.startDay}`
                                : `Day ${bucket.startDay} → ${bucket.endDay}`;

                            return (
                                <div
                                    key={`${bucket.startDay}-${bucket.endDay}`}
                                    title={`${label}: ${formatInt(bucket.count)} due (running total ${formatInt(bucket.runningTotal)})`}
                                    className="flex h-full w-4 shrink-0 flex-col justify-end"
                                >
                                    <div
                                        className="w-full rounded-t"
                                        style={{
                                            height: `${height}%`,
                                            backgroundColor: color,
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <Info label="Total" value={`${formatInt(computed.total)} reviews`} />
                        <Info
                            label="Average"
                            value={`${formatInt(Math.round(computed.total / Math.max(1, computed.periodDays)))} reviews/day`}
                        />
                        <Info label="Due tomorrow" value={`${formatInt(computed.dueTomorrow)} reviews`} />
                        <Info label="Daily load" value={`${formatInt(futureDue.dailyLoad)} reviews/day`} />
                    </dl>
                </>
            )}
        </section>
    );
}

function Info({ label, value }: { readonly label: string; readonly value: string }) {
    return (
        <>
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-slate-100">{value}</dd>
        </>
    );
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}
