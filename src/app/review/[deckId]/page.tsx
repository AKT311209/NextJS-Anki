"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnswerButtons } from "@/components/review/AnswerButtons";
import { ReviewCard } from "@/components/review/ReviewCard";
import { ReviewProgress } from "@/components/review/ReviewProgress";
import { ratingShortcutToValue, useReview } from "@/hooks/use-review";

export default function ReviewPage() {
    const params = useParams<{ deckId: string }>();

    const deckId = useMemo(() => parseDeckId(params.deckId), [params.deckId]);
    const review = useReview({ deckId });
    const [cardAudioPlaying, setCardAudioPlaying] = useState(false);
    const [manualAudioPlaying, setManualAudioPlaying] = useState(false);
    const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
    const [questionStartedAtMs, setQuestionStartedAtMs] = useState<number | null>(null);
    const [frozenElapsedMs, setFrozenElapsedMs] = useState<number | null>(null);
    const [autoAdvanceNotice, setAutoAdvanceNotice] = useState<string | null>(null);

    const autoAdvanceNoticeTimerRef = useRef<number | null>(null);
    const previousStageRef = useRef(review.stage);
    const replaySequenceRef = useRef(0);
    const replayAudioElementRef = useRef<HTMLAudioElement | null>(null);
    const audioPlaying = cardAudioPlaying || manualAudioPlaying;
    const audioPlayingRef = useRef(audioPlaying);

    const showAutoAdvanceNotice = useCallback((message: string) => {
        setAutoAdvanceNotice(message);

        if (autoAdvanceNoticeTimerRef.current !== null) {
            window.clearTimeout(autoAdvanceNoticeTimerRef.current);
        }

        autoAdvanceNoticeTimerRef.current = window.setTimeout(() => {
            setAutoAdvanceNotice(null);
        }, 2500);
    }, []);

    const stopReplayAudio = useCallback(() => {
        replaySequenceRef.current += 1;
        const activeAudio = replayAudioElementRef.current;
        if (activeAudio) {
            activeAudio.pause();
            replayAudioElementRef.current = null;
        }
        setManualAudioPlaying(false);
    }, []);

    const replayAudio = useCallback(async () => {
        if (!review.currentCard) {
            return;
        }

        const sources = replayAudioSources(
            review.currentCard.audioTags,
            review.stage,
            review.config.skipQuestionWhenReplayingAnswer,
        );

        if (sources.length === 0) {
            return;
        }

        stopReplayAudio();
        const sequence = replaySequenceRef.current;
        setManualAudioPlaying(true);

        for (const source of sources) {
            if (sequence !== replaySequenceRef.current) {
                break;
            }

            await playAudioSource(source, replayAudioElementRef, replaySequenceRef, sequence);
        }

        if (sequence === replaySequenceRef.current) {
            replayAudioElementRef.current = null;
            setManualAudioPlaying(false);
        }
    }, [
        review.config.skipQuestionWhenReplayingAnswer,
        review.currentCard,
        review.stage,
        stopReplayAudio,
    ]);

    const elapsedTimerMs = useMemo(() => {
        if (!review.config.showTimer || questionStartedAtMs === null) {
            return 0;
        }

        if (review.stage === "answer" && review.config.stopTimerOnAnswer && frozenElapsedMs !== null) {
            return Math.max(0, frozenElapsedMs);
        }

        return Math.max(0, timerNowMs - questionStartedAtMs);
    }, [
        frozenElapsedMs,
        questionStartedAtMs,
        review.config.showTimer,
        review.config.stopTimerOnAnswer,
        review.stage,
        timerNowMs,
    ]);

    useEffect(() => {
        audioPlayingRef.current = audioPlaying;
    }, [audioPlaying]);

    useEffect(() => {
        if (autoAdvanceNoticeTimerRef.current !== null) {
            window.clearTimeout(autoAdvanceNoticeTimerRef.current);
        }

        return () => {
            if (autoAdvanceNoticeTimerRef.current !== null) {
                window.clearTimeout(autoAdvanceNoticeTimerRef.current);
            }
            stopReplayAudio();
        };
    }, [stopReplayAudio]);

    useEffect(() => {
        if (!review.currentCard || review.stage !== "question") {
            return;
        }

        queueMicrotask(() => {
            setQuestionStartedAtMs(Date.now());
            setFrozenElapsedMs(null);
        });
    }, [review.currentCard, review.currentCard?.card.id, review.stage]);

    useEffect(() => {
        if (
            review.stage === "answer" &&
            previousStageRef.current === "question" &&
            review.config.stopTimerOnAnswer &&
            questionStartedAtMs !== null
        ) {
            const frozenElapsed = Math.max(0, Date.now() - questionStartedAtMs);
            queueMicrotask(() => {
                setFrozenElapsedMs(frozenElapsed);
            });
        }

        previousStageRef.current = review.stage;
    }, [questionStartedAtMs, review.config.stopTimerOnAnswer, review.stage]);

    useEffect(() => {
        if (!review.config.showTimer) {
            return;
        }

        const timerId = window.setInterval(() => {
            setTimerNowMs(Date.now());
        }, 250);

        return () => {
            window.clearInterval(timerId);
        };
    }, [review.config.showTimer]);

    useEffect(() => {
        if (!review.currentCard) {
            return;
        }

        const delaySeconds = review.stage === "question"
            ? review.config.secondsToShowQuestion
            : review.stage === "answer"
                ? review.config.secondsToShowAnswer
                : 0;

        if (delaySeconds <= 0) {
            return;
        }

        const delayMs = Math.max(0, Math.trunc(delaySeconds * 1000));
        const deadline = Date.now() + delayMs;
        let timeoutId: number | null = null;
        let cancelled = false;
        let actionTriggered = false;

        const runQuestionAction = () => {
            if (review.config.questionAction === "show-reminder") {
                showAutoAdvanceNotice("Question timer reached — reminder shown.");
                return;
            }

            review.revealAnswer();
        };

        const runAnswerAction = async () => {
            switch (review.config.answerAction) {
                case "answer-again":
                    await review.answer("again");
                    return;
                case "answer-hard":
                    await review.answer("hard");
                    return;
                case "answer-good":
                    await review.answer("good");
                    return;
                case "show-reminder":
                    showAutoAdvanceNotice("Answer timer reached — reminder shown.");
                    return;
                default:
                    await review.buryCurrentCard();
            }
        };

        const tick = () => {
            if (cancelled || actionTriggered) {
                return;
            }

            const now = Date.now();
            if (now < deadline) {
                timeoutId = window.setTimeout(tick, Math.min(250, deadline - now));
                return;
            }

            if (review.config.waitForAudio && audioPlayingRef.current) {
                timeoutId = window.setTimeout(tick, 200);
                return;
            }

            if (typeof document !== "undefined" && !document.hasFocus()) {
                actionTriggered = true;
                return;
            }

            actionTriggered = true;

            if (review.stage === "question") {
                runQuestionAction();
                return;
            }

            if (review.stage === "answer") {
                void runAnswerAction();
            }
        };

        timeoutId = window.setTimeout(tick, Math.min(250, delayMs));

        return () => {
            cancelled = true;
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [review, showAutoAdvanceNotice]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) {
                return;
            }
            if (isTypingTarget(event.target)) {
                return;
            }

            const key = event.key;

            if (key === "r" || key === "R") {
                event.preventDefault();
                void replayAudio();
                return;
            }

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
    }, [replayAudio, review]);

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
            <header className="space-y-2">
                <Link
                    href="/"
                    className="text-sm text-slate-400 transition hover:text-slate-200"
                >
                    &larr; Back to decks
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">Review</h1>
                <p className="text-sm text-slate-400">
                    {deckId === null
                        ? "Deck not specified — showing due cards across all decks."
                        : `Deck ID ${deckId}`}
                </p>
            </header>

            <ReviewProgress counts={review.counts} />

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
                    {autoAdvanceNotice ? (
                        <section className="rounded-lg border border-amber-700/70 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                            {autoAdvanceNotice}
                        </section>
                    ) : null}

                    <ReviewCard
                        questionHtml={review.currentCard.questionHtml}
                        answerHtml={review.currentCard.answerHtml}
                        css={review.currentCard.css}
                        isAnswerRevealed={review.stage === "answer"}
                        templateName={review.currentCard.templateName}
                        cardOrdinalLabel={`Card #${review.currentCard.card.id}`}
                        onRevealAnswer={review.revealAnswer}
                        autoPlayAudio={!review.config.disableAutoplay}
                        onAudioPlaybackStateChange={setCardAudioPlaying}
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
                        <span className="rounded-md border border-slate-700 px-2 py-1">R Replay audio</span>
                        <span className="rounded-md border border-slate-700 px-2 py-1">Space Reveal/Good</span>
                        {review.config.showTimer ? (
                            <span className="rounded-md border border-slate-700 px-2 py-1 font-medium text-slate-200">
                                Timer {formatTimer(elapsedTimerMs)}
                            </span>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => void replayAudio()}
                            disabled={replayAudioSources(
                                review.currentCard.audioTags,
                                review.stage,
                                review.config.skipQuestionWhenReplayingAnswer,
                            ).length === 0}
                            className="rounded-md border border-slate-700 px-2 py-1 text-slate-300 transition enabled:hover:bg-slate-800 disabled:opacity-40"
                        >
                            Replay audio
                        </button>
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

function replayAudioSources(
    tags: {
        readonly question: readonly string[];
        readonly answer: readonly string[];
    },
    stage: "idle" | "loading" | "question" | "answer" | "completed" | "error",
    skipQuestionWhenReplayingAnswer: boolean,
): string[] {
    if (stage === "question") {
        return [...tags.question];
    }

    if (stage === "answer") {
        if (skipQuestionWhenReplayingAnswer) {
            return [...tags.answer];
        }

        return [...tags.question, ...tags.answer];
    }

    return [];
}

async function playAudioSource(
    source: string,
    replayAudioElementRef: MutableRefObject<HTMLAudioElement | null>,
    replaySequenceRef: MutableRefObject<number>,
    sequence: number,
): Promise<void> {
    await new Promise<void>((resolve) => {
        const audio = new Audio(source);
        replayAudioElementRef.current = audio;

        const finish = () => {
            audio.removeEventListener("ended", finish);
            audio.removeEventListener("error", finish);
            audio.removeEventListener("abort", finish);
            audio.removeEventListener("pause", onPause);
            resolve();
        };

        const onPause = () => {
            if (sequence !== replaySequenceRef.current) {
                finish();
            }
        };

        audio.addEventListener("ended", finish);
        audio.addEventListener("error", finish);
        audio.addEventListener("abort", finish);
        audio.addEventListener("pause", onPause);

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {
                finish();
            });
        }
    });
}

function formatTimer(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`;
    }

    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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
