"use client";

import { useCallback, useEffect, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { parseSearchQuery } from "@/lib/search/parser";
import { buildSearchSql, type SearchSqlBuilderContext } from "@/lib/search/sql-builder";
import { renderCardTemplates } from "@/lib/rendering/template-renderer";
import { ensureCollectionBootstrap } from "@/lib/storage/bootstrap";
import { DecksRepository } from "@/lib/storage/repositories/decks";
import { NotetypesRepository, type NotetypeRecord } from "@/lib/storage/repositories/notetypes";
import { splitFields } from "@/lib/types/note";

export type SearchSortField = "due" | "deck" | "reps" | "interval" | "modified";

export interface SearchSort {
    readonly field: SearchSortField;
    readonly direction: "asc" | "desc";
}

export type BrowserBulkAction = "suspend" | "bury" | "delete" | "move" | "flag";

export interface SearchCardResult {
    readonly id: number;
    readonly nid: number;
    readonly did: number;
    readonly ord: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
    readonly ivl: number;
    readonly reps: number;
    readonly lapses: number;
    readonly factor: number;
    readonly flags: number;
    readonly mod: number;
    readonly deckName: string;
    readonly noteTypeName: string;
    readonly tags: readonly string[];
    readonly fields: readonly string[];
    readonly questionHtml: string;
    readonly answerHtml: string;
}

export interface BulkActionRequest {
    readonly action: BrowserBulkAction;
    readonly cardIds: readonly number[];
    readonly targetDeckId?: number;
    readonly flagValue?: number;
}

export interface UseSearchResult {
    readonly query: string;
    readonly setQuery: (query: string) => void;
    readonly loading: boolean;
    readonly error: string | null;
    readonly results: readonly SearchCardResult[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly sort: SearchSort;
    readonly setPage: (page: number) => void;
    readonly setSort: (sort: SearchSort) => void;
    readonly reload: () => Promise<void>;
    readonly applyBulkAction: (request: BulkActionRequest) => Promise<void>;
}

interface SearchQueryRow {
    readonly id: number;
    readonly nid: number;
    readonly did: number;
    readonly ord: number;
    readonly mod: number;
    readonly type: number;
    readonly queue: number;
    readonly due: number;
    readonly ivl: number;
    readonly factor: number;
    readonly reps: number;
    readonly lapses: number;
    readonly flags: number;
    readonly noteTags: string;
    readonly noteFields: string;
    readonly noteMid: number;
}

interface CountRow {
    readonly total: number;
}

const DEFAULT_PAGE_SIZE = 50;

export function useSearch(initialQuery = ""): UseSearchResult {
    const collection = useCollection();

    const [query, setQueryState] = useState(initialQuery);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<SearchCardResult[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(DEFAULT_PAGE_SIZE);
    const [sort, setSort] = useState<SearchSort>({
        field: "due",
        direction: "asc",
    });

    const setQuery = useCallback((nextQuery: string) => {
        setPage(1);
        setQueryState(nextQuery);
    }, []);

    const executeSearch = useCallback(async () => {
        if (!collection.connection || !collection.ready) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const connection = collection.connection;
            await ensureCollectionBootstrap(connection);

            const decks = new DecksRepository(connection);
            const notetypes = new NotetypesRepository(connection);

            const [deckList, notetypeList] = await Promise.all([decks.list(), notetypes.list()]);

            const deckNameById = new Map(deckList.map((deck) => [deck.id, deck.name]));
            const notetypeById = new Map(notetypeList.map((notetype) => [notetype.id, notetype]));

            const context: SearchSqlBuilderContext = {
                now: new Date(),
                resolveDeckIds: (value) =>
                    deckList
                        .filter((deck) => {
                            const normalizedDeck = deck.name.toLowerCase();
                            const normalizedQuery = value.trim().toLowerCase();
                            return (
                                normalizedDeck === normalizedQuery ||
                                normalizedDeck.startsWith(`${normalizedQuery}::`) ||
                                normalizedDeck.includes(normalizedQuery)
                            );
                        })
                        .map((deck) => deck.id),
                resolveNotetypeIds: (value) =>
                    notetypeList
                        .filter((notetype) => notetype.name.toLowerCase().includes(value.trim().toLowerCase()))
                        .map((notetype) => notetype.id),
            };

            const ast = parseSearchQuery(query);
            const built = buildSearchSql(ast, context);
            const orderBy = resolveOrderBy(sort);

            const countRow = await connection.get<CountRow>(
                `
                SELECT COUNT(*) AS total
                FROM cards c
                INNER JOIN notes n ON n.id = c.nid
                WHERE ${built.whereSql}
                `,
                [...built.params],
            );

            const safePage = Math.max(1, page);
            const offset = (safePage - 1) * pageSize;

            const rows = await connection.select<SearchQueryRow>(
                `
                SELECT
                    c.id,
                    c.nid,
                    c.did,
                    c.ord,
                    c.mod,
                    c.type,
                    c.queue,
                    c.due,
                    c.ivl,
                    c.factor,
                    c.reps,
                    c.lapses,
                    c.flags,
                    n.tags AS noteTags,
                    n.flds AS noteFields,
                    n.mid AS noteMid
                FROM cards c
                INNER JOIN notes n ON n.id = c.nid
                WHERE ${built.whereSql}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
                `,
                [...built.params, pageSize, offset],
            );

            const mapped = rows.map((row) => {
                const fields = splitFields(row.noteFields);
                const notetype = notetypeById.get(row.noteMid);
                const preview = buildCardPreview(notetype, row.ord, fields);

                return {
                    id: row.id,
                    nid: row.nid,
                    did: row.did,
                    ord: row.ord,
                    type: row.type,
                    queue: row.queue,
                    due: row.due,
                    ivl: row.ivl,
                    reps: row.reps,
                    lapses: row.lapses,
                    factor: row.factor,
                    flags: row.flags,
                    mod: row.mod,
                    deckName: deckNameById.get(row.did) ?? `Deck ${row.did}`,
                    noteTypeName: notetype?.name ?? `Notetype ${row.noteMid}`,
                    tags: row.noteTags
                        .trim()
                        .split(" ")
                        .map((tag) => tag.trim())
                        .filter((tag) => tag.length > 0),
                    fields,
                    questionHtml: preview.questionHtml,
                    answerHtml: preview.answerHtml,
                } satisfies SearchCardResult;
            });

            setResults(mapped);
            setTotal(Number(countRow?.total ?? 0));
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Search failed.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready, page, pageSize, query, sort]);

    const applyBulkAction = useCallback(
        async (request: BulkActionRequest) => {
            if (!collection.connection || request.cardIds.length === 0) {
                return;
            }

            const ids = [...request.cardIds];
            const placeholders = ids.map(() => "?").join(", ");
            const now = Date.now();

            await collection.connection.transaction(async (tx) => {
                if (request.action === "suspend") {
                    await tx.run(
                        `UPDATE cards SET queue = -1, mod = ? WHERE id IN (${placeholders})`,
                        [now, ...ids],
                    );
                    return;
                }

                if (request.action === "bury") {
                    await tx.run(
                        `UPDATE cards SET queue = -2, mod = ? WHERE id IN (${placeholders})`,
                        [now, ...ids],
                    );
                    return;
                }

                if (request.action === "move") {
                    if (request.targetDeckId === undefined) {
                        throw new Error("Target deck is required for move action.");
                    }

                    await tx.run(
                        `UPDATE cards SET did = ?, mod = ? WHERE id IN (${placeholders})`,
                        [request.targetDeckId, now, ...ids],
                    );
                    return;
                }

                if (request.action === "flag") {
                    const flag = Math.max(0, Math.min(7, Math.trunc(request.flagValue ?? 0)));
                    await tx.run(
                        `UPDATE cards SET flags = ((flags & ~7) | ?), mod = ? WHERE id IN (${placeholders})`,
                        [flag, now, ...ids],
                    );
                    return;
                }

                await tx.run(`DELETE FROM cards WHERE id IN (${placeholders})`, [...ids]);
                await tx.run("DELETE FROM notes WHERE id NOT IN (SELECT DISTINCT nid FROM cards)");
            });

            await executeSearch();
        },
        [collection.connection, executeSearch],
    );

    useEffect(() => {
        if (!collection.ready || !collection.connection) {
            return;
        }
        void executeSearch();
    }, [collection.connection, collection.ready, executeSearch]);

    return {
        query,
        setQuery,
        loading: loading || collection.loading,
        error: error ?? collection.error,
        results,
        total,
        page,
        pageSize,
        sort,
        setPage,
        setSort,
        reload: executeSearch,
        applyBulkAction,
    };
}

function resolveOrderBy(sort: SearchSort): string {
    const direction = sort.direction === "desc" ? "DESC" : "ASC";

    if (sort.field === "deck") {
        return `c.did ${direction}, c.due ASC, c.id ASC`;
    }

    if (sort.field === "reps") {
        return `c.reps ${direction}, c.id ASC`;
    }

    if (sort.field === "interval") {
        return `c.ivl ${direction}, c.id ASC`;
    }

    if (sort.field === "modified") {
        return `c.mod ${direction}, c.id ASC`;
    }

    return `c.due ${direction}, c.id ASC`;
}

function buildCardPreview(
    notetype: NotetypeRecord | undefined,
    ord: number,
    fields: readonly string[],
): {
    readonly questionHtml: string;
    readonly answerHtml: string;
} {
    if (!notetype) {
        return {
            questionHtml: fields[0] ?? "",
            answerHtml: fields[1] ?? "",
        };
    }

    const fieldNames = extractFieldNames(notetype.flds);
    const fieldMap: Record<string, string> = {};

    for (let index = 0; index < fields.length; index += 1) {
        const key = fieldNames[index] ?? `Field ${index + 1}`;
        fieldMap[key] = fields[index] ?? "";
    }

    const template = resolveTemplate(notetype.tmpls, ord);
    if (!template) {
        return {
            questionHtml: fields[0] ?? "",
            answerHtml: fields[1] ?? "",
        };
    }

    const rendered = renderCardTemplates({
        questionTemplate: template.qfmt,
        answerTemplate: template.afmt,
        fields: fieldMap,
        clozeOrdinal: ord + 1,
        sanitize: true,
        preserveComments: true,
        renderMath: false,
    });

    return {
        questionHtml: rendered.question.html,
        answerHtml: rendered.answer.html,
    };
}

function extractFieldNames(rawFields: unknown[] | undefined): string[] {
    if (!Array.isArray(rawFields)) {
        return [];
    }

    return rawFields
        .map((value, index) => {
            if (!value || typeof value !== "object") {
                return {
                    ord: index,
                    name: `Field ${index + 1}`,
                };
            }

            const typed = value as Record<string, unknown>;
            const name = typeof typed.name === "string" && typed.name.trim().length > 0
                ? typed.name
                : `Field ${index + 1}`;
            const ord = typeof typed.ord === "number" ? typed.ord : index;

            return { ord, name };
        })
        .sort((left, right) => left.ord - right.ord)
        .map((field) => field.name);
}

function resolveTemplate(rawTemplates: unknown[] | undefined, ord: number): {
    readonly qfmt: string;
    readonly afmt: string;
} | null {
    if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
        return null;
    }

    const normalized = rawTemplates
        .map((value, index) => {
            if (!value || typeof value !== "object") {
                return null;
            }

            const typed = value as Record<string, unknown>;
            if (typeof typed.qfmt !== "string" || typeof typed.afmt !== "string") {
                return null;
            }

            return {
                ord: typeof typed.ord === "number" ? typed.ord : index,
                qfmt: typed.qfmt,
                afmt: typed.afmt,
            };
        })
        .filter((template): template is NonNullable<typeof template> => template !== null)
        .sort((left, right) => left.ord - right.ord);

    if (normalized.length === 0) {
        return null;
    }

    return normalized.find((template) => template.ord === ord) ?? normalized[Math.min(ord, normalized.length - 1)] ?? null;
}

export const SEARCH_QUEUE_LABELS: Record<number, string> = {
    [-3]: "Sched buried",
    [-2]: "User buried",
    [-1]: "Suspended",
    0: "New",
    1: "Learning",
    2: "Review",
    3: "Relearning",
    4: "Preview",
};

export function queueToLabel(queue: number): string {
    return SEARCH_QUEUE_LABELS[queue] ?? `Queue ${queue}`;
}
