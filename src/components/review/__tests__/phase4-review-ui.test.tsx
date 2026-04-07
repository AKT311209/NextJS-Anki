import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnswerButtons } from "@/components/review/AnswerButtons";
import { CardHtml } from "@/components/review/CardHtml";
import { ReviewCard } from "@/components/review/ReviewCard";
import { ReviewProgress } from "@/components/review/ReviewProgress";

describe("Phase 4 review UI", () => {
    it("renders answer buttons with interval previews and emits rating", async () => {
        const onAnswer = vi.fn();
        const user = userEvent.setup();

        render(
            <AnswerButtons
                intervalLabels={{
                    again: "<1m",
                    hard: "<10m",
                    good: "<1d",
                    easy: "4d",
                }}
                onAnswer={onAnswer}
            />,
        );

        await user.click(screen.getByRole("button", { name: /Again/i }));
        await user.click(screen.getByRole("button", { name: /Good/i }));

        expect(onAnswer).toHaveBeenNthCalledWith(1, "again");
        expect(onAnswer).toHaveBeenNthCalledWith(2, "good");
        expect(screen.getByText("(<1d)")).toBeInTheDocument();
    });

    it("shows reveal button only in question mode", async () => {
        const onRevealAnswer = vi.fn();
        const user = userEvent.setup();

        const { rerender } = render(
            <ReviewCard
                questionHtml="<div>Question</div>"
                answerHtml="<div>Answer</div>"
                isAnswerRevealed={false}
                templateName="Basic"
                onRevealAnswer={onRevealAnswer}
            />,
        );

        await user.click(screen.getByRole("button", { name: /Show answer/i }));
        expect(onRevealAnswer).toHaveBeenCalledTimes(1);

        rerender(
            <ReviewCard
                questionHtml="<div>Question</div>"
                answerHtml="<div>Answer</div>"
                isAnswerRevealed
                templateName="Basic"
                onRevealAnswer={onRevealAnswer}
            />,
        );

        expect(screen.queryByRole("button", { name: /Show answer/i })).toBeNull();
    });

    it("renders queue breakdown", () => {
        render(
            <ReviewProgress
                counts={{
                    learning: 1,
                    review: 1,
                    new: 0,
                }}
            />,
        );

        expect(screen.getByText("Learning")).toBeInTheDocument();
        expect(screen.getByText("Review")).toBeInTheDocument();
    });

    it("emphasizes the queue bucket for the current card", () => {
        render(
            <ReviewProgress
                counts={{
                    learning: 0,
                    review: 5,
                    new: 20,
                }}
                activeCategory="review"
            />,
        );

        expect(screen.getByTestId("review-progress-review")).toHaveAttribute("data-active", "true");
        expect(screen.getByTestId("review-progress-review")).toHaveClass("border-emerald-500/60");
        expect(screen.getByTestId("review-progress-learning")).toHaveAttribute("data-active", "false");
        expect(screen.getByTestId("review-progress-new")).toHaveAttribute("data-active", "false");
    });

    it("converts [sound:...] tags into audio players in shadow DOM", () => {
        const { container } = render(
            <CardHtml
                html="Front [sound:https://example.com/audio.mp3] [sound:javascript:alert(1)]"
                autoPlayAudio={false}
            />,
        );

        const host = container.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot;

        expect(shadow).not.toBeNull();
        const audios = shadow?.querySelectorAll("audio") ?? [];
        expect(audios.length).toBe(1);
        expect(audios[0]?.getAttribute("src")).toBe("https://example.com/audio.mp3");
    });

    it("emits audio playback state changes", () => {
        const onAudioPlaybackStateChange = vi.fn();

        const { container, unmount } = render(
            <CardHtml
                html="Front [sound:https://example.com/audio.mp3]"
                autoPlayAudio={false}
                onAudioPlaybackStateChange={onAudioPlaybackStateChange}
            />,
        );

        const host = container.firstElementChild as HTMLElement;
        const audio = host.shadowRoot?.querySelector("audio") as HTMLAudioElement | null;

        expect(audio).not.toBeNull();
        if (!audio) {
            throw new Error("Expected audio element");
        }

        let paused = true;
        let ended = false;

        Object.defineProperty(audio, "paused", {
            configurable: true,
            get: () => paused,
        });
        Object.defineProperty(audio, "ended", {
            configurable: true,
            get: () => ended,
        });

        paused = false;
        fireEvent(audio, new Event("play"));
        expect(onAudioPlaybackStateChange).toHaveBeenLastCalledWith(true);

        paused = true;
        ended = true;
        fireEvent(audio, new Event("ended"));
        expect(onAudioPlaybackStateChange).toHaveBeenLastCalledWith(false);

        unmount();
        expect(onAudioPlaybackStateChange).toHaveBeenLastCalledWith(false);
    });
});
