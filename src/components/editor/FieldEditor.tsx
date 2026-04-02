export interface FieldEditorProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly onInsertSnippet: (snippet: string) => void;
}

const SNIPPETS: Array<{ label: string; snippet: string }> = [
    { label: "Bold", snippet: "<b></b>" },
    { label: "Italic", snippet: "<i></i>" },
    { label: "List", snippet: "<ul><li></li></ul>" },
    { label: "Code", snippet: "<code></code>" },
    { label: "Image", snippet: "<img src=\"\" alt=\"\" />" },
    { label: "Audio", snippet: "[sound:audio.mp3]" },
];

export function FieldEditor({ label, value, onChange, onInsertSnippet }: FieldEditorProps) {
    return (
        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
                <div className="ml-auto flex flex-wrap gap-1">
                    {SNIPPETS.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            onClick={() => onInsertSnippet(item.snippet)}
                            className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            <textarea
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className="min-h-28 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
            />
        </section>
    );
}
