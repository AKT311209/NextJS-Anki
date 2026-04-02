import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/editor/NoteEditor";

describe("Phase 5 note editor UI", () => {
    it("renders duplicate warning and triggers save", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();

        render(
            <NoteEditor
                mode="create"
                loading={false}
                saving={false}
                error={null}
                statusMessage={null}
                deckOptions={[{ id: 1, name: "Default" }]}
                selectedDeckId={1}
                onSelectDeckId={() => { }}
                notetypeOptions={[{ id: 1001, name: "Basic" }]}
                selectedNotetypeId={1001}
                onSelectNotetypeId={() => { }}
                fieldNames={["Front", "Back"]}
                fields={["Capital of France", "Paris"]}
                onFieldChange={() => { }}
                onInsertFieldSnippet={() => { }}
                tags={["geo"]}
                tagSuggestions={["geo", "capital"]}
                onTagsChange={() => { }}
                duplicateCount={2}
                previews={[
                    {
                        templateName: "Card 1",
                        questionHtml: "<div>Capital of France</div>",
                        answerHtml: "<div>Paris</div>",
                    },
                ]}
                onSave={onSave}
            />,
        );

        expect(screen.getByText(/potential duplicate detected/i)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /create note/i }));
        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
