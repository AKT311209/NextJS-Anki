import { cn } from "@/lib/utils";

export interface ReviewProgressProps {
    readonly answered: number;
    readonly remaining: number;
    readonly counts: {
        readonly learning: number;
        readonly review: number;
        readonly new: number;
    };
    readonly className?: string;
}

export function ReviewProgress({ answered, remaining, counts, className }: ReviewProgressProps) {
    const total = answered + remaining;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 100;

    return (
        <section className={cn("rounded-xl border border-slate-800 bg-slate-900/60 p-4", className)}>
            <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-200">Session progress</h2>
                <p className="text-xs text-slate-400">
                    {answered} / {total} answered ({percent}%)
                </p>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                    className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    aria-hidden
                />
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Learning" value={counts.learning} tone="text-amber-300" />
                <Stat label="Review" value={counts.review} tone="text-emerald-300" />
                <Stat label="New" value={counts.new} tone="text-sky-300" />
            </dl>
        </section>
    );
}

function Stat({ label, value, tone }: { readonly label: string; readonly value: number; readonly tone: string }) {
    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className={cn("mt-1 text-base font-semibold", tone)}>{value}</dd>
        </div>
    );
}
