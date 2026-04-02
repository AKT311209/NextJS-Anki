import { useMemo, useState } from "react";

export interface EditableNotetypeField {
    readonly name: string;
    readonly ord: number;
}

export interface EditableNotetypeTemplate {
    readonly name: string;
    readonly ord: number;
    readonly qfmt: string;
    readonly afmt: string;
}

export interface EditableNotetype {
    readonly id: number;
    readonly name: string;
    readonly type: number;
    readonly css: string;
    readonly fields: readonly EditableNotetypeField[];
    readonly templates: readonly EditableNotetypeTemplate[];
}

export interface TemplateEditorProps {
    readonly notetypes: readonly EditableNotetype[];
    readonly selectedNotetypeId: number | null;
    readonly onSelectNotetype: (id: number) => void;
    readonly onCreateNotetype: (name: string, kind: "basic" | "cloze") => Promise<void>;
    readonly onDeleteNotetype: (id: number) => Promise<void>;
    readonly onSaveNotetype: (draft: EditableNotetype) => Promise<void>;
}

interface NotetypeDraft {
    id: number;
    name: string;
    type: number;
    css: string;
    fields: EditableNotetypeField[];
    templates: EditableNotetypeTemplate[];
}

export function TemplateEditor({
    notetypes,
    selectedNotetypeId,
    onSelectNotetype,
    onCreateNotetype,
    onDeleteNotetype,
    onSaveNotetype,
}: TemplateEditorProps) {
    const selected = useMemo(
        () => notetypes.find((notetype) => notetype.id === selectedNotetypeId) ?? null,
        [notetypes, selectedNotetypeId],
    );

    const [draftById, setDraftById] = useState<Record<number, NotetypeDraft>>({});
    const [createName, setCreateName] = useState("");
    const [createKind, setCreateKind] = useState<"basic" | "cloze">("basic");

    const draft = useMemo(() => {
        if (!selected) {
            return null;
        }

        return draftById[selected.id] ?? toDraft(selected);
    }, [draftById, selected]);

    const updateDraft = (updater: (current: NotetypeDraft) => NotetypeDraft) => {
        if (!selected) {
            return;
        }

        setDraftById((current) => {
            const existing = current[selected.id] ?? toDraft(selected);
            return {
                ...current,
                [selected.id]: updater(existing),
            };
        });
    };

    return (
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <header>
                <h2 className="text-lg font-semibold text-slate-100">Notetype manager</h2>
                <p className="text-sm text-slate-400">
                    Edit fields, templates, and CSS. Supports both standard and cloze notetypes.
                </p>
            </header>

            <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
                <aside className="space-y-2">
                    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                        {notetypes.map((notetype) => (
                            <button
                                key={notetype.id}
                                type="button"
                                onClick={() => onSelectNotetype(notetype.id)}
                                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${notetype.id === selectedNotetypeId
                                        ? "border-sky-700/70 bg-sky-500/10 text-sky-100"
                                        : "border-slate-700 text-slate-200 hover:bg-slate-800"
                                    }`}
                            >
                                {notetype.name}
                            </button>
                        ))}
                    </div>

                    <form
                        className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const name = createName.trim();
                            if (name.length === 0) {
                                return;
                            }

                            void onCreateNotetype(name, createKind).then(() => setCreateName(""));
                        }}
                    >
                        <p className="text-xs uppercase tracking-wide text-slate-400">Create notetype</p>
                        <input
                            value={createName}
                            onChange={(event) => setCreateName(event.currentTarget.value)}
                            placeholder="Name"
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
                        />
                        <select
                            value={createKind}
                            onChange={(event) => setCreateKind(event.currentTarget.value as "basic" | "cloze")}
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
                        >
                            <option value="basic">Basic</option>
                            <option value="cloze">Cloze</option>
                        </select>
                        <button
                            type="submit"
                            className="w-full rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                        >
                            Create
                        </button>
                    </form>
                </aside>

                {draft ? (
                    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-sm">
                                <span className="text-slate-300">Name</span>
                                <input
                                    value={draft.name}
                                    onChange={(event) =>
                                        updateDraft((current) => ({
                                            ...current,
                                            name: event.currentTarget.value,
                                        }))
                                    }
                                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none"
                                />
                            </label>

                            <label className="space-y-1 text-sm">
                                <span className="text-slate-300">Kind</span>
                                <select
                                    value={draft.type}
                                    onChange={(event) =>
                                        updateDraft((current) => ({
                                            ...current,
                                            type: Number.parseInt(event.currentTarget.value, 10),
                                        }))
                                    }
                                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none"
                                >
                                    <option value={0}>Standard</option>
                                    <option value={1}>Cloze</option>
                                </select>
                            </label>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-100">Fields</h3>
                                <button
                                    type="button"
                                    onClick={() =>
                                        updateDraft((current) => {
                                            const nextOrd = current.fields.length;
                                            return {
                                                ...current,
                                                fields: [...current.fields, { name: `Field ${nextOrd + 1}`, ord: nextOrd }],
                                            };
                                        })
                                    }
                                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
                                >
                                    Add field
                                </button>
                            </div>

                            <div className="space-y-2">
                                {draft.fields.map((field, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <input
                                            value={field.name}
                                            onChange={(event) =>
                                                updateDraft((current) => {
                                                    const fields = [...current.fields];
                                                    fields[index] = {
                                                        ...fields[index],
                                                        name: event.currentTarget.value,
                                                    };
                                                    return { ...current, fields };
                                                })
                                            }
                                            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                updateDraft((current) => ({
                                                    ...current,
                                                    fields: move(current.fields, index, -1),
                                                }))
                                            }
                                            disabled={index === 0}
                                            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                updateDraft((current) => ({
                                                    ...current,
                                                    fields: move(current.fields, index, 1),
                                                }))
                                            }
                                            disabled={index >= draft.fields.length - 1}
                                            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                                        >
                                            ↓
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                updateDraft((current) => {
                                                    if (current.fields.length <= 1) {
                                                        return current;
                                                    }
                                                    const fields = current.fields.filter((_, itemIndex) => itemIndex !== index);
                                                    return {
                                                        ...current,
                                                        fields: withOrd(fields),
                                                    };
                                                })
                                            }
                                            className="rounded border border-rose-700/70 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 transition hover:bg-rose-500/20"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-100">Templates</h3>
                                <button
                                    type="button"
                                    onClick={() =>
                                        updateDraft((current) => {
                                            const nextOrd = current.templates.length;
                                            return {
                                                ...current,
                                                templates: [
                                                    ...current.templates,
                                                    {
                                                        name: `Card ${nextOrd + 1}`,
                                                        ord: nextOrd,
                                                        qfmt: "{{Front}}",
                                                        afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
                                                    },
                                                ],
                                            };
                                        })
                                    }
                                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
                                >
                                    Add template
                                </button>
                            </div>

                            <div className="space-y-3">
                                {draft.templates.map((template, index) => (
                                    <div key={index} className="space-y-2 rounded-md border border-slate-800 bg-slate-900/60 p-3">
                                        <div className="flex items-center gap-2">
                                            <input
                                                value={template.name}
                                                onChange={(event) =>
                                                    updateDraft((current) => {
                                                        const templates = [...current.templates];
                                                        templates[index] = {
                                                            ...templates[index],
                                                            name: event.currentTarget.value,
                                                        };
                                                        return { ...current, templates };
                                                    })
                                                }
                                                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateDraft((current) => ({
                                                        ...current,
                                                        templates: move(current.templates, index, -1),
                                                    }))
                                                }
                                                disabled={index === 0}
                                                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateDraft((current) => ({
                                                        ...current,
                                                        templates: move(current.templates, index, 1),
                                                    }))
                                                }
                                                disabled={index >= draft.templates.length - 1}
                                                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateDraft((current) => {
                                                        if (current.templates.length <= 1) {
                                                            return current;
                                                        }
                                                        const templates = current.templates.filter(
                                                            (_, itemIndex) => itemIndex !== index,
                                                        );
                                                        return {
                                                            ...current,
                                                            templates: withOrd(templates),
                                                        };
                                                    })
                                                }
                                                className="rounded border border-rose-700/70 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 transition hover:bg-rose-500/20"
                                            >
                                                Delete
                                            </button>
                                        </div>

                                        <label className="block text-xs text-slate-400">Question template</label>
                                        <textarea
                                            value={template.qfmt}
                                            onChange={(event) =>
                                                updateDraft((current) => {
                                                    const templates = [...current.templates];
                                                    templates[index] = {
                                                        ...templates[index],
                                                        qfmt: event.currentTarget.value,
                                                    };
                                                    return { ...current, templates };
                                                })
                                            }
                                            className="min-h-20 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                                        />

                                        <label className="block text-xs text-slate-400">Answer template</label>
                                        <textarea
                                            value={template.afmt}
                                            onChange={(event) =>
                                                updateDraft((current) => {
                                                    const templates = [...current.templates];
                                                    templates[index] = {
                                                        ...templates[index],
                                                        afmt: event.currentTarget.value,
                                                    };
                                                    return { ...current, templates };
                                                })
                                            }
                                            className="min-h-20 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-slate-300">Card CSS</label>
                            <textarea
                                value={draft.css}
                                onChange={(event) =>
                                    updateDraft((current) => ({
                                        ...current,
                                        css: event.currentTarget.value,
                                    }))
                                }
                                className="min-h-28 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (!draft) {
                                        return;
                                    }
                                    void onSaveNotetype({
                                        id: draft.id,
                                        name: draft.name.trim() || "Untitled",
                                        type: draft.type,
                                        css: draft.css,
                                        fields: withOrd(draft.fields),
                                        templates: withOrd(draft.templates),
                                    });
                                }}
                                className="rounded-md border border-sky-700/70 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
                            >
                                Save notetype
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (!selectedNotetypeId) {
                                        return;
                                    }
                                    if (!window.confirm("Delete this notetype? Existing notes using it may become invalid.")) {
                                        return;
                                    }
                                    void onDeleteNotetype(selectedNotetypeId);
                                }}
                                className="rounded-md border border-rose-700/70 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-500/20"
                            >
                                Delete notetype
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
                        Select a notetype to edit.
                    </div>
                )}
            </div>
        </section>
    );
}

function toDraft(notetype: EditableNotetype): NotetypeDraft {
    return {
        id: notetype.id,
        name: notetype.name,
        type: notetype.type,
        css: notetype.css,
        fields: notetype.fields.map((field) => ({ ...field })),
        templates: notetype.templates.map((template) => ({ ...template })),
    };
}

function move<T extends { ord: number }>(items: readonly T[], index: number, delta: number): T[] {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= items.length) {
        return withOrd(items);
    }

    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    return withOrd(next);
}

function withOrd<T extends { ord: number }>(items: readonly T[]): T[] {
    return items.map((item, index) => ({
        ...item,
        ord: index,
    }));
}
