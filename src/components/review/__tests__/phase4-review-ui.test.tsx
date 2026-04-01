import { render, screen } from "@testing-library/react";
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

    it("renders progress percentage and queue breakdown", () => {
        render(
            <ReviewProgress
                answered={3}
                remaining={2}
                counts={{
                    learning: 1,
                    review: 1,
                    new: 0,
                }}
            />,
        );

        expect(screen.getByText(/3 \/ 5 answered/i)).toBeInTheDocument();
        expect(screen.getByText("Learning")).toBeInTheDocument();
        expect(screen.getByText("Review")).toBeInTheDocument();
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
});
