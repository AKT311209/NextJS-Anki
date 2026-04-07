import { cn } from "@/lib/utils";

export type ReviewQueueCategory = "learning" | "review" | "new";

export interface ReviewProgressProps {
    readonly counts: {
        readonly learning: number;
        readonly review: number;
        readonly new: number;
    };
    readonly activeCategory?: ReviewQueueCategory | null;
    readonly className?: string;
}

export function ReviewProgress({ counts, activeCategory = null, className }: ReviewProgressProps) {
    return (
        <section className={cn("rounded-xl border border-slate-800 bg-slate-900/60 p-4", className)}>
            <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat
                    category="learning"
                    label="Learning"
                    value={counts.learning}
                    tone="text-amber-300"
                    activeCategory={activeCategory}
                    activeStyles="border-amber-500/60 bg-amber-500/10"
                />
                <Stat
                    category="review"
                    label="Review"
                    value={counts.review}
                    tone="text-emerald-300"
                    activeCategory={activeCategory}
                    activeStyles="border-emerald-500/60 bg-emerald-500/10"
                />
                <Stat
                    category="new"
                    label="New"
                    value={counts.new}
                    tone="text-sky-300"
                    activeCategory={activeCategory}
                    activeStyles="border-sky-500/60 bg-sky-500/10"
                />
            </dl>
        </section>
    );
}

function Stat({
    category,
    label,
    value,
    tone,
    activeCategory,
    activeStyles,
}: {
    readonly category: ReviewQueueCategory;
    readonly label: string;
    readonly value: number;
    readonly tone: string;
    readonly activeCategory: ReviewQueueCategory | null;
    readonly activeStyles: string;
}) {
    const active = activeCategory === category;

    return (
        <div
            data-testid={`review-progress-${category}`}
            data-active={active ? "true" : "false"}
            className={cn(
                "rounded-lg border px-2 py-2 transition-colors",
                active ? activeStyles : "border-slate-800 bg-slate-950/40",
            )}
        >
            <dt className={cn("text-[11px] uppercase tracking-wide", active ? "text-slate-300" : "text-slate-500")}>{label}</dt>
            <dd className={cn("mt-1 text-base font-semibold transition-all", tone, active ? "scale-[1.05]" : "opacity-90")}>{value}</dd>
        </div>
    );
}
