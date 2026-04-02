"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
    NoteEditor,
    type NoteEditorOption,
    type NotePreviewCard,
} from "@/components/editor/NoteEditor";
import {
    TemplateEditor,
    type EditableNotetype,
    type EditableNotetypeField,
    type EditableNotetypeTemplate,
} from "@/components/editor/TemplateEditor";
import { useCollection } from "@/hooks/use-collection";
import { renderCardTemplatesAsync } from "@/lib/rendering/template-renderer";
import { DEFAULT_DECK_CONFIG_ID, ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { fnv1a32 } from "@/lib/storage/sql-functions";
import { CardsRepository } from "@/lib/storage/repositories/cards";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { NotesRepository } from "@/lib/storage/repositories/notes";
import { NotetypesRepository, type NotetypeRecord } from "@/lib/storage/repositories/notetypes";
import { joinFields, splitFields, splitTags } from "@/lib/types/note";

const DEFAULT_NOTETYPE_CSS = `
.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: #e2e8f0;
  background-color: #0f172a;
}

.cloze {
  font-weight: bold;
  color: #60a5fa;
}
`;

interface TagRow {
    readonly tags: string;
}

export default function EditorPage() {
    const params = useParams<{ noteId: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const collection = useCollection();

    const routeNoteId = useMemo(() => {
        const parsed = Number.parseInt(params.noteId, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }, [params.noteId]);

    const mode = routeNoteId === null ? "create" : "edit";

    const preferredDeckId = useMemo(() => {
        const raw = searchParams.get("deckId");
        if (!raw) {
            return null;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }, [searchParams]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [noteId, setNoteId] = useState<number | null>(null);
    const [decks, setDecks] = useState<DeckRecord[]>([]);
    const [notetypes, setNotetypes] = useState<NotetypeRecord[]>([]);
    const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
    const [selectedNotetypeId, setSelectedNotetypeId] = useState<number | null>(null);

    const [fields, setFields] = useState<string[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    const [duplicateCount, setDuplicateCount] = useState(0);
    const [previews, setPreviews] = useState<NotePreviewCard[]>([]);

    const deckOptions = useMemo<readonly NoteEditorOption[]>(
        () => decks.map((deck) => ({ id: deck.id, name: deck.name })),
        [decks],
    );

    const notetypeOptions = useMemo<readonly NoteEditorOption[]>(
        () => notetypes.map((notetype) => ({ id: notetype.id, name: notetype.name })),
        [notetypes],
    );

    const selectedNotetype = useMemo(
        () => notetypes.find((notetype) => notetype.id === selectedNotetypeId) ?? null,
        [notetypes, selectedNotetypeId],
    );

    const fieldNames = useMemo(() => {
        if (!selectedNotetype) {
            return ["Front", "Back"];
        }
        const parsedFields = parseNotetypeFields(selectedNotetype.flds);
        if (parsedFields.length === 0) {
            return ["Front", "Back"];
        }
        return parsedFields.map((field) => field.name);
    }, [selectedNotetype]);

    const loadEditor = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const connection = collection.connection;
            const bootstrap = await ensureCollectionBootstrap(connection);

            const decksRepository = new DecksRepository(connection);
            const notesRepository = new NotesRepository(connection);
            const notetypesRepository = new NotetypesRepository(connection);
            const cardsRepository = new CardsRepository(connection);

            const [deckList, notetypeList, tagRows] = await Promise.all([
                decksRepository.list(),
                notetypesRepository.list(),
                connection.select<TagRow>("SELECT tags FROM notes"),
            ]);

            setDecks(deckList);
            setNotetypes(notetypeList);
            setTagSuggestions(extractTagSuggestions(tagRows));

            if (routeNoteId !== null) {
                const note = await notesRepository.getById(routeNoteId);
                if (!note) {
                    throw new Error(`Note ${routeNoteId} not found.`);
                }

                setNoteId(note.id);
                setSelectedNotetypeId(note.mid);
                setFields(splitFields(note.flds));
                setTags(splitTags(note.tags));

                const cards = await cardsRepository.listByNoteId(note.id);
                const firstCard = cards[0];
                setSelectedDeckId(firstCard?.did ?? bootstrap.defaultDeckId);
            } else {
                const resolvedNotetypeId =
                    notetypeList.find((notetype) => notetype.name === "Basic")?.id ??
                    bootstrap.defaultNotetypeId ??
                    notetypeList[0]?.id ??
                    null;

                setNoteId(null);
                setSelectedNotetypeId(resolvedNotetypeId);
                setTags([]);

                const defaultDeck =
                    (preferredDeckId !== null && deckList.some((deck) => deck.id === preferredDeckId))
                        ? preferredDeckId
                        : bootstrap.defaultDeckId;
                setSelectedDeckId(defaultDeck);

                const parsedFields = parseNotetypeFields(
                    notetypeList.find((notetype) => notetype.id === resolvedNotetypeId)?.flds,
                );
                const size = Math.max(1, parsedFields.length || 2);
                setFields(new Array(size).fill(""));
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to load note editor.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready, preferredDeckId, routeNoteId]);

    const refreshNotetypes = useCallback(async () => {
        if (!collection.connection) {
            return;
        }

        const repository = new NotetypesRepository(collection.connection);
        const list = await repository.list();
        setNotetypes(list);
        if (!list.some((notetype) => notetype.id === selectedNotetypeId)) {
            setSelectedNotetypeId(list[0]?.id ?? null);
        }
    }, [collection.connection, selectedNotetypeId]);

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }

        void loadEditor();
    }, [collection.connection, collection.ready, loadEditor]);

    useEffect(() => {
        const targetSize = Math.max(1, fieldNames.length);
        setFields((current) => {
            const next = [...current];
            if (next.length < targetSize) {
                while (next.length < targetSize) {
                    next.push("");
                }
                return next;
            }

            if (next.length > targetSize) {
                return next.slice(0, targetSize);
            }

            return next;
        });
    }, [fieldNames]);

    useEffect(() => {
        const connection = collection.connection;
        if (!connection || selectedNotetypeId === null) {
            setDuplicateCount(0);
            return;
        }

        const firstField = fields[0]?.trim() ?? "";
        if (firstField.length === 0) {
            setDuplicateCount(0);
            return;
        }

        let cancelled = false;

        void (async () => {
            const notes = new NotesRepository(connection);
            const matches = await notes.findDuplicates(selectedNotetypeId, firstField);
            if (cancelled) {
                return;
            }

            const filtered = matches.filter((entry) => entry.id !== noteId);
            setDuplicateCount(filtered.length);
        })();

        return () => {
            cancelled = true;
        };
    }, [collection.connection, fields, noteId, selectedNotetypeId]);

    useEffect(() => {
        if (!selectedNotetype) {
            setPreviews([]);
            return;
        }

        let cancelled = false;
        const templates = parseNotetypeTemplates(selectedNotetype.tmpls);
        const fieldMap = buildFieldMap(fieldNames, fields);

        void (async () => {
            const next = await Promise.all(
                templates.map(async (template) => {
                    const rendered = await renderCardTemplatesAsync({
                        questionTemplate: template.qfmt,
                        answerTemplate: template.afmt,
                        fields: fieldMap,
                        clozeOrdinal: template.ord + 1,
                        sanitize: true,
                        preserveComments: true,
                        renderMath: true,
                    });

                    return {
                        templateName: template.name,
                        questionHtml: rendered.question.html,
                        answerHtml: rendered.answer.html,
                    } satisfies NotePreviewCard;
                }),
            );

            if (!cancelled) {
                setPreviews(next);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [fieldNames, fields, selectedNotetype]);

    const saveNote = useCallback(async () => {
        if (!collection.connection || selectedDeckId === null || selectedNotetypeId === null) {
            return;
        }

        setSaving(true);
        setError(null);
        setStatusMessage(null);

        try {
            const connection = collection.connection;
            const notes = new NotesRepository(connection);
            const cards = new CardsRepository(connection);
            const normalizedFields = fields.map((value) => value ?? "");
            const primaryField = normalizedFields[0]?.trim() ?? "";
            const sfldCandidate = Number.parseInt(primaryField, 10);
            const now = Date.now();

            let persistedNoteId = noteId;

            if (persistedNoteId === null) {
                persistedNoteId = generateEntityId();
                await notes.create({
                    id: persistedNoteId,
                    guid: crypto.randomUUID(),
                    mid: selectedNotetypeId,
                    tags: tags.join(" "),
                    fields: normalizedFields,
                    sfld: Number.isFinite(sfldCandidate) ? sfldCandidate : 0,
                    csum: fnv1a32(primaryField),
                    mod: now,
                });
            } else {
                await notes.update(persistedNoteId, {
                    mid: selectedNotetypeId,
                    tags: formatTags(tags),
                    flds: joinFields(normalizedFields),
                    sfld: Number.isFinite(sfldCandidate) ? sfldCandidate : 0,
                    csum: fnv1a32(primaryField),
                    mod: now,
                });
            }

            const templateCount = parseNotetypeTemplates(selectedNotetype?.tmpls).length || 1;
            await syncCardsForNote(cards, persistedNoteId, selectedDeckId, templateCount);

            setNoteId(persistedNoteId);
            setStatusMessage("Note saved.");

            if (mode === "create") {
                router.replace(`/editor/${persistedNoteId}`);
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Failed to save note.";
            setError(message);
        } finally {
            setSaving(false);
        }
    }, [
        collection.connection,
        fields,
        mode,
        noteId,
        router,
        selectedDeckId,
        selectedNotetype,
        selectedNotetypeId,
        tags,
    ]);

    const editableNotetypes = useMemo<readonly EditableNotetype[]>(
        () =>
            notetypes.map((notetype) => ({
                id: notetype.id,
                name: notetype.name,
                type: notetype.type ?? 0,
                css: typeof notetype.css === "string" ? notetype.css : "",
                fields: parseNotetypeFields(notetype.flds),
                templates: parseNotetypeTemplates(notetype.tmpls),
            })),
        [notetypes],
    );

    return (
        <NoteEditor
            mode={mode}
            loading={loading}
            saving={saving}
            error={error ?? collection.error}
            statusMessage={statusMessage}
            deckOptions={deckOptions}
            selectedDeckId={selectedDeckId}
            onSelectDeckId={setSelectedDeckId}
            notetypeOptions={notetypeOptions}
            selectedNotetypeId={selectedNotetypeId}
            onSelectNotetypeId={setSelectedNotetypeId}
            fieldNames={fieldNames}
            fields={fields}
            onFieldChange={(index, value) =>
                setFields((current) => {
                    const next = [...current];
                    next[index] = value;
                    return next;
                })
            }
            onInsertFieldSnippet={(index, snippet) =>
                setFields((current) => {
                    const next = [...current];
                    next[index] = `${next[index] ?? ""}${snippet}`;
                    return next;
                })
            }
            tags={tags}
            tagSuggestions={tagSuggestions}
            onTagsChange={setTags}
            duplicateCount={duplicateCount}
            previews={previews}
            onSave={() => void saveNote()}
            notetypeManager={
                <TemplateEditor
                    notetypes={editableNotetypes}
                    selectedNotetypeId={selectedNotetypeId}
                    onSelectNotetype={setSelectedNotetypeId}
                    onCreateNotetype={async (name, kind) => {
                        if (!collection.connection) {
                            return;
                        }

                        const repository = new NotetypesRepository(collection.connection);
                        const created = await repository.create(name, {
                            type: kind === "cloze" ? 1 : 0,
                            css: DEFAULT_NOTETYPE_CSS,
                            flds: kind === "cloze"
                                ? [
                                    { name: "Text", ord: 0 },
                                    { name: "Back Extra", ord: 1 },
                                ]
                                : [
                                    { name: "Front", ord: 0 },
                                    { name: "Back", ord: 1 },
                                ],
                            tmpls: kind === "cloze"
                                ? [
                                    {
                                        name: "Cloze",
                                        ord: 0,
                                        qfmt: "{{cloze:Text}}",
                                        afmt: "{{cloze:Text}}<br>{{Back Extra}}",
                                    },
                                ]
                                : [
                                    {
                                        name: "Card 1",
                                        ord: 0,
                                        qfmt: "{{Front}}",
                                        afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
                                    },
                                ],
                        });

                        await refreshNotetypes();
                        setSelectedNotetypeId(created.id);
                    }}
                    onDeleteNotetype={async (id) => {
                        if (!collection.connection) {
                            return;
                        }

                        if (notetypes.length <= 1) {
                            throw new Error("At least one notetype must remain.");
                        }

                        const repository = new NotetypesRepository(collection.connection);
                        await repository.delete(id);

                        await refreshNotetypes();
                    }}
                    onSaveNotetype={async (draft) => {
                        if (!collection.connection) {
                            return;
                        }

                        const repository = new NotetypesRepository(collection.connection);
                        await repository.update(draft.id, {
                            name: draft.name,
                            type: draft.type,
                            css: draft.css,
                            flds: [...draft.fields],
                            tmpls: [...draft.templates],
                            sortf: 0,
                            did: draft.type === 1 ? undefined : DEFAULT_DECK_CONFIG_ID,
                        });

                        await refreshNotetypes();
                    }}
                />
            }
        />
    );
}

function parseNotetypeFields(raw: unknown[] | undefined): EditableNotetypeField[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        return [
            { name: "Front", ord: 0 },
            { name: "Back", ord: 1 },
        ];
    }

    return raw
        .map((value, index) => {
            if (!value || typeof value !== "object") {
                return {
                    name: `Field ${index + 1}`,
                    ord: index,
                };
            }

            const typed = value as Record<string, unknown>;
            return {
                name: typeof typed.name === "string" && typed.name.trim().length > 0
                    ? typed.name
                    : `Field ${index + 1}`,
                ord: typeof typed.ord === "number" ? typed.ord : index,
            };
        })
        .sort((left, right) => left.ord - right.ord);
}

function parseNotetypeTemplates(raw: unknown[] | undefined): EditableNotetypeTemplate[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        return [
            {
                name: "Card 1",
                ord: 0,
                qfmt: "{{Front}}",
                afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
            },
        ];
    }

    const parsed = raw
        .map((value, index) => {
            if (!value || typeof value !== "object") {
                return null;
            }

            const typed = value as Record<string, unknown>;
            if (typeof typed.qfmt !== "string" || typeof typed.afmt !== "string") {
                return null;
            }

            return {
                name: typeof typed.name === "string" && typed.name.trim().length > 0
                    ? typed.name
                    : `Card ${index + 1}`,
                ord: typeof typed.ord === "number" ? typed.ord : index,
                qfmt: typed.qfmt,
                afmt: typed.afmt,
            } satisfies EditableNotetypeTemplate;
        })
        .filter((template): template is EditableNotetypeTemplate => template !== null)
        .sort((left, right) => left.ord - right.ord);

    return parsed.length > 0
        ? parsed
        : [
            {
                name: "Card 1",
                ord: 0,
                qfmt: "{{Front}}",
                afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
            },
        ];
}

function buildFieldMap(fieldNames: readonly string[], fieldValues: readonly string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const size = Math.max(fieldNames.length, fieldValues.length);

    for (let index = 0; index < size; index += 1) {
        const name = fieldNames[index] ?? `Field ${index + 1}`;
        map[name] = fieldValues[index] ?? "";
    }

    return map;
}

function extractTagSuggestions(rows: readonly TagRow[]): string[] {
    const tags = new Set<string>();

    for (const row of rows) {
        for (const tag of splitTags(row.tags ?? "")) {
            tags.add(tag);
        }
    }

    return [...tags].sort((left, right) => left.localeCompare(right));
}

function formatTags(tags: readonly string[]): string {
    const normalized = tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .join(" ");
    return normalized.length > 0 ? ` ${normalized} ` : "";
}

async function syncCardsForNote(
    repository: CardsRepository,
    noteId: number,
    deckId: number,
    templateCount: number,
): Promise<void> {
    const existing = await repository.listByNoteId(noteId);
    const byOrd = new Map(existing.map((card) => [card.ord, card]));
    const today = Math.floor(Date.now() / 86_400_000);

    for (const card of existing) {
        if (card.ord >= templateCount) {
            await repository.delete(card.id);
        }
    }

    for (let ord = 0; ord < templateCount; ord += 1) {
        const card = byOrd.get(ord);
        if (card) {
            if (card.did !== deckId) {
                await repository.update(card.id, { did: deckId, mod: Date.now() });
            }
            continue;
        }

        await repository.create({
            id: generateEntityId(ord),
            nid: noteId,
            did: deckId,
            ord,
            type: 0,
            queue: 0,
            due: today,
            ivl: 0,
            factor: 2500,
            reps: 0,
            lapses: 0,
            left: 0,
            odue: 0,
            odid: 0,
            flags: 0,
            data: "",
        });
    }
}

function generateEntityId(seed = 0): number {
    return Date.now() * 100 + (seed % 100) + Math.floor(Math.random() * 10);
}
