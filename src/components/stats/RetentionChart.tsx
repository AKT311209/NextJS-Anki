import type { RetentionPoint } from "@/hooks/use-stats";

export interface RetentionChartProps {
    readonly points: readonly RetentionPoint[];
}

export function RetentionChart({ points }: RetentionChartProps) {
    const averageRetention =
        points.length > 0
            ? points.reduce((sum, point) => sum + point.rate, 0) / points.length
            : 0;

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Retention trend</h3>
                <p className="text-xs text-slate-400">
                    Avg {formatPercent(averageRetention)}
                </p>
            </header>

            {points.length === 0 ? (
                <p className="text-sm text-slate-400">Not enough reviews to plot retention.</p>
            ) : (
                <>
                    <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1">
                        {points.map((point) => {
                            const barHeight = Math.max(6, Math.round(point.rate * 100));

                            return (
                                <div
                                    key={point.dayNumber}
                                    title={`${point.dateLabel}: ${formatPercent(point.rate)} (${point.retained}/${point.reviews})`}
                                    className="flex w-3 shrink-0 flex-col justify-end"
                                >
                                    <div
                                        className="w-full rounded-t bg-emerald-500/80"
                                        style={{ height: `${barHeight}%` }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <footer className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span>{points[0]?.dateLabel}</span>
                        <span>{points[points.length - 1]?.dateLabel}</span>
                    </footer>
                </>
            )}
        </section>
    );
}

function formatPercent(value: number): string {
    return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}
