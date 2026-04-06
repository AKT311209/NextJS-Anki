import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardTable } from "@/components/browser/CardTable";
import { SearchBar } from "@/components/browser/SearchBar";

const EMPTY_FILTERS = {
    deckIds: [],
    notetypeIds: [],
    tags: [],
    states: [],
    flags: [],
} as const;

const EMPTY_FACETS = {
    decks: [],
    notetypes: [],
    tags: [],
} as const;

describe("Phase 5 browser UI", () => {
    it("submits query from search bar", async () => {
        const user = userEvent.setup();
        const onQueryChange = vi.fn();
        const onSubmit = vi.fn();

        render(
            <SearchBar
                query=""
                loading={false}
                filters={EMPTY_FILTERS}
                facets={EMPTY_FACETS}
                onQueryChange={onQueryChange}
                onDeckFiltersChange={vi.fn()}
                onNotetypeFiltersChange={vi.fn()}
                onTagFiltersChange={vi.fn()}
                onStateFiltersChange={vi.fn()}
                onFlagFiltersChange={vi.fn()}
                onClearFilters={vi.fn()}
                onSubmit={onSubmit}
            />,
        );

        const input = screen.getByPlaceholderText(/search cards/i);
        await user.type(input, "deck:default");
        await user.click(screen.getByRole("button", { name: /search/i }));

        expect(onQueryChange).toHaveBeenCalled();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("supports multi-select faceted filters", async () => {
        const user = userEvent.setup();
        const onDeckFiltersChange = vi.fn();
        const onNotetypeFiltersChange = vi.fn();
        const onTagFiltersChange = vi.fn();
        const onStateFiltersChange = vi.fn();
        const onFlagFiltersChange = vi.fn();
        const onClearFilters = vi.fn();

        render(
            <SearchBar
                query=""
                loading={false}
                filters={{
                    deckIds: [1],
                    notetypeIds: [],
                    tags: [],
                    states: [],
                    flags: [],
                }}
                facets={{
                    decks: [{ id: 1, name: "Default" }],
                    notetypes: [{ id: 10, name: "Basic" }],
                    tags: [{ name: "geo", count: 5 }],
                }}
                onQueryChange={vi.fn()}
                onDeckFiltersChange={onDeckFiltersChange}
                onNotetypeFiltersChange={onNotetypeFiltersChange}
                onTagFiltersChange={onTagFiltersChange}
                onStateFiltersChange={onStateFiltersChange}
                onFlagFiltersChange={onFlagFiltersChange}
                onClearFilters={onClearFilters}
                onSubmit={vi.fn()}
            />,
        );

        await user.click(screen.getByRole("button", { name: /^Due$/i }));
        await user.click(screen.getByRole("button", { name: /Flag 2/i }));
        await user.click(screen.getByLabelText("Default"));
        await user.click(screen.getByLabelText("Basic"));
        await user.click(screen.getByRole("button", { name: /geo/i }));
        await user.click(screen.getByRole("button", { name: /clear filters/i }));

        expect(onStateFiltersChange).toHaveBeenCalledWith(["due"]);
        expect(onFlagFiltersChange).toHaveBeenCalledWith([2]);
        expect(onDeckFiltersChange).toHaveBeenCalledWith([]);
        expect(onNotetypeFiltersChange).toHaveBeenCalledWith([10]);
        expect(onTagFiltersChange).toHaveBeenCalledWith(["geo"]);
        expect(onClearFilters).toHaveBeenCalledTimes(1);
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
