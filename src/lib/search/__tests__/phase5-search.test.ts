import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@/lib/search/parser";
import { buildSearchSql } from "@/lib/search/sql-builder";

describe("Phase 5 search system", () => {
    it("parses composite query into AND terms", () => {
        const ast = parseSearchQuery('deck:Default tag:geo is:due "capital city"');

        expect(ast.type).toBe("and");
        if (ast.type !== "and") {
            throw new Error("Expected AND node");
        }

        expect(ast.children.map((child) => child.type)).toEqual(["deck", "tag", "is", "term"]);
    });

    it("parses OR and negation operators", () => {
        const ast = parseSearchQuery("deck:languages OR -tag:suspended");

        expect(ast.type).toBe("or");
        if (ast.type !== "or") {
            throw new Error("Expected OR node");
        }

        expect(ast.children).toHaveLength(2);
        expect(ast.children[1]?.type).toBe("not");
    });

    it("builds SQL with resolver context for deck and notetype", () => {
        const ast = parseSearchQuery("deck:default note:basic is:due flag:3");
        const sql = buildSearchSql(ast, {
            now: new Date("2026-04-01T12:00:00.000Z"),
            resolveDeckIds: () => [1, 2],
            resolveNotetypeIds: () => [1001],
        });

        expect(sql.whereSql).toContain("c.did IN (?, ?)");
        expect(sql.whereSql).toContain("n.mid IN (?)");
        expect(sql.whereSql).toContain("(c.flags & 7) = ?");
        expect(sql.whereSql).toContain("c.queue");

        expect(sql.params).toContain(1);
        expect(sql.params).toContain(2);
        expect(sql.params).toContain(1001);
        expect(sql.params).toContain(3);
    });

    it("returns false branch for unknown is: filter", () => {
        const ast = parseSearchQuery("is:doesnotexist");
        const sql = buildSearchSql(ast);

        expect(sql.whereSql).toBe("1 = 0");
        expect(sql.params).toEqual([]);
    });
});
