import type { DailyReviewPoint } from "@/hooks/use-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

const HEAT_LEVEL_CLASSES = [
    "bg-slate-900/80 border-slate-700",
    "bg-emerald-950/70 border-emerald-900",
    "bg-emerald-800/70 border-emerald-700",
    "bg-emerald-600/70 border-emerald-500",
    "bg-emerald-400/80 border-emerald-300",
] as const;

export interface ReviewHeatmapProps {
    readonly days: readonly DailyReviewPoint[];
}

export function ReviewHeatmap({ days }: ReviewHeatmapProps) {
    const maxReviews = days.reduce((max, point) => Math.max(max, point.reviews), 0);
    const firstDay = days[0] ?? null;

    const leadingPadding = firstDay
        ? new Date(firstDay.dayNumber * DAY_MS).getDay()
        : 0;

    const cells: Array<DailyReviewPoint | null> = [
        ...Array.from({ length: leadingPadding }, () => null),
        ...days,
    ];

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Review heatmap</h3>
                <p className="text-xs text-slate-400">Last {days.length} day(s)</p>
            </header>

            {days.length === 0 ? (
                <p className="text-sm text-slate-400">No review activity yet.</p>
            ) : (
                <>
                    <div className="overflow-x-auto pb-2">
                        <div className="grid grid-flow-col auto-cols-[0.72rem] grid-rows-7 gap-1">
                            {cells.map((point, index) => {
                                if (!point) {
                                    return (
                                        <div
                                            key={`blank-${index}`}
                                            className="h-3 w-3 rounded-[3px] border border-slate-800/50 bg-transparent"
                                        />
                                    );
                                }

                                const level = intensityLevel(point.reviews, maxReviews);

                                return (
                                    <div
                                        key={point.dayNumber}
                                        title={`${point.dateLabel}: ${point.reviews} review(s), ${(point.correctRate * 100).toFixed(0)}% correct`}
                                        className={`h-3 w-3 rounded-[3px] border ${HEAT_LEVEL_CLASSES[level]}`}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span>Less</span>
                        <div className="flex items-center gap-1">
                            {HEAT_LEVEL_CLASSES.map((className) => (
                                <span
                                    key={className}
                                    className={`h-3 w-3 rounded-[3px] border ${className}`}
                                />
                            ))}
                        </div>
                        <span>More</span>
                    </div>
                </>
            )}
        </section>
    );
}

function intensityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
    if (value <= 0 || max <= 0) {
        return 0;
    }

    const normalized = value / max;
    if (normalized < 0.25) {
        return 1;
    }
    if (normalized < 0.5) {
        return 2;
    }
    if (normalized < 0.75) {
        return 3;
    }
    return 4;
}
