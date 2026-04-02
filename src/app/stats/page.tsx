"use client";

import Link from "next/link";
import { ForecastChart } from "@/components/stats/ForecastChart";
import { RetentionChart } from "@/components/stats/RetentionChart";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import { useStats, type DeckForecastPoint, type DistributionPoint, type HourDistributionPoint } from "@/hooks/use-stats";

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
                        <p className="text-sm text-slate-400">
                            Review activity, retention trends, forecasts, and deck-level learning health.
                        </p>
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
                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard label="Reviews today" value={formatInt(stats.stats.overview.reviewsToday)} />
                        <StatCard label="Today correct" value={formatPercent(stats.stats.overview.correctRateToday)} />
                        <StatCard label="Due today" value={formatInt(stats.stats.overview.dueToday)} />
                        <StatCard
                            label="Avg answer time"
                            value={`${stats.stats.overview.averageAnswerSecondsToday.toFixed(1)}s`}
                        />
                        <StatCard label="Total cards" value={formatInt(stats.stats.overview.totalCards)} />
                        <StatCard label="Total notes" value={formatInt(stats.stats.overview.totalNotes)} />
                        <StatCard label="Total reviews" value={formatInt(stats.stats.overview.totalReviews)} />
                        <StatCard
                            label="Generated"
                            value={new Date(stats.stats.generatedAt).toLocaleTimeString()}
                        />
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <StatCard label="New" value={formatInt(stats.stats.overview.stateCounts.new)} subtle />
                        <StatCard label="Learning" value={formatInt(stats.stats.overview.stateCounts.learning)} subtle />
                        <StatCard label="Review" value={formatInt(stats.stats.overview.stateCounts.review)} subtle />
                        <StatCard label="Relearning" value={formatInt(stats.stats.overview.stateCounts.relearning)} subtle />
                        <StatCard label="Suspended" value={formatInt(stats.stats.overview.stateCounts.suspended)} subtle />
                        <StatCard label="Buried" value={formatInt(stats.stats.overview.stateCounts.buried)} subtle />
                    </section>

                    <ReviewHeatmap days={stats.stats.reviewHeatmap} />

                    <section className="grid gap-4 xl:grid-cols-2">
                        <RetentionChart points={stats.stats.retention} />
                        <ForecastChart points={stats.stats.forecast} />
                    </section>

                    <section className="grid gap-4 xl:grid-cols-3">
                        <DistributionCard
                            title="Interval distribution"
                            points={stats.stats.intervalDistribution}
                        />
                        <DistributionCard
                            title="Ease factor distribution"
                            points={stats.stats.easeDistribution}
                        />
                        <DistributionCard
                            title="Card maturity"
                            points={stats.stats.maturityBreakdown}
                        />
                    </section>

                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                        <h3 className="text-lg font-semibold text-slate-100">Review hours</h3>
                        <p className="mt-1 text-xs text-slate-400">
                            Hour-of-day distribution from recent review history.
                        </p>
                        <HourChart points={stats.stats.hourlyDistribution} />
                    </section>

                    <section className="grid gap-4 xl:grid-cols-2">
                        <DeckRetentionTable rows={stats.stats.deckRetention} />
                        <DeckForecastTable rows={stats.stats.deckForecast} />
                    </section>

                    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                        <h3 className="text-lg font-semibold text-slate-100">FSRS settings snapshot</h3>
                        {stats.stats.fsrs ? (
                            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                <Info label="Deck" value={stats.stats.fsrs.deckName} />
                                <Info label="Config ID" value={stats.stats.fsrs.configId} />
                                <Info
                                    label="Desired retention"
                                    value={nullableNumber(stats.stats.fsrs.requestRetention, 3)}
                                />
                                <Info
                                    label="Maximum interval"
                                    value={
                                        stats.stats.fsrs.maximumInterval === null
                                            ? "—"
                                            : `${stats.stats.fsrs.maximumInterval}d`
                                    }
                                />
                                <Info
                                    label="Learning steps"
                                    value={formatSteps(stats.stats.fsrs.learningSteps)}
                                />
                                <Info
                                    label="Relearning steps"
                                    value={formatSteps(stats.stats.fsrs.relearningSteps)}
                                />
                                <Info
                                    label="New / day"
                                    value={nullableNumber(stats.stats.fsrs.newPerDay)}
                                />
                                <Info
                                    label="Reviews / day"
                                    value={nullableNumber(stats.stats.fsrs.reviewsPerDay)}
                                />
                                <Info
                                    label="Learning / day"
                                    value={nullableNumber(stats.stats.fsrs.learningPerDay)}
                                />
                                <Info
                                    label="Fuzz"
                                    value={nullableBoolean(stats.stats.fsrs.enableFuzz)}
                                />
                                <Info
                                    label="Bury siblings"
                                    value={nullableBoolean(stats.stats.fsrs.burySiblings)}
                                />
                            </dl>
                        ) : (
                            <p className="mt-3 text-sm text-slate-400">
                                Choose a deck to inspect deck-specific FSRS configuration.
                            </p>
                        )}
                    </section>
                </>
            ) : null}
        </main>
    );
}

function StatCard({
    label,
    value,
    subtle = false,
}: {
    readonly label: string;
    readonly value: string;
    readonly subtle?: boolean;
}) {
    return (
        <article className={`rounded-xl border p-3 ${subtle ? "border-slate-800 bg-slate-900/50" : "border-slate-700 bg-slate-900/70"}`}>
            <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
        </article>
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

function HourChart({ points }: { readonly points: readonly HourDistributionPoint[] }) {
    const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);

    return (
        <div className="mt-3">
            {points.length === 0 ? (
                <p className="text-sm text-slate-400">No hourly activity yet.</p>
            ) : (
                <>
                    <div className="flex h-24 items-end gap-1 overflow-x-auto pb-1">
                        {points.map((point) => {
                            const height = maxCount > 0 ? Math.max(3, Math.round((point.count / maxCount) * 100)) : 0;
                            return (
                                <div
                                    key={point.hour}
                                    title={`${String(point.hour).padStart(2, "0")}:00 — ${point.count} review(s)`}
                                    className="flex w-4 shrink-0 flex-col justify-end"
                                >
                                    <div
                                        className="w-full rounded-t bg-cyan-400/80"
                                        style={{ height: `${height}%` }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px] text-slate-500 sm:grid-cols-12">
                        {points.map((point) => (
                            <span key={`label-${point.hour}`}>{String(point.hour).padStart(2, "0")}</span>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function DeckRetentionTable({ rows }: { readonly rows: readonly { readonly deckId: number; readonly deckName: string; readonly reviews: number; readonly retained: number; readonly rate: number }[] }) {
    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-lg font-semibold text-slate-100">Per-deck retention</h3>
            {rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No review history available.</p>
            ) : (
                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="pb-2 pr-3">Deck</th>
                                <th className="pb-2 pr-3">Reviews</th>
                                <th className="pb-2 pr-3">Retained</th>
                                <th className="pb-2">Rate</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-200">
                            {rows.map((row) => (
                                <tr key={row.deckId} className="border-t border-slate-800">
                                    <td className="py-2 pr-3">{row.deckName}</td>
                                    <td className="py-2 pr-3">{formatInt(row.reviews)}</td>
                                    <td className="py-2 pr-3">{formatInt(row.retained)}</td>
                                    <td className="py-2">{formatPercent(row.rate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function DeckForecastTable({ rows }: { readonly rows: readonly DeckForecastPoint[] }) {
    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-lg font-semibold text-slate-100">Per-deck forecast</h3>
            {rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No cards available.</p>
            ) : (
                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="pb-2 pr-3">Deck</th>
                                <th className="pb-2 pr-3">Due today</th>
                                <th className="pb-2 pr-3">Due 7d</th>
                                <th className="pb-2 pr-3">New</th>
                                <th className="pb-2 pr-3">Learning</th>
                                <th className="pb-2">Review</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-200">
                            {rows.map((row) => (
                                <tr key={row.deckId} className="border-t border-slate-800">
                                    <td className="py-2 pr-3">{row.deckName}</td>
                                    <td className="py-2 pr-3">{formatInt(row.dueToday)}</td>
                                    <td className="py-2 pr-3">{formatInt(row.dueNext7Days)}</td>
                                    <td className="py-2 pr-3">{formatInt(row.newCards)}</td>
                                    <td className="py-2 pr-3">{formatInt(row.learningCards)}</td>
                                    <td className="py-2">{formatInt(row.reviewCards)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function Info({ label, value }: { readonly label: string; readonly value: string | number }) {
    return (
        <>
            <dt className="text-slate-400">{label}</dt>
            <dd className="truncate text-slate-100" title={String(value)}>
                {value}
            </dd>
        </>
    );
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}

function formatPercent(value: number): string {
    return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function nullableNumber(value: number | null, decimals = 0): string {
    if (value === null) {
        return "—";
    }

    return decimals > 0 ? value.toFixed(decimals) : formatInt(value);
}

function nullableBoolean(value: boolean | null): string {
    if (value === null) {
        return "—";
    }
    return value ? "Enabled" : "Disabled";
}

function formatSteps(steps: readonly string[]): string {
    if (steps.length === 0) {
        return "—";
    }
    return steps.join(" ");
}
