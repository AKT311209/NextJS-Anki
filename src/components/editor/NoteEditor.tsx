import type { ReactNode } from "react";
import Link from "next/link";
import { FieldEditor } from "@/components/editor/FieldEditor";
import { TagEditor } from "@/components/editor/TagEditor";

export interface NoteEditorOption {
    readonly id: number;
    readonly name: string;
}

export interface NotePreviewCard {
    readonly templateName: string;
    readonly questionHtml: string;
    readonly answerHtml: string;
}

export interface NoteEditorProps {
    readonly mode: "create" | "edit";
    readonly loading: boolean;
    readonly saving: boolean;
    readonly error: string | null;
    readonly statusMessage: string | null;
    readonly deckOptions: readonly NoteEditorOption[];
    readonly selectedDeckId: number | null;
    readonly onSelectDeckId: (deckId: number) => void;
    readonly notetypeOptions: readonly NoteEditorOption[];
    readonly selectedNotetypeId: number | null;
    readonly onSelectNotetypeId: (notetypeId: number) => void;
    readonly fieldNames: readonly string[];
    readonly fields: readonly string[];
    readonly onFieldChange: (index: number, value: string) => void;
    readonly onInsertFieldSnippet: (index: number, snippet: string) => void;
    readonly tags: readonly string[];
    readonly tagSuggestions: readonly string[];
    readonly onTagsChange: (tags: string[]) => void;
    readonly duplicateCount: number;
    readonly previews: readonly NotePreviewCard[];
    readonly onSave: () => void;
    readonly notetypeManager?: ReactNode;
}

export function NoteEditor({
    mode,
    loading,
    saving,
    error,
    statusMessage,
    deckOptions,
    selectedDeckId,
    onSelectDeckId,
    notetypeOptions,
    selectedNotetypeId,
    onSelectNotetypeId,
    fieldNames,
    fields,
    onFieldChange,
    onInsertFieldSnippet,
    tags,
    tagSuggestions,
    onTagsChange,
    duplicateCount,
    previews,
    onSave,
    notetypeManager,
}: NoteEditorProps) {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6">
            <header className="space-y-2">
                <Link href="/" className="text-sm text-slate-400 underline-offset-4 hover:underline">
                    ← Back to decks
                </Link>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">
                    {mode === "create" ? "Add note" : "Edit note"}
                </h1>
                <p className="text-sm text-slate-400">
                    Write note fields, manage tags/media, and preview generated cards before saving.
                </p>
            </header>

            {error ? (
                <section className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                    {error}
                </section>
            ) : null}

            {statusMessage ? (
                <section className="rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
                    {statusMessage}
                </section>
            ) : null}

            {loading ? (
                <section className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
                    Loading note editor…
                </section>
            ) : null}

            {!loading ? (
                <>
                    <section className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                            <span className="text-slate-300">Deck</span>
                            <select
                                value={selectedDeckId ?? ""}
                                onChange={(event) => onSelectDeckId(Number.parseInt(event.currentTarget.value, 10))}
                                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-500"
                            >
                                {deckOptions.map((deck) => (
                                    <option key={deck.id} value={deck.id}>
                                        {deck.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1 text-sm">
                            <span className="text-slate-300">Notetype</span>
                            <select
                                value={selectedNotetypeId ?? ""}
                                onChange={(event) => onSelectNotetypeId(Number.parseInt(event.currentTarget.value, 10))}
                                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-500"
                            >
                                {notetypeOptions.map((notetype) => (
                                    <option key={notetype.id} value={notetype.id}>
                                        {notetype.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </section>

                    {duplicateCount > 0 ? (
                        <section className="rounded-lg border border-amber-700/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
                            Potential duplicate detected: {duplicateCount} existing note(s) share the first field value.
                        </section>
                    ) : null}

                    <section className="space-y-3">
                        {fieldNames.map((fieldName, index) => (
                            <FieldEditor
                                key={`${fieldName}-${index}`}
                                label={fieldName}
                                value={fields[index] ?? ""}
                                onChange={(value) => onFieldChange(index, value)}
                                onInsertSnippet={(snippet) => onInsertFieldSnippet(index, snippet)}
                            />
                        ))}
                    </section>

                    <TagEditor tags={tags} suggestions={tagSuggestions} onChange={onTagsChange} />

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving}
                            className="rounded-md border border-sky-700/70 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 transition enabled:hover:bg-sky-500/20 disabled:opacity-50"
                        >
                            {saving ? "Saving…" : mode === "create" ? "Create note" : "Save note"}
                        </button>
                        <Link
                            href="/browse"
                            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                        >
                            Open browser
                        </Link>
                    </div>

                    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                        <h2 className="text-lg font-semibold text-slate-100">Live card preview</h2>
                        {previews.length === 0 ? (
                            <p className="text-sm text-slate-400">No templates available for this notetype.</p>
                        ) : (
                            <div className="grid gap-3 xl:grid-cols-2">
                                {previews.map((preview) => (
                                    <article key={preview.templateName} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                                        <h3 className="text-sm font-semibold text-slate-100">{preview.templateName}</h3>
                                        <div className="mt-2 space-y-2 text-sm">
                                            <div>
                                                <p className="text-xs uppercase tracking-wide text-slate-400">Question</p>
                                                <div
                                                    className="prose prose-invert mt-1 max-w-none rounded-md border border-slate-800 bg-slate-900/80 p-3 text-sm"
                                                    dangerouslySetInnerHTML={{ __html: preview.questionHtml }}
                                                />
                                            </div>
                                            <div>
                                                <p className="text-xs uppercase tracking-wide text-slate-400">Answer</p>
                                                <div
                                                    className="prose prose-invert mt-1 max-w-none rounded-md border border-slate-800 bg-slate-900/80 p-3 text-sm"
                                                    dangerouslySetInnerHTML={{ __html: preview.answerHtml }}
                                                />
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>

                    {notetypeManager ?? null}
                </>
            ) : null}
        </main>
    );
}
