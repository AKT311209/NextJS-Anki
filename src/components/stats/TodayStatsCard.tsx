import type { TodayStats } from "@/hooks/use-stats";

export interface TodayStatsCardProps {
    readonly today: TodayStats;
}

export function TodayStatsCard({ today }: TodayStatsCardProps) {
    const lines = buildTodayLines(today);

    return (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-lg font-semibold text-slate-100">Today</h3>
            <div className="mt-3 space-y-1.5 text-sm text-slate-300">
                {lines.map((line) => (
                    <p key={line}>{line}</p>
                ))}
            </div>
        </section>
    );
}

function buildTodayLines(today: TodayStats): string[] {
    if (today.answerCount <= 0) {
        return ["No cards have been studied today."];
    }

    const totalSeconds = Math.max(0, today.answerMillis / 1000);
    const perCardSeconds = totalSeconds / Math.max(1, today.answerCount);
    const duration =
        totalSeconds < 90
            ? `${Math.round(totalSeconds)} seconds`
            : `${Math.round(totalSeconds / 60)} minutes`;

    const studiedLine = `Studied ${formatInt(today.answerCount)} cards in ${duration} today (${formatSeconds(perCardSeconds)}/card)`;

    const againCount = Math.max(0, today.answerCount - today.correctCount);
    const againRate = today.answerCount > 0 ? againCount / today.answerCount : 0;
    const againLine = `Again count: ${formatInt(againCount)} (${formatPercent(againRate)})`;

    const typeCountsLine = `Learn ${formatInt(today.learnCount)} · Review ${formatInt(today.reviewCount)} · Relearn ${formatInt(today.relearnCount)} · Filtered ${formatInt(today.earlyReviewCount)}`;

    const matureLine =
        today.matureCount > 0
            ? `Correct on mature cards: ${formatInt(today.matureCorrect)}/${formatInt(today.matureCount)} (${formatPercent(today.matureCorrect / today.matureCount)})`
            : "No mature cards reviewed today.";

    return [studiedLine, againLine, typeCountsLine, matureLine];
}

function formatInt(value: number): string {
    return Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}

function formatPercent(value: number): string {
    return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "0s";
    }

    if (seconds >= 10) {
        return `${seconds.toFixed(0)}s`;
    }

    return `${seconds.toFixed(2)}s`;
}
