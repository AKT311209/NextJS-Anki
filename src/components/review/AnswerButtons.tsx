"use client";

import type { ReviewRating } from "@/lib/types/scheduler";
import { cn } from "@/lib/utils";

export interface AnswerButtonsProps {
    readonly intervalLabels: Record<ReviewRating, string>;
    readonly onAnswer: (rating: ReviewRating) => void;
    readonly disabled?: boolean;
    readonly className?: string;
}

const BUTTONS: ReadonlyArray<{
    readonly rating: ReviewRating;
    readonly label: string;
    readonly shortcut: string;
    readonly className: string;
}> = [
    {
        rating: "again",
        label: "Again",
        shortcut: "1",
        className: "border-rose-700/70 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
    },
    {
        rating: "hard",
        label: "Hard",
        shortcut: "2",
        className: "border-amber-700/70 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25",
    },
    {
        rating: "good",
        label: "Good",
        shortcut: "3 / Space",
        className: "border-emerald-700/70 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
    },
    {
        rating: "easy",
        label: "Easy",
        shortcut: "4",
        className: "border-blue-700/70 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25",
    },
] as const;

export function AnswerButtons({ intervalLabels, onAnswer, disabled = false, className }: AnswerButtonsProps) {
    return (
        <div className={cn("grid gap-2 sm:grid-cols-4", className)}>
            {BUTTONS.map((button) => {
                const interval = intervalLabels[button.rating] ?? "?";

                return (
                    <button
                        key={button.rating}
                        type="button"
                        disabled={disabled}
                        onClick={() => onAnswer(button.rating)}
                        className={cn(
                            "rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                            button.className,
                        )}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{button.label}</span>
                            <span className="text-xs opacity-80">{button.shortcut}</span>
                        </div>
                        <p className="mt-1 text-sm opacity-90">({interval})</p>
                    </button>
                );
            })}
        </div>
    );
}
