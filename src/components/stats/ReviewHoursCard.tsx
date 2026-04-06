"use client";

import { useMemo, useState } from "react";
import type { HourlyBreakdown, HourlyBreakdownPoint } from "@/hooks/use-stats";

type RangeKey = "month" | "threeMonths" | "year" | "allTime";

export interface ReviewHoursCardProps {
    readonly breakdown: HourlyBreakdown;
}

const RANGE_TO_SERIES: Record<RangeKey, keyof HourlyBreakdown> = {
    month: "oneMonth",
    threeMonths: "threeMonths",
    year: "oneYear",
    allTime: "allTime",
};

const RANGE_LABELS: Record<RangeKey, string> = {
    month: "1 month",
    threeMonths: "3 months",
    year: "1 year",
    allTime: "All time",
};

const SVG_WIDTH = 900;
const SVG_HEIGHT = 280;
const MARGIN = {
    left: 52,
    right: 46,
    top: 18,
    bottom: 34,
};

export function ReviewHoursCard({ breakdown }: ReviewHoursCardProps) {
    const [range, setRange] = useState<RangeKey>("year");

    const points = breakdown[RANGE_TO_SERIES[range]];

    const {
        maxTotal,
        leftAxisTicks,
        totalAreaPath,
        ratioOverlayPath,
        bars,
    } = useMemo(() => {
        const plotWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
        const plotHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;
        const step = plotWidth / 24;
        const barWidth = Math.max(4, step * 0.72);

        const maxTotalRaw = points.reduce((max, point) => Math.max(max, point.total), 0);
        const maxTotal = Math.max(1, maxTotalRaw);

        const xCenter = (hour: number): number => MARGIN.left + hour * step + step / 2;
        const xBar = (hour: number): number => xCenter(hour) - barWidth / 2;
        const yForCount = (count: number): number => MARGIN.top + plotHeight - (count / maxTotal) * plotHeight;
        const yForRatio = (ratio: number): number => MARGIN.top + plotHeight - ratio * plotHeight;
        const yBase = MARGIN.top + plotHeight;

        const bars = points.map((point) => ({
            point,
            x: xBar(point.hour),
            y: yForCount(point.total),
            width: barWidth,
            height: Math.max(0, yBase - yForCount(point.total)),
            ratio: point.total > 0 ? point.correct / point.total : 0,
        }));

        const ratioPoints = points.map((point) => ({
            x: xCenter(point.hour),
            y: yForRatio(point.total > 0 ? point.correct / point.total : 0),
        }));

        const ratioOverlayPath = ratioPoints
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
            .join(" ");

        const totalAreaPath =
            ratioPoints.length === 0
                ? ""
                : [
                    `M ${ratioPoints[0]?.x.toFixed(2)} ${yBase.toFixed(2)}`,
                    ...ratioPoints.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
                    `L ${ratioPoints[ratioPoints.length - 1]?.x.toFixed(2)} ${yBase.toFixed(2)}`,
                    "Z",
                ].join(" ");

        const leftAxisTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = Math.round(maxTotal * fraction);
            const y = yForCount(value);
            return {
                value,
                y,
            };
        });

        return {
            maxTotal: maxTotalRaw,
            leftAxisTicks,
            totalAreaPath,
            ratioOverlayPath,
            bars,
        };
    }, [points]);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-lg font-semibold text-slate-100">Review hours</h3>
                    <p className="text-xs text-slate-400">Review count by hour with correct-answer percentage overlay.</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => {
                        const active = key === range;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => {
                                    setRange(key);
                                }}
                                className={`rounded border px-2 py-1 transition ${active
                                    ? "border-sky-500 bg-sky-500/20 text-sky-200"
                                    : "border-slate-700 text-slate-300 hover:bg-slate-800"
                                    }`}
                            >
                                {RANGE_LABELS[key]}
                            </button>
                        );
                    })}
                </div>
            </header>

            {maxTotal === 0 ? (
                <p className="text-sm text-slate-400">No review activity in the selected range.</p>
            ) : (
                <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="min-w-[760px] w-full">
                        <g>
                            {leftAxisTicks.map((tick, index) => (
                                <g key={`left-${index}`}>
                                    <line
                                        x1={MARGIN.left}
                                        x2={SVG_WIDTH - MARGIN.right}
                                        y1={tick.y}
                                        y2={tick.y}
                                        stroke="rgba(148, 163, 184, 0.16)"
                                        strokeWidth={1}
                                    />
                                    <text
                                        x={MARGIN.left - 8}
                                        y={tick.y + 3}
                                        textAnchor="end"
                                        fontSize={10}
                                        fill="rgba(148, 163, 184, 0.9)"
                                    >
                                        {formatInt(tick.value)}
                                    </text>
                                </g>
                            ))}

                            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                                const y = MARGIN.top + (1 - ratio) * (SVG_HEIGHT - MARGIN.top - MARGIN.bottom);
                                return (
                                    <text
                                        key={`right-${ratio}`}
                                        x={SVG_WIDTH - MARGIN.right + 8}
                                        y={y + 3}
                                        textAnchor="start"
                                        fontSize={10}
                                        fill="rgba(125, 211, 252, 0.9)"
                                    >
                                        {Math.round(ratio * 100)}%
                                    </text>
                                );
                            })}

                            <path d={totalAreaPath} fill="rgba(56, 189, 248, 0.12)" stroke="none" />
                            <path d={ratioOverlayPath} fill="none" stroke="rgba(56, 189, 248, 0.95)" strokeWidth={2} />

                            {bars.map((bar) => (
                                <g key={`bar-${bar.point.hour}`}>
                                    <rect
                                        x={bar.x}
                                        y={bar.y}
                                        width={bar.width}
                                        height={bar.height}
                                        rx={1.5}
                                        fill={barColor(bar.point.total, maxTotal)}
                                    >
                                        <title>{hourTooltip(bar.point)}</title>
                                    </rect>
                                </g>
                            ))}

                            {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => {
                                const plotWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
                                const step = plotWidth / 24;
                                const x = MARGIN.left + hour * step + step / 2;
                                return (
                                    <text
                                        key={`hour-${hour}`}
                                        x={x}
                                        y={SVG_HEIGHT - 10}
                                        textAnchor="middle"
                                        fontSize={9}
                                        fill={hour % 2 === 0 ? "rgba(148, 163, 184, 0.9)" : "rgba(148, 163, 184, 0.55)"}
                                    >
                                        {String(hour).padStart(2, "0")}
                                    </text>
                                );
                            })}
                        </g>
                    </svg>
                </div>
            )}
        </section>
    );
}

function barColor(value: number, max: number): string {
    const ratio = max > 0 ? value / max : 0;
    const lightness = 26 + ratio * 32;
    return `hsl(210 85% ${lightness.toFixed(1)}%)`;
}

function hourTooltip(point: HourlyBreakdownPoint): string {
    const start = point.hour;
    const end = (point.hour + 1) % 24;
    const rate = point.total > 0 ? (point.correct / point.total) * 100 : 0;

    return `${String(start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00\n${formatInt(point.total)} reviews\n${rate.toFixed(1)}% correct (${formatInt(point.correct)} correct)`;
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}
