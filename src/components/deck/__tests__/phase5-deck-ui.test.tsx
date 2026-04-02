import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeckList } from "@/components/deck/DeckList";

describe("Phase 5 deck UI", () => {
    it("creates a root deck and triggers child actions", async () => {
        const user = userEvent.setup();

        const onCreateRootDeck = vi.fn(async () => { });
        const onToggleCollapse = vi.fn();
        const onCreateChild = vi.fn();
        const onRename = vi.fn();
        const onMove = vi.fn();
        const onDelete = vi.fn();

        render(
            <DeckList
                nodes={[
                    {
                        depth: 0,
                        deck: {
                            id: 1,
                            name: "Default",
                            conf: 1,
                            counts: {
                                total: 2,
                                dueToday: 1,
                                newCount: 1,
                                learningCount: 0,
                                reviewCount: 1,
                            },
                        },
                        children: [],
                    },
                ]}
                loading={false}
                error={null}
                onCreateRootDeck={onCreateRootDeck}
                onToggleCollapse={onToggleCollapse}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
            />,
        );

        await user.type(screen.getByPlaceholderText(/new root deck/i), "Languages");
        await user.click(screen.getByRole("button", { name: /create deck/i }));
        expect(onCreateRootDeck).toHaveBeenCalledWith("Languages");

        await user.click(screen.getByRole("button", { name: /add child/i }));
        await user.click(screen.getByRole("button", { name: /rename/i }));
        await user.click(screen.getByRole("button", { name: /move/i }));
        await user.click(screen.getByRole("button", { name: /delete/i }));

        expect(onCreateChild).toHaveBeenCalledWith(1);
        expect(onRename).toHaveBeenCalledWith(1);
        expect(onMove).toHaveBeenCalledWith(1);
        expect(onDelete).toHaveBeenCalledWith(1);
    });
});
