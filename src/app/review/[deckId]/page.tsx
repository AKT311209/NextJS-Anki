"use client";

import { useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { AnswerButtons } from "@/components/review/AnswerButtons";
import { ReviewCard } from "@/components/review/ReviewCard";
import { ReviewProgress } from "@/components/review/ReviewProgress";
import { ratingShortcutToValue, useReview } from "@/hooks/use-review";

export default function ReviewPage() {
    const params = useParams<{ deckId: string }>();

    const deckId = useMemo(() => parseDeckId(params.deckId), [params.deckId]);
    const review = useReview({ deckId });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) {
                return;
            }
            if (isTypingTarget(event.target)) {
                return;
            }

            const key = event.key;

            if (key === " " || key === "Spacebar") {
                event.preventDefault();
                if (review.stage === "question") {
                    review.revealAnswer();
                    return;
                }
                if (review.stage === "answer") {
                    void review.answer("good");
                }
                return;
            }

            if (review.stage !== "answer") {
                return;
            }

            const rating = ratingShortcutToValue(key);
            if (!rating) {
                return;
            }

            event.preventDefault();
            void review.answer(rating);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [review]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Review</h1>
                <p className="text-sm text-slate-400">
                    {deckId === null
                        ? "Deck not specified — showing due cards across all decks."
                        : `Deck ID ${deckId}`}
                </p>
            </header>

            <ReviewProgress answered={review.answered} remaining={review.remaining} counts={review.counts} />

            {review.loading ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
                    Loading review queue…
                </section>
            ) : null}

            {!review.loading && review.error ? (
                <section className="rounded-xl border border-rose-800/70 bg-rose-950/30 p-4 text-sm text-rose-200">
                    <p className="font-medium">Review session failed to load.</p>
                    <p className="mt-1 text-rose-200/80">{review.error}</p>
                    <button
                        type="button"
                        onClick={() => void review.reload()}
                        className="mt-3 rounded-md border border-rose-700/70 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-100 transition hover:bg-rose-500/20"
                    >
                        Retry
                    </button>
                </section>
            ) : null}

            {!review.loading && !review.error && review.currentCard ? (
                <>
                    <ReviewCard
                        questionHtml={review.currentCard.questionHtml}
                        answerHtml={review.currentCard.answerHtml}
                        css={review.currentCard.css}
                        isAnswerRevealed={review.stage === "answer"}
                        templateName={review.currentCard.templateName}
                        cardOrdinalLabel={`Card #${review.currentCard.card.id}`}
                        onRevealAnswer={review.revealAnswer}
                    />

                    {review.stage === "answer" ? (
                        <AnswerButtons
                            intervalLabels={review.currentCard.intervalLabels}
                            onAnswer={(rating) => void review.answer(rating)}
                        />
                    ) : null}

                    <footer className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="rounded-md border border-slate-700 px-2 py-1">1 Again</span>
                        <span className="rounded-md border border-slate-700 px-2 py-1">2 Hard</span>
                        <span className="rounded-md border border-slate-700 px-2 py-1">3 Good</span>
                        <span className="rounded-md border border-slate-700 px-2 py-1">4 Easy</span>
                        <span className="rounded-md border border-slate-700 px-2 py-1">Space Reveal/Good</span>
                        <button
                            type="button"
                            disabled={!review.canUndo}
                            onClick={() => void review.undo()}
                            className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-slate-300 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                        >
                            Undo last answer
                        </button>
                    </footer>
                </>
            ) : null}

            {!review.loading && !review.error && !review.currentCard ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
                    <h2 className="text-xl font-semibold text-slate-100">All done for now 🎉</h2>
                    <p className="mt-2 text-sm text-slate-400">
                        No cards are currently due right now.
                    </p>

                    <dl className="mx-auto mt-4 grid max-w-md gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-left text-sm">
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-slate-400">Still due today</dt>
                            <dd className="font-semibold text-slate-100">{review.dueLaterToday}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-slate-400">Next card</dt>
                            <dd className="font-semibold text-slate-100">
                                {review.nextCardDueInMinutes === null
                                    ? "No more cards due today"
                                    : `In ${formatMinutes(review.nextCardDueInMinutes)}`}
                            </dd>
                        </div>
                    </dl>

                    <div className="mt-4 flex justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => void review.reload()}
                            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
                        >
                            Refresh queue
                        </button>
                        <button
                            type="button"
                            disabled={!review.canUndo}
                            onClick={() => void review.undo()}
                            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                        >
                            Undo last answer
                        </button>
                    </div>
                </section>
            ) : null}
        </main>
    );
}

function formatMinutes(minutes: number): string {
    if (minutes === 1) {
        return "1 minute";
    }

    return `${minutes} minutes`;
}

function parseDeckId(raw: string | undefined): number | null {
    if (!raw) {
        return null;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
        return null;
    }

    return value;
}

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select";
}
