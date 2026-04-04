import { cn } from "@/lib/utils";

export interface ReviewProgressProps {
    readonly counts: {
        readonly learning: number;
        readonly review: number;
        readonly new: number;
    };
    readonly className?: string;
}

export function ReviewProgress({ counts, className }: ReviewProgressProps) {
    return (
        <section className={cn("rounded-xl border border-slate-800 bg-slate-900/60 p-4", className)}>
            <dl className="grid grid-cols-3 gap-2 text-center">
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
