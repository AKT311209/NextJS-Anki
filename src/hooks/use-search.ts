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

export type SearchStateFilter = "due" | "new" | "learning" | "review" | "suspended" | "buried" | "flagged" | "leech";

export interface SearchSort {
    readonly field: SearchSortField;
    readonly direction: "asc" | "desc";
}

export interface SearchDeckFacet {
    readonly id: number;
    readonly name: string;
}

export interface SearchNotetypeFacet {
    readonly id: number;
    readonly name: string;
}

export interface SearchTagFacet {
    readonly name: string;
    readonly count: number;
}

export interface SearchFacets {
    readonly decks: readonly SearchDeckFacet[];
    readonly notetypes: readonly SearchNotetypeFacet[];
    readonly tags: readonly SearchTagFacet[];
}

export interface SearchFilters {
    readonly deckIds: readonly number[];
    readonly notetypeIds: readonly number[];
    readonly tags: readonly string[];
    readonly states: readonly SearchStateFilter[];
    readonly flags: readonly number[];
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
    readonly setPageSize: (pageSize: number) => void;
    readonly sort: SearchSort;
    readonly filters: SearchFilters;
    readonly facets: SearchFacets;
    readonly setDeckFilters: (deckIds: readonly number[]) => void;
    readonly setNotetypeFilters: (notetypeIds: readonly number[]) => void;
    readonly setTagFilters: (tags: readonly string[]) => void;
    readonly setStateFilters: (states: readonly SearchStateFilter[]) => void;
    readonly setFlagFilters: (flags: readonly number[]) => void;
    readonly clearFilters: () => void;
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

interface TagQueryRow {
    readonly tags: string;
}

interface SqlFragment {
    readonly whereSql: string;
    readonly params: readonly (string | number)[];
}

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 500;
const TAG_FACET_SOURCE_LIMIT = 5000;
const TAG_FACET_RESULT_LIMIT = 60;
const VALID_STATE_FILTERS: readonly SearchStateFilter[] = [
    "due",
    "new",
    "learning",
    "review",
    "suspended",
    "buried",
    "flagged",
    "leech",
];

export function useSearch(initialQuery = ""): UseSearchResult {
    const collection = useCollection();

    const [query, setQueryState] = useState(initialQuery);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<SearchCardResult[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
    const [filters, setFilters] = useState<SearchFilters>(() => createEmptySearchFilters());
    const [facets, setFacets] = useState<SearchFacets>({
        decks: [],
        notetypes: [],
        tags: [],
    });
    const [sort, setSort] = useState<SearchSort>({
        field: "due",
        direction: "asc",
    });

    const setQuery = useCallback((nextQuery: string) => {
        setPage(1);
        setQueryState(nextQuery);
    }, []);

    const setPageSize = useCallback((nextPageSize: number) => {
        setPage(1);
        setPageSizeState(normalizePageSize(nextPageSize));
    }, []);

    const setDeckFilters = useCallback((deckIds: readonly number[]) => {
        setPage(1);
        setFilters((current) => ({
            ...current,
            deckIds: normalizeNumericFilters(deckIds),
        }));
    }, []);

    const setNotetypeFilters = useCallback((notetypeIds: readonly number[]) => {
        setPage(1);
        setFilters((current) => ({
            ...current,
            notetypeIds: normalizeNumericFilters(notetypeIds),
        }));
    }, []);

    const setTagFilters = useCallback((tags: readonly string[]) => {
        setPage(1);
        setFilters((current) => ({
            ...current,
            tags: normalizeStringFilters(tags),
        }));
    }, []);

    const setStateFilters = useCallback((states: readonly SearchStateFilter[]) => {
        setPage(1);
        setFilters((current) => ({
            ...current,
            states: normalizeStateFilters(states),
        }));
    }, []);

    const setFlagFilters = useCallback((flags: readonly number[]) => {
        setPage(1);
        setFilters((current) => ({
            ...current,
            flags: normalizeNumericFilters(flags).filter((flag) => flag >= 0 && flag <= 7),
        }));
    }, []);

    const clearFilters = useCallback(() => {
        setPage(1);
        setFilters(createEmptySearchFilters());
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

            const [deckList, notetypeList, tagRows] = await Promise.all([
                decks.list(),
                notetypes.list(),
                connection.select<TagQueryRow>(
                    `
                    SELECT tags
                    FROM notes
                    WHERE TRIM(tags) <> ''
                    LIMIT ?
                    `,
                    [TAG_FACET_SOURCE_LIMIT],
                ),
            ]);

            setFacets({
                decks: deckList.map((deck) => ({
                    id: deck.id,
                    name: deck.name,
                })),
                notetypes: notetypeList.map((notetype) => ({
                    id: notetype.id,
                    name: notetype.name,
                })),
                tags: buildTagFacets(tagRows),
            });

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
            const filterSql = buildSearchFilterSql(filters, context.now ?? new Date());
            const orderBy = resolveOrderBy(sort);
            const whereSql = combineWhereClauses(built.whereSql, filterSql.whereSql);
            const whereParams = [...built.params, ...filterSql.params];

            const countRow = await connection.get<CountRow>(
                `
                SELECT COUNT(*) AS total
                FROM cards c
                INNER JOIN notes n ON n.id = c.nid
                WHERE ${whereSql}
                `,
                whereParams,
            );

            const totalCount = Number(countRow?.total ?? 0);
            const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));
            const safePage = Math.min(Math.max(1, page), maxPage);
            const offset = (safePage - 1) * pageSize;

            if (safePage !== page) {
                setPage(safePage);
            }

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
                WHERE ${whereSql}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
                `,
                [...whereParams, pageSize, offset],
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
            setTotal(totalCount);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Search failed.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [collection.connection, collection.ready, filters, page, pageSize, query, sort]);

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
        setPageSize,
        sort,
        filters,
        facets,
        setDeckFilters,
        setNotetypeFilters,
        setTagFilters,
        setStateFilters,
        setFlagFilters,
        clearFilters,
        setPage,
        setSort,
        reload: executeSearch,
        applyBulkAction,
    };
}

function createEmptySearchFilters(): SearchFilters {
    return {
        deckIds: [],
        notetypeIds: [],
        tags: [],
        states: [],
        flags: [],
    };
}

function normalizePageSize(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_PAGE_SIZE;
    }

    const rounded = Math.trunc(value);
    if (rounded < MIN_PAGE_SIZE) {
        return MIN_PAGE_SIZE;
    }

    if (rounded > MAX_PAGE_SIZE) {
        return MAX_PAGE_SIZE;
    }

    return rounded;
}

function normalizeNumericFilters(values: readonly number[]): number[] {
    const unique = new Set<number>();
    for (const value of values) {
        if (!Number.isFinite(value)) {
            continue;
        }

        unique.add(Math.trunc(value));
    }

    return [...unique].sort((left, right) => left - right);
}

function normalizeStringFilters(values: readonly string[]): string[] {
    const unique = new Set<string>();
    for (const value of values) {
        const normalized = value.trim();
        if (normalized.length > 0) {
            unique.add(normalized);
        }
    }

    return [...unique].sort((left, right) => left.localeCompare(right));
}

function normalizeStateFilters(values: readonly SearchStateFilter[]): SearchStateFilter[] {
    const unique = new Set<SearchStateFilter>();
    for (const value of values) {
        if (VALID_STATE_FILTERS.includes(value)) {
            unique.add(value);
        }
    }

    return [...unique];
}

function buildTagFacets(rows: readonly TagQueryRow[]): SearchTagFacet[] {
    const counts = new Map<string, number>();

    for (const row of rows) {
        const raw = row.tags.trim();
        if (raw.length === 0) {
            continue;
        }

        for (const tag of raw.split(" ")) {
            const normalized = tag.trim();
            if (normalized.length === 0) {
                continue;
            }

            counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
    }

    return [...counts.entries()]
        .sort((left, right) => {
            if (right[1] !== left[1]) {
                return right[1] - left[1];
            }

            return left[0].localeCompare(right[0]);
        })
        .slice(0, TAG_FACET_RESULT_LIMIT)
        .map(([name, count]) => ({
            name,
            count,
        }));
}

function buildSearchFilterSql(filters: SearchFilters, now: Date): SqlFragment {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    const deckIds = normalizeNumericFilters(filters.deckIds);
    if (deckIds.length > 0) {
        const fragment = buildInSql("c.did", deckIds);
        clauses.push(fragment.whereSql);
        params.push(...fragment.params);
    }

    const notetypeIds = normalizeNumericFilters(filters.notetypeIds);
    if (notetypeIds.length > 0) {
        const fragment = buildInSql("n.mid", notetypeIds);
        clauses.push(fragment.whereSql);
        params.push(...fragment.params);
    }

    const tags = normalizeStringFilters(filters.tags);
    if (tags.length > 0) {
        clauses.push(`(${tags.map(() => "n.tags LIKE ? ESCAPE '\\\\'").join(" OR ")})`);
        params.push(...tags.map((tag) => `% ${escapeLikeSql(tag)} %`));
    }

    const states = normalizeStateFilters(filters.states);
    if (states.length > 0) {
        const fragments = states.map((state) => buildStateSql(state, now));
        clauses.push(`(${fragments.map((fragment) => `(${fragment.whereSql})`).join(" OR ")})`);
        params.push(...fragments.flatMap((fragment) => fragment.params));
    }

    const flags = normalizeNumericFilters(filters.flags).filter((flag) => flag >= 0 && flag <= 7);
    if (flags.length > 0) {
        const fragment = buildInSql("(c.flags & 7)", flags);
        clauses.push(fragment.whereSql);
        params.push(...fragment.params);
    }

    if (clauses.length === 0) {
        return {
            whereSql: "1 = 1",
            params: [],
        };
    }

    return {
        whereSql: clauses.map((clause) => `(${clause})`).join(" AND "),
        params,
    };
}

function buildStateSql(state: SearchStateFilter, now: Date): SqlFragment {
    const nowMs = now.getTime();
    const today = Math.floor(nowMs / 86_400_000);

    if (state === "due") {
        return {
            whereSql: "((c.queue = 1 AND c.due <= ?) OR (c.queue IN (2, 3) AND c.due <= ?))",
            params: [nowMs, today],
        };
    }

    if (state === "new") {
        return {
            whereSql: "c.queue = 0",
            params: [],
        };
    }

    if (state === "learning") {
        return {
            whereSql: "c.queue IN (1, 3)",
            params: [],
        };
    }

    if (state === "review") {
        return {
            whereSql: "c.queue = 2",
            params: [],
        };
    }

    if (state === "suspended") {
        return {
            whereSql: "c.queue = -1",
            params: [],
        };
    }

    if (state === "buried") {
        return {
            whereSql: "c.queue IN (-2, -3)",
            params: [],
        };
    }

    if (state === "flagged") {
        return {
            whereSql: "(c.flags & 7) > 0",
            params: [],
        };
    }

    return {
        whereSql: "(c.flags & 128) != 0",
        params: [],
    };
}

function buildInSql(column: string, values: readonly number[]): SqlFragment {
    if (values.length === 0) {
        return {
            whereSql: "1 = 1",
            params: [],
        };
    }

    return {
        whereSql: `${column} IN (${values.map(() => "?").join(", ")})`,
        params: values,
    };
}

function combineWhereClauses(base: string, extra: string): string {
    if (extra === "1 = 1") {
        return base;
    }

    if (base === "1 = 1") {
        return extra;
    }

    return `(${base}) AND (${extra})`;
}

function escapeLikeSql(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
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
