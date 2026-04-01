"use client";

import { CardHtml } from "@/components/review/CardHtml";
import { cn } from "@/lib/utils";

export interface ReviewCardProps {
    readonly questionHtml: string;
    readonly answerHtml: string;
    readonly css?: string;
    readonly isAnswerRevealed: boolean;
    readonly templateName?: string;
    readonly cardOrdinalLabel?: string;
    readonly onRevealAnswer?: () => void;
    readonly className?: string;
}

export function ReviewCard({
    questionHtml,
    answerHtml,
    css,
    isAnswerRevealed,
    templateName,
    cardOrdinalLabel,
    onRevealAnswer,
    className,
}: ReviewCardProps) {
    return (
        <section
            className={cn(
                "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/20 sm:p-6",
                className,
            )}
        >
            <header className="mb-4 flex items-center justify-between gap-4 border-b border-slate-800 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {isAnswerRevealed ? "Answer" : "Question"}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    {templateName ? <span>{templateName}</span> : null}
                    {cardOrdinalLabel ? <span>• {cardOrdinalLabel}</span> : null}
                </div>
            </header>

            <CardHtml html={isAnswerRevealed ? answerHtml : questionHtml} css={css} className="min-h-44" nightMode />

            {!isAnswerRevealed ? (
                <footer className="mt-6 flex justify-center">
                    <button
                        type="button"
                        onClick={onRevealAnswer}
                        className="inline-flex items-center rounded-lg border border-sky-700/60 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
                    >
                        Show answer <span className="ml-2 text-xs text-sky-200/70">(Space)</span>
                    </button>
                </footer>
            ) : null}
        </section>
    );
}
