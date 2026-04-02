import type { ForecastPoint } from "@/hooks/use-stats";

export interface ForecastChartProps {
    readonly points: readonly ForecastPoint[];
    readonly windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 14;

export function ForecastChart({
    points,
    windowDays = DEFAULT_WINDOW_DAYS,
}: ForecastChartProps) {
    const visiblePoints = points.slice(0, Math.max(1, windowDays));
    const maxTotal = visiblePoints.reduce((max, point) => Math.max(max, point.total), 0);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Review forecast</h3>
                <p className="text-xs text-slate-400">Next {visiblePoints.length} day(s)</p>
            </header>

            {visiblePoints.length === 0 ? (
                <p className="text-sm text-slate-400">No cards available for forecast.</p>
            ) : (
                <>
                    <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
                        {visiblePoints.map((point) => {
                            const total = Math.max(0, point.total);
                            const learningHeight = stackHeight(point.learning, maxTotal);
                            const reviewHeight = stackHeight(point.review, maxTotal);
                            const newHeight = stackHeight(point.newCards, maxTotal);

                            return (
                                <div
                                    key={point.dayNumber}
                                    title={`${point.dateLabel}: ${total} total (L ${point.learning}, R ${point.review}, N ${point.newCards})`}
                                    className="flex h-full w-4 shrink-0 flex-col justify-end"
                                >
                                    <div
                                        className="w-full rounded-t bg-sky-400/80"
                                        style={{ height: `${newHeight}%` }}
                                    />
                                    <div
                                        className="w-full bg-amber-400/80"
                                        style={{ height: `${learningHeight}%` }}
                                    />
                                    <div
                                        className="w-full bg-violet-400/80"
                                        style={{ height: `${reviewHeight}%` }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <LegendSwatch color="bg-violet-400/80" label="Review" />
                        <LegendSwatch color="bg-amber-400/80" label="Learning" />
                        <LegendSwatch color="bg-sky-400/80" label="New" />
                    </div>
                </>
            )}
        </section>
    );
}

function stackHeight(value: number, maxValue: number): number {
    if (value <= 0 || maxValue <= 0) {
        return 0;
    }

    return Math.max(3, Math.round((value / maxValue) * 100));
}

function LegendSwatch({
    color,
    label,
}: {
    readonly color: string;
    readonly label: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
            {label}
        </span>
    );
}
