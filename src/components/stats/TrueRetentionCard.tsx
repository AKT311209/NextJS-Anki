"use client";

import { useState } from "react";
import type { TrueRetentionPeriod, TrueRetentionStats } from "@/hooks/use-stats";

type RetentionMode = "young" | "mature" | "all" | "summary";

export interface TrueRetentionCardProps {
    readonly retention: TrueRetentionStats;
}

interface RetentionRow {
    readonly label: string;
    readonly period: TrueRetentionPeriod;
}

export function TrueRetentionCard({ retention }: TrueRetentionCardProps) {
    const [mode, setMode] = useState<RetentionMode>("summary");

    const rows: readonly RetentionRow[] = [
        { label: "Today", period: retention.today },
        { label: "Yesterday", period: retention.yesterday },
        { label: "Week", period: retention.week },
        { label: "Month", period: retention.month },
        { label: "Year", period: retention.year },
        { label: "All time", period: retention.allTime },
    ];

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-100">True retention</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <ModeButton current={mode} value="young" onSelect={setMode}>
                        Young
                    </ModeButton>
                    <ModeButton current={mode} value="mature" onSelect={setMode}>
                        Mature
                    </ModeButton>
                    <ModeButton current={mode} value="all" onSelect={setMode}>
                        All
                    </ModeButton>
                    <ModeButton current={mode} value="summary" onSelect={setMode}>
                        Summary
                    </ModeButton>
                </div>
            </header>

            {mode === "summary" ? (
                <SummaryTable rows={rows} />
            ) : (
                <SingleScopeTable rows={rows} mode={mode} />
            )}
        </section>
    );
}

function SummaryTable({ rows }: { readonly rows: readonly RetentionRow[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                        <th className="pb-2 pr-3">Period</th>
                        <th className="pb-2 pr-3 text-right">Young</th>
                        <th className="pb-2 pr-3 text-right">Mature</th>
                        <th className="pb-2 pr-3 text-right">Total</th>
                        <th className="pb-2 text-right">Count</th>
                    </tr>
                </thead>
                <tbody className="text-slate-200">
                    {rows.map((row) => {
                        const youngPassed = row.period.youngPassed;
                        const youngFailed = row.period.youngFailed;
                        const maturePassed = row.period.maturePassed;
                        const matureFailed = row.period.matureFailed;
                        const totalPassed = youngPassed + maturePassed;
                        const totalFailed = youngFailed + matureFailed;
                        const totalCount = totalPassed + totalFailed;

                        return (
                            <tr key={row.label} className="border-t border-slate-800">
                                <th className="py-2 pr-3 text-left font-medium">{row.label}</th>
                                <td className="py-2 pr-3 text-right text-emerald-300">
                                    {formatRate(youngPassed, youngFailed)}
                                </td>
                                <td className="py-2 pr-3 text-right text-emerald-400">
                                    {formatRate(maturePassed, matureFailed)}
                                </td>
                                <td className="py-2 pr-3 text-right">
                                    {formatRate(totalPassed, totalFailed)}
                                </td>
                                <td className="py-2 text-right text-slate-400">{formatInt(totalCount)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function SingleScopeTable({
    rows,
    mode,
}: {
    readonly rows: readonly RetentionRow[];
    readonly mode: Exclude<RetentionMode, "summary">;
}) {
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                        <th className="pb-2 pr-3">Period</th>
                        <th className="pb-2 pr-3 text-right">Pass</th>
                        <th className="pb-2 pr-3 text-right">Fail</th>
                        <th className="pb-2 text-right">Retention</th>
                    </tr>
                </thead>
                <tbody className="text-slate-200">
                    {rows.map((row) => {
                        const [passed, failed] = passFailForMode(row.period, mode);

                        return (
                            <tr key={row.label} className="border-t border-slate-800">
                                <th className="py-2 pr-3 text-left font-medium">{row.label}</th>
                                <td className="py-2 pr-3 text-right text-emerald-400">{formatInt(passed)}</td>
                                <td className="py-2 pr-3 text-right text-rose-400">{formatInt(failed)}</td>
                                <td className="py-2 text-right">{formatRate(passed, failed)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function passFailForMode(
    period: TrueRetentionPeriod,
    mode: Exclude<RetentionMode, "summary">,
): [number, number] {
    if (mode === "young") {
        return [period.youngPassed, period.youngFailed];
    }

    if (mode === "mature") {
        return [period.maturePassed, period.matureFailed];
    }

    return [
        period.youngPassed + period.maturePassed,
        period.youngFailed + period.matureFailed,
    ];
}

function formatRate(passed: number, failed: number): string {
    const total = passed + failed;
    if (total <= 0) {
        return "N/A";
    }

    return `${((passed / total) * 100).toFixed(1)}%`;
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}

function ModeButton({
    current,
    value,
    onSelect,
    children,
}: {
    readonly current: RetentionMode;
    readonly value: RetentionMode;
    readonly onSelect: (value: RetentionMode) => void;
    readonly children: string;
}) {
    const active = current === value;

    return (
        <button
            type="button"
            onClick={() => onSelect(value)}
            className={`rounded border px-2 py-1 transition ${active
                ? "border-sky-500 bg-sky-500/20 text-sky-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
        >
            {children}
        </button>
    );
}
