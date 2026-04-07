import { useMemo } from "react";
import type { DifficultyDistributionPoint } from "@/hooks/use-stats";

export interface DifficultyDistributionCardProps {
    readonly points: readonly DifficultyDistributionPoint[];
}

const SVG_WIDTH = 640;
const SVG_HEIGHT = 260;
const MARGIN = {
    left: 42,
    right: 14,
    top: 16,
    bottom: 30,
};

export function DifficultyDistributionCard({ points }: DifficultyDistributionCardProps) {
    const chart = useMemo(() => {
        const plotWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
        const plotHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;

        const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);
        const totalCards = points.reduce((sum, point) => sum + point.count, 0);
        const medianPercent = weightedMedianPercent(points);

        if (maxCount <= 0) {
            return {
                maxCount,
                totalCards,
                medianPercent,
                linePath: "",
                areaPath: "",
                yTickValues: [] as number[],
                circles: [] as Array<{ percent: number; count: number; x: number; y: number }>,
            };
        }

        const xForPercent = (percent: number): number => MARGIN.left + (Math.max(0, Math.min(100, percent)) / 100) * plotWidth;
        const yForCount = (count: number): number => MARGIN.top + plotHeight - (count / maxCount) * plotHeight;
        const yBase = MARGIN.top + plotHeight;

        const circles = points.map((point) => ({
            percent: point.percent,
            count: point.count,
            x: xForPercent(point.percent),
            y: yForCount(point.count),
        }));

        const linePath = circles
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
            .join(" ");

        const areaPath = circles.length > 0
            ? [
                `M ${circles[0]?.x.toFixed(2)} ${yBase.toFixed(2)}`,
                ...circles.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
                `L ${circles[circles.length - 1]?.x.toFixed(2)} ${yBase.toFixed(2)}`,
                "Z",
            ].join(" ")
            : "";

        const yTickValues = [...new Set([0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxCount * fraction)))];

        return {
            maxCount,
            totalCards,
            medianPercent,
            linePath,
            areaPath,
            yTickValues,
            circles,
        };
    }, [points]);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Difficulty distribution</h3>
                <p className="text-xs text-slate-400">
                    {chart.totalCards > 0
                        ? `Median ${chart.medianPercent ?? 0}% · ${formatInt(chart.totalCards)} FSRS card(s)`
                        : "No FSRS difficulty data"}
                </p>
            </header>

            {chart.maxCount === 0 ? (
                <p className="text-sm text-slate-400">No FSRS difficulty data in the selected range.</p>
            ) : (
                <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="min-w-[520px] w-full">
                        {chart.yTickValues.map((tick) => {
                            const plotHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;
                            const y = MARGIN.top + plotHeight - (tick / chart.maxCount) * plotHeight;

                            return (
                                <g key={`difficulty-y-${tick}`}>
                                    <line
                                        x1={MARGIN.left}
                                        x2={SVG_WIDTH - MARGIN.right}
                                        y1={y}
                                        y2={y}
                                        stroke="rgba(148, 163, 184, 0.16)"
                                        strokeWidth={1}
                                    />
                                    <text
                                        x={MARGIN.left - 8}
                                        y={y + 3}
                                        textAnchor="end"
                                        fontSize={10}
                                        fill="rgba(148, 163, 184, 0.9)"
                                    >
                                        {formatInt(tick)}
                                    </text>
                                </g>
                            );
                        })}

                        {[0, 25, 50, 75, 100].map((percent) => {
                            const plotWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
                            const x = MARGIN.left + (percent / 100) * plotWidth;

                            return (
                                <text
                                    key={`difficulty-x-${percent}`}
                                    x={x}
                                    y={SVG_HEIGHT - 10}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="rgba(148, 163, 184, 0.9)"
                                >
                                    {percent}%
                                </text>
                            );
                        })}

                        <path d={chart.areaPath} fill="rgba(56, 189, 248, 0.12)" stroke="none" />
                        <path d={chart.linePath} fill="none" stroke="rgba(56, 189, 248, 0.95)" strokeWidth={2} />

                        {chart.circles.map((point) => (
                            <circle
                                key={`difficulty-point-${point.percent}`}
                                cx={point.x}
                                cy={point.y}
                                r={point.count > 0 ? 2.2 : 1.4}
                                fill={point.count > 0 ? "rgba(56, 189, 248, 0.95)" : "rgba(71, 85, 105, 0.45)"}
                            >
                                <title>{`${point.percent}% difficulty: ${formatInt(point.count)} card(s)`}</title>
                            </circle>
                        ))}
                    </svg>
                </div>
            )}
        </section>
    );
}

function weightedMedianPercent(points: readonly DifficultyDistributionPoint[]): number | null {
    const total = points.reduce((sum, point) => sum + point.count, 0);
    if (total <= 0) {
        return null;
    }

    const threshold = total / 2;
    let cumulative = 0;

    for (const point of points) {
        cumulative += point.count;
        if (cumulative >= threshold) {
            return point.percent;
        }
    }

    return points[points.length - 1]?.percent ?? null;
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}
