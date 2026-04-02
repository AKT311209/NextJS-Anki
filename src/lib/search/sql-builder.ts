import {
	createAllNode,
	type SearchNode,
} from "@/lib/search/nodes";

export interface SearchSqlBuilderContext {
	readonly now?: Date;
	readonly resolveDeckIds?: (query: string) => readonly number[];
	readonly resolveNotetypeIds?: (query: string) => readonly number[];
}

export interface SearchSqlBuildResult {
	readonly whereSql: string;
	readonly params: readonly (string | number)[];
}

interface CompiledSql {
	readonly sql: string;
	readonly params: readonly (string | number)[];
}

export function buildSearchSql(
	node: SearchNode,
	context: SearchSqlBuilderContext = {},
): SearchSqlBuildResult {
	const root = node ?? createAllNode();
	const compiled = compileNode(root, context);

	return {
		whereSql: compiled.sql,
		params: compiled.params,
	};
}

function compileNode(node: SearchNode, context: SearchSqlBuilderContext): CompiledSql {
	if (node.type === "all") {
		return {
			sql: "1 = 1",
			params: [],
		};
	}

	if (node.type === "and") {
		if (node.children.length === 0) {
			return {
				sql: "1 = 1",
				params: [],
			};
		}

		const children = node.children.map((child) => compileNode(child, context));
		return {
			sql: children.map((child) => `(${child.sql})`).join(" AND "),
			params: children.flatMap((child) => child.params),
		};
	}

	if (node.type === "or") {
		if (node.children.length === 0) {
			return {
				sql: "1 = 1",
				params: [],
			};
		}

		const children = node.children.map((child) => compileNode(child, context));
		return {
			sql: children.map((child) => `(${child.sql})`).join(" OR "),
			params: children.flatMap((child) => child.params),
		};
	}

	if (node.type === "not") {
		const child = compileNode(node.child, context);
		return {
			sql: `NOT (${child.sql})`,
			params: child.params,
		};
	}

	if (node.type === "term") {
		const value = `%${escapeLike(node.value)}%`;
		return {
			sql: "(n.flds LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')",
			params: [value, value],
		};
	}

	if (node.type === "deck") {
		const ids = context.resolveDeckIds?.(node.value) ?? [];
		return inClause("c.did", ids);
	}

	if (node.type === "note") {
		const ids = context.resolveNotetypeIds?.(node.value) ?? [];
		return inClause("n.mid", ids);
	}

	if (node.type === "tag") {
		const normalized = node.value.trim();
		if (normalized.length === 0) {
			return {
				sql: "1 = 1",
				params: [],
			};
		}

		return {
			sql: "n.tags LIKE ? ESCAPE '\\'",
			params: [`% ${escapeLike(normalized)} %`],
		};
	}

	if (node.type === "is") {
		return compileIsNode(node.value, context.now ?? new Date());
	}

	if (node.type === "flag") {
		return {
			sql: "(c.flags & 7) = ?",
			params: [Math.max(0, Math.min(7, node.value))],
		};
	}

	if (node.type === "card-id") {
		return {
			sql: "c.id = ?",
			params: [node.value],
		};
	}

	if (node.type === "note-id") {
		return {
			sql: "n.id = ?",
			params: [node.value],
		};
	}

	if (node.type === "deck-id") {
		return {
			sql: "c.did = ?",
			params: [node.value],
		};
	}

	return {
		sql: "n.mid = ?",
		params: [node.value],
	};
}

function compileIsNode(value: string, now: Date): CompiledSql {
	const normalized = value.trim().toLowerCase();
	const nowMs = now.getTime();
	const today = Math.floor(nowMs / 86_400_000);

	if (normalized === "due") {
		return {
			sql: "((c.queue = 1 AND c.due <= ?) OR (c.queue IN (2, 3) AND c.due <= ?))",
			params: [nowMs, today],
		};
	}

	if (normalized === "new") {
		return {
			sql: "c.queue = 0",
			params: [],
		};
	}

	if (normalized === "learn" || normalized === "learning") {
		return {
			sql: "c.queue IN (1, 3)",
			params: [],
		};
	}

	if (normalized === "review") {
		return {
			sql: "c.queue = 2",
			params: [],
		};
	}

	if (normalized === "suspended") {
		return {
			sql: "c.queue = -1",
			params: [],
		};
	}

	if (normalized === "buried") {
		return {
			sql: "c.queue IN (-2, -3)",
			params: [],
		};
	}

	if (normalized === "flagged") {
		return {
			sql: "(c.flags & 7) > 0",
			params: [],
		};
	}

	if (normalized === "leech") {
		return {
			sql: "(c.flags & 128) != 0",
			params: [],
		};
	}

	return {
		sql: "1 = 0",
		params: [],
	};
}

function inClause(column: string, ids: readonly number[]): CompiledSql {
	if (ids.length === 0) {
		return {
			sql: "1 = 0",
			params: [],
		};
	}

	const placeholders = ids.map(() => "?").join(", ");
	return {
		sql: `${column} IN (${placeholders})`,
		params: ids,
	};
}

function escapeLike(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
