const DEFAULT_OPEN_DELIMITER = "{{";
const DEFAULT_CLOSE_DELIMITER = "}}";
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const LEGACY_ALT_DELIMITER_DIRECTIVE = "{{=<% %>=}}";

export type TemplateNode =
	| TemplateTextNode
	| TemplateCommentNode
	| TemplateReplacementNode
	| TemplateConditionalNode
	| TemplateNegatedConditionalNode;

export interface TemplateTextNode {
	readonly type: "text";
	readonly value: string;
}

export interface TemplateCommentNode {
	readonly type: "comment";
	readonly value: string;
}

export interface TemplateReplacementNode {
	readonly type: "replacement";
	readonly key: string;
	readonly filters: readonly string[];
	readonly raw: string;
}

export interface TemplateConditionalNode {
	readonly type: "conditional";
	readonly key: string;
	readonly children: readonly TemplateNode[];
}

export interface TemplateNegatedConditionalNode {
	readonly type: "negated-conditional";
	readonly key: string;
	readonly children: readonly TemplateNode[];
}

export interface ParseTemplateOptions {
	readonly preserveComments?: boolean;
}

export type TemplateParseErrorCode =
	| "UNCLOSED_TAG"
	| "CONDITIONAL_NOT_OPEN"
	| "CONDITIONAL_NOT_CLOSED"
	| "CONDITIONAL_MISMATCH"
	| "INVALID_DELIMITERS";

export class TemplateParseError extends Error {
	public readonly code: TemplateParseErrorCode;
	public readonly position: number;

	public constructor(code: TemplateParseErrorCode, message: string, position: number) {
		super(message);
		this.name = "TemplateParseError";
		this.code = code;
		this.position = position;
	}
}

interface ParseState {
	readonly source: string;
	readonly preserveComments: boolean;
	index: number;
	openDelimiter: string;
	closeDelimiter: string;
}

export function parseTemplate(template: string, options: ParseTemplateOptions = {}): TemplateNode[] {
	let source = template;
	let openDelimiter = DEFAULT_OPEN_DELIMITER;
	let closeDelimiter = DEFAULT_CLOSE_DELIMITER;

	const trimmedStart = source.trimStart();
	if (trimmedStart.startsWith(LEGACY_ALT_DELIMITER_DIRECTIVE)) {
		source = trimmedStart.slice(LEGACY_ALT_DELIMITER_DIRECTIVE.length);
		openDelimiter = "<%";
		closeDelimiter = "%>";
	}

	const state: ParseState = {
		source,
		preserveComments: options.preserveComments ?? true,
		index: 0,
		openDelimiter,
		closeDelimiter,
	};

	return parseNodes(state);
}

export function stringifyTemplate(nodes: readonly TemplateNode[]): string {
	return nodes.map((node) => stringifyNode(node)).join("");
}

function parseNodes(state: ParseState, openConditional?: string): TemplateNode[] {
	const nodes: TemplateNode[] = [];

	while (state.index < state.source.length) {
		const nextDelimiter = state.source.indexOf(state.openDelimiter, state.index);
		const nextComment = state.source.indexOf(COMMENT_OPEN, state.index);
		const nextTokenIndex = smallestPositive(nextDelimiter, nextComment);

		if (nextTokenIndex === -1) {
			appendTextNode(nodes, state.source.slice(state.index));
			state.index = state.source.length;
			break;
		}

		if (nextTokenIndex > state.index) {
			appendTextNode(nodes, state.source.slice(state.index, nextTokenIndex));
			state.index = nextTokenIndex;
		}

		if (nextComment !== -1 && nextComment === state.index && (nextDelimiter === -1 || nextComment < nextDelimiter)) {
			const commentEnd = state.source.indexOf(COMMENT_CLOSE, state.index + COMMENT_OPEN.length);
			if (commentEnd === -1) {
				appendTextNode(nodes, state.source.slice(state.index));
				state.index = state.source.length;
				break;
			}

			if (state.preserveComments) {
				nodes.push({
					type: "comment",
					value: state.source.slice(state.index + COMMENT_OPEN.length, commentEnd),
				});
			}

			state.index = commentEnd + COMMENT_CLOSE.length;
			continue;
		}

		if (nextDelimiter !== -1 && nextDelimiter === state.index) {
			const tagStart = state.index + state.openDelimiter.length;
			const tagEnd = state.source.indexOf(state.closeDelimiter, tagStart);
			if (tagEnd === -1) {
				throw new TemplateParseError(
					"UNCLOSED_TAG",
					`No closing delimiter for template tag starting at index ${state.index}.`,
					state.index,
				);
			}

			const rawTag = state.source.slice(tagStart, tagEnd).trim();
			state.index = tagEnd + state.closeDelimiter.length;

			if (maybeUpdateDelimiters(rawTag, state)) {
				continue;
			}

			if (rawTag.startsWith("#")) {
				const key = rawTag.slice(1).trim();
				nodes.push({
					type: "conditional",
					key,
					children: parseNodes(state, key),
				});
				continue;
			}

			if (rawTag.startsWith("^")) {
				const key = rawTag.slice(1).trim();
				nodes.push({
					type: "negated-conditional",
					key,
					children: parseNodes(state, key),
				});
				continue;
			}

			if (rawTag.startsWith("/")) {
				const key = rawTag.slice(1).trim();

				if (!openConditional) {
					throw new TemplateParseError(
						"CONDITIONAL_NOT_OPEN",
						`Found closing conditional "${key}" without a matching opening tag.`,
						state.index,
					);
				}

				if (key !== openConditional) {
					throw new TemplateParseError(
						"CONDITIONAL_MISMATCH",
						`Attempted to close conditional "${key}", but "${openConditional}" is currently open.`,
						state.index,
					);
				}

				return nodes;
			}

			nodes.push(parseReplacement(rawTag));
			continue;
		}
	}

	if (openConditional) {
		throw new TemplateParseError(
			"CONDITIONAL_NOT_CLOSED",
			`Conditional "${openConditional}" was not closed.`,
			state.index,
		);
	}

	return nodes;
}

function parseReplacement(rawTag: string): TemplateReplacementNode {
	const segments = rawTag.split(":").map((segment) => segment.trim());
	const key = segments.at(-1) ?? "";
	const filters = segments.slice(0, -1).reverse();

	return {
		type: "replacement",
		key,
		filters,
		raw: rawTag,
	};
}

function maybeUpdateDelimiters(rawTag: string, state: ParseState): boolean {
	if (!rawTag.startsWith("=") || !rawTag.endsWith("=")) {
		return false;
	}

	const content = rawTag.slice(1, -1).trim();
	const delimiterParts = content.split(/\s+/).filter((part) => part.length > 0);
	if (delimiterParts.length !== 2) {
		throw new TemplateParseError(
			"INVALID_DELIMITERS",
			`Invalid delimiter directive "${rawTag}". Expected format {{=<% %>=}}.`,
			state.index,
		);
	}

	state.openDelimiter = delimiterParts[0];
	state.closeDelimiter = delimiterParts[1];
	return true;
}

function appendTextNode(nodes: TemplateNode[], value: string): void {
	if (!value) {
		return;
	}

	const lastNode = nodes.at(-1);
	if (lastNode?.type === "text") {
		nodes[nodes.length - 1] = {
			type: "text",
			value: `${lastNode.value}${value}`,
		};
		return;
	}

	nodes.push({
		type: "text",
		value,
	});
}

function smallestPositive(left: number, right: number): number {
	if (left === -1) {
		return right;
	}
	if (right === -1) {
		return left;
	}
	return Math.min(left, right);
}

function stringifyNode(node: TemplateNode): string {
	switch (node.type) {
		case "text":
			return node.value;
		case "comment":
			return `${COMMENT_OPEN}${node.value}${COMMENT_CLOSE}`;
		case "replacement": {
			const raw = node.raw || [...node.filters].reverse().concat(node.key).join(":");
			return `{{${raw}}}`;
		}
		case "conditional":
			return `{{#${node.key}}}${stringifyTemplate(node.children)}{{/${node.key}}}`;
		case "negated-conditional":
			return `{{^${node.key}}}${stringifyTemplate(node.children)}{{/${node.key}}}`;
	}
}
