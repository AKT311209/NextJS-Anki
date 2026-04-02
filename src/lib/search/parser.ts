import {
	createAllNode,
	type SearchAndNode,
	type SearchNode,
	type SearchNotNode,
	type SearchOrNode,
} from "@/lib/search/nodes";

export function parseSearchQuery(query: string): SearchNode {
	const normalized = query.trim();
	if (normalized.length === 0) {
		return createAllNode("");
	}

	const tokens = tokenizeQuery(normalized);
	if (tokens.length === 0) {
		return createAllNode(normalized);
	}

	const groups: SearchNode[][] = [[]];

	for (const token of tokens) {
		if (isOrToken(token)) {
			if (groups[groups.length - 1].length > 0) {
				groups.push([]);
			}
			continue;
		}

		groups[groups.length - 1].push(parseToken(token));
	}

	const compact = groups.filter((group) => group.length > 0);
	if (compact.length === 0) {
		return createAllNode(normalized);
	}

	if (compact.length === 1) {
		return foldAnd(compact[0], normalized);
	}

	const node: SearchOrNode = {
		type: "or",
		raw: normalized,
		children: compact.map((group) => foldAnd(group, normalized)),
	};
	return node;
}

function parseToken(token: string): SearchNode {
	if (token.length === 0) {
		return createAllNode(token);
	}

	if (token.startsWith("-") && token.length > 1) {
		const child = parseToken(token.slice(1));
		const negated: SearchNotNode = {
			type: "not",
			raw: token,
			child,
		};
		return negated;
	}

	const colonIndex = token.indexOf(":");
	if (colonIndex <= 0 || colonIndex >= token.length - 1) {
		return {
			type: "term",
			raw: token,
			value: stripWrappingQuotes(token),
		};
	}

	const key = token.slice(0, colonIndex).trim().toLowerCase();
	const rawValue = token.slice(colonIndex + 1);
	const value = stripWrappingQuotes(rawValue.trim());

	if (value.length === 0) {
		return {
			type: "term",
			raw: token,
			value: stripWrappingQuotes(token),
		};
	}

	if (key === "deck") {
		return {
			type: "deck",
			raw: token,
			value,
		};
	}

	if (key === "note") {
		return {
			type: "note",
			raw: token,
			value,
		};
	}

	if (key === "tag") {
		return {
			type: "tag",
			raw: token,
			value,
		};
	}

	if (key === "is") {
		return {
			type: "is",
			raw: token,
			value: value.toLowerCase(),
		};
	}

	if (key === "flag") {
		const numeric = Number.parseInt(value, 10);
		if (Number.isFinite(numeric)) {
			return {
				type: "flag",
				raw: token,
				value: Math.max(0, Math.min(7, numeric)),
			};
		}
	}

	const numeric = Number.parseInt(value, 10);
	if (Number.isFinite(numeric)) {
		if (key === "cid" || key === "card") {
			return {
				type: "card-id",
				raw: token,
				value: numeric,
			};
		}

		if (key === "nid") {
			return {
				type: "note-id",
				raw: token,
				value: numeric,
			};
		}

		if (key === "did") {
			return {
				type: "deck-id",
				raw: token,
				value: numeric,
			};
		}

		if (key === "mid") {
			return {
				type: "notetype-id",
				raw: token,
				value: numeric,
			};
		}
	}

	return {
		type: "term",
		raw: token,
		value: stripWrappingQuotes(token),
	};
}

function foldAnd(nodes: readonly SearchNode[], raw: string): SearchNode {
	if (nodes.length === 0) {
		return createAllNode(raw);
	}

	if (nodes.length === 1) {
		return nodes[0];
	}

	const andNode: SearchAndNode = {
		type: "and",
		raw,
		children: nodes,
	};

	return andNode;
}

function tokenizeQuery(query: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let index = 0; index < query.length; index += 1) {
		const character = query[index];

		if (quote) {
			if (character === "\\" && index + 1 < query.length) {
				current += query[index + 1];
				index += 1;
				continue;
			}

			if (character === quote) {
				quote = null;
				continue;
			}

			current += character;
			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}

		if (/\s/.test(character)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += character;
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

function isOrToken(token: string): boolean {
	const normalized = token.trim().toLowerCase();
	return normalized === "or" || normalized === "|";
}

function stripWrappingQuotes(value: string): string {
	if (value.length < 2) {
		return value;
	}

	const first = value[0];
	const last = value[value.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1);
	}

	return value;
}
