"use client";

import Link from "next/link";
import { DifficultyDistributionCard } from "@/components/stats/DifficultyDistributionCard";
import { FutureDueCard } from "@/components/stats/FutureDueCard";
import { ReviewHoursCard } from "@/components/stats/ReviewHoursCard";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import { TodayStatsCard } from "@/components/stats/TodayStatsCard";
import { TrueRetentionCard } from "@/components/stats/TrueRetentionCard";
import { useStats, type DistributionPoint } from "@/hooks/use-stats";

export default function StatsPage() {
    const stats = useStats();

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href="/" className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to decks
                </Link>

                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Statistics</h1>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className="inline-flex items-center gap-2 text-slate-300">
                            <span className="text-xs uppercase tracking-wide text-slate-400">Deck</span>
                            <select
                                value={stats.selectedDeckId ?? ""}
                                onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    stats.setSelectedDeckId(value.length > 0 ? Number.parseInt(value, 10) : null);
                                }}
                                className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-sm text-slate-100"
                            >
                                <option value="">All decks</option>
                                {stats.deckOptions.map((deck) => (
                                    <option key={deck.id} value={deck.id}>
                                        {deck.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <button
                            type="button"
                            disabled={stats.loading}
                            onClick={() => {
                                void stats.reload();
                            }}
                            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-50"
                        >
                            {stats.loading ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>
                </div>
            </header>

            {stats.error ? (
                <section className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {stats.error}
                </section>
            ) : null}

            {!stats.stats && stats.loading ? (
                <section className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
                    Crunching review logs…
                </section>
            ) : null}

            {stats.stats ? (
                <>
                    <section className="grid gap-4 xl:grid-cols-3">
                        <TodayStatsCard today={stats.stats.today} />
                        <FutureDueCard futureDue={stats.stats.futureDue} />
                        <TrueRetentionCard retention={stats.stats.trueRetention} />
                    </section>

                    <ReviewHeatmap days={stats.stats.reviewHeatmap} />

                    <section className="grid gap-4 xl:grid-cols-2">
                        <DistributionCard title="Interval distribution" points={stats.stats.intervalDistribution} />
                        <DistributionCard title="Card maturity" points={stats.stats.maturityBreakdown} />
                    </section>

                    <DifficultyDistributionCard points={stats.stats.difficultyDistribution} />

                    <ReviewHoursCard breakdown={stats.stats.hourlyBreakdown} />
                </>
            ) : null}
        </main>
    );
}

function DistributionCard({
    title,
    points,
}: {
    readonly title: string;
    readonly points: readonly DistributionPoint[];
}) {
    const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-lg font-semibold text-slate-100">{title}</h3>

            {points.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No data.</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {points.map((point) => {
                        const width = maxCount > 0 ? (point.count / maxCount) * 100 : 0;

                        return (
                            <li key={point.label} className="space-y-1 text-xs">
                                <div className="flex items-center justify-between text-slate-300">
                                    <span>{point.label}</span>
                                    <span>{formatInt(point.count)}</span>
                                </div>
                                <div className="h-2 rounded bg-slate-800">
                                    <div
                                        className="h-2 rounded bg-sky-400/80"
                                        style={{ width: `${Math.max(width, point.count > 0 ? 3 : 0)}%` }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}
