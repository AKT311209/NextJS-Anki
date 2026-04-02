import { useId, useState } from "react";

export interface TagEditorProps {
    readonly tags: readonly string[];
    readonly suggestions: readonly string[];
    readonly onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, suggestions, onChange }: TagEditorProps) {
    const [draft, setDraft] = useState("");
    const datalistId = useId();

    return (
        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <h3 className="text-sm font-semibold text-slate-100">Tags</h3>

            <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                    <button
                        key={tag}
                        type="button"
                        onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
                        className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-100 transition hover:bg-slate-700"
                    >
                        #{tag} ×
                    </button>
                ))}
                {tags.length === 0 ? <span className="text-xs text-slate-400">No tags yet.</span> : null}
            </div>

            <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    const nextTags = parseTags(draft);
                    if (nextTags.length === 0) {
                        return;
                    }

                    const merged = [...new Set([...tags, ...nextTags])];
                    onChange(merged);
                    setDraft("");
                }}
            >
                <input
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    placeholder="Add tags (space or comma separated)"
                    list={datalistId}
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
                />
                <button
                    type="submit"
                    className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                >
                    Add
                </button>
            </form>

            <datalist id={datalistId}>
                {suggestions.map((tag) => (
                    <option key={tag} value={tag} />
                ))}
            </datalist>
        </section>
    );
}

function parseTags(raw: string): string[] {
    return raw
        .split(/[\s,]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}
