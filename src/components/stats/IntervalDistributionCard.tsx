import { useMemo } from "react";
import type { DistributionPoint } from "@/hooks/use-stats";

export interface IntervalDistributionCardProps {
    readonly points: readonly DistributionPoint[];
}

const SVG_WIDTH = 640;
const SVG_HEIGHT = 260;
const MARGIN = {
    left: 42,
    right: 14,
    top: 16,
    bottom: 30,
};

export function IntervalDistributionCard({ points }: IntervalDistributionCardProps) {
    const chart = useMemo(() => {
        const plotWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
        const plotHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;

        const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);
        const totalCards = points.reduce((sum, point) => sum + point.count, 0);

        if (points.length === 0 || maxCount <= 0) {
            return {
                maxCount,
                totalCards,
                linePath: "",
                areaPath: "",
                yTickValues: [] as number[],
                circles: [] as Array<{ label: string; count: number; x: number; y: number }>,
            };
        }

        const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;
        const yBase = MARGIN.top + plotHeight;
        const yForCount = (count: number): number => MARGIN.top + plotHeight - (count / maxCount) * plotHeight;

        const circles = points.map((point, index) => ({
            label: point.label,
            count: point.count,
            x: MARGIN.left + index * xStep,
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
            linePath,
            areaPath,
            yTickValues,
            circles,
        };
    }, [points]);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Interval distribution</h3>
                <p className="text-xs text-slate-400">
                    {chart.totalCards > 0
                        ? `${formatInt(chart.totalCards)} non-new card(s)`
                        : "No interval data"}
                </p>
            </header>

            {points.length === 0 || chart.maxCount === 0 ? (
                <p className="text-sm text-slate-400">No interval data in the selected range.</p>
            ) : (
                <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="min-w-[520px] w-full">
                        {chart.yTickValues.map((tick) => {
                            const plotHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;
                            const y = MARGIN.top + plotHeight - (tick / chart.maxCount) * plotHeight;

                            return (
                                <g key={`interval-y-${tick}`}>
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

                        {chart.circles.map((point) => (
                            <text
                                key={`interval-x-${point.label}`}
                                x={point.x}
                                y={SVG_HEIGHT - 10}
                                textAnchor="middle"
                                fontSize={10}
                                fill="rgba(148, 163, 184, 0.9)"
                            >
                                {point.label}
                            </text>
                        ))}

                        <path d={chart.areaPath} fill="rgba(56, 189, 248, 0.12)" stroke="none" />
                        <path d={chart.linePath} fill="none" stroke="rgba(56, 189, 248, 0.95)" strokeWidth={2} />

                        {chart.circles.map((point) => (
                            <circle
                                key={`interval-point-${point.label}`}
                                cx={point.x}
                                cy={point.y}
                                r={point.count > 0 ? 2.2 : 1.4}
                                fill={point.count > 0 ? "rgba(56, 189, 248, 0.95)" : "rgba(71, 85, 105, 0.45)"}
                            >
                                <title>{`${point.label}: ${formatInt(point.count)} card(s)`}</title>
                            </circle>
                        ))}
                    </svg>
                </div>
            )}
        </section>
    );
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}
