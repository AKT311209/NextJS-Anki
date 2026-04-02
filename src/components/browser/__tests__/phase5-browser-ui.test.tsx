import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardTable } from "@/components/browser/CardTable";
import { SearchBar } from "@/components/browser/SearchBar";

describe("Phase 5 browser UI", () => {
    it("submits query from search bar", async () => {
        const user = userEvent.setup();
        const onQueryChange = vi.fn();
        const onSubmit = vi.fn();

        render(
            <SearchBar query="" loading={false} onQueryChange={onQueryChange} onSubmit={onSubmit} />,
        );

        const input = screen.getByPlaceholderText(/search cards/i);
        await user.type(input, "deck:default");
        await user.click(screen.getByRole("button", { name: /search/i }));

        expect(onQueryChange).toHaveBeenCalled();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("supports selecting rows and sorting columns", async () => {
        const user = userEvent.setup();
        const onToggleSelect = vi.fn();
        const onToggleSelectAll = vi.fn();
        const onSortChange = vi.fn();
        const onOpenCard = vi.fn();

        render(
            <CardTable
                rows={[
                    {
                        id: 101,
                        nid: 201,
                        did: 1,
                        ord: 0,
                        type: 0,
                        queue: 0,
                        due: 10,
                        ivl: 0,
                        reps: 0,
                        lapses: 0,
                        factor: 2500,
                        flags: 0,
                        mod: Date.now(),
                        deckName: "Default",
                        noteTypeName: "Basic",
                        tags: ["geo"],
                        fields: ["Front", "Back"],
                        questionHtml: "<div>Front</div>",
                        answerHtml: "<div>Back</div>",
                    },
                ]}
                selectedIds={new Set()}
                sort={{ field: "due", direction: "asc" }}
                onToggleSelect={onToggleSelect}
                onToggleSelectAllCurrentPage={onToggleSelectAll}
                onSortChange={onSortChange}
                onOpenCard={onOpenCard}
            />,
        );

        await user.click(screen.getAllByRole("checkbox")[1]);
        await user.click(screen.getByRole("button", { name: /due/i }));
        await user.click(screen.getByRole("button", { name: /front/i }));

        expect(onToggleSelect).toHaveBeenCalledWith(101);
        expect(onSortChange).toHaveBeenCalledWith("due");
        expect(onOpenCard).toHaveBeenCalledWith(101);
    });
});
