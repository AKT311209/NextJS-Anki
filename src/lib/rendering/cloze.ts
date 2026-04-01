export type ClozeNode = ClozeTextNode | ClozeDeletionNode;

export interface ClozeTextNode {
	readonly type: "text";
	readonly value: string;
}

export interface ClozeDeletionNode {
	readonly type: "cloze";
	readonly ordinals: readonly number[];
	readonly children: readonly ClozeNode[];
	readonly hint?: string;
}

export interface RenderClozeOptions {
	readonly clozeOrdinal: number;
	readonly side?: "question" | "answer";
	readonly blankIfMissingActive?: boolean;
}

export interface RenderClozeResult {
	readonly html: string;
	readonly hasActiveCloze: boolean;
	readonly ordinals: readonly number[];
}

interface MutableClozeNode {
	readonly type: "cloze";
	readonly ordinals: number[];
	readonly children: ClozeNode[];
	hint?: string;
}

export function parseClozeNodes(text: string): ClozeNode[] {
	const output: ClozeNode[] = [];
	const stack: MutableClozeNode[] = [];
	let index = 0;

	while (index < text.length) {
		const openCloze = parseOpenCloze(text, index);
		if (openCloze) {
			stack.push({
				type: "cloze",
				ordinals: openCloze.ordinals,
				children: [],
			});
			index = openCloze.nextIndex;
			continue;
		}

		if (text.startsWith("}}", index)) {
			if (stack.length === 0) {
				appendTextNode(output, "}}");
			} else {
				const current = stack.pop();
				if (current) {
					const finalizedNode: ClozeDeletionNode = {
						type: "cloze",
						ordinals: current.ordinals,
						children: current.children,
						hint: current.hint,
					};

					const parent = stack.at(-1);
					if (parent) {
						parent.children.push(finalizedNode);
					} else {
						output.push(finalizedNode);
					}
				}
			}
			index += 2;
			continue;
		}

		const nextOpen = text.indexOf("{{c", index);
		const nextClose = text.indexOf("}}", index);
		const boundary = smallestPositive(nextOpen, nextClose, text.length);
		const segment = text.slice(index, boundary);
		const current = stack.at(-1);

		if (!current) {
			appendTextNode(output, segment);
		} else if (current.hint === undefined) {
			const hintStart = segment.indexOf("::");
			if (hintStart === -1) {
				appendTextNode(current.children, segment);
			} else {
				appendTextNode(current.children, segment.slice(0, hintStart));
				current.hint = segment.slice(hintStart + 2);
			}
		} else {
			appendTextNode(current.children, segment);
		}

		index = boundary;
	}

	while (stack.length > 0) {
		const dangling = stack.pop();
		if (!dangling) {
			break;
		}

		appendTextNode(output, serializeDanglingCloze(dangling));
	}

	return output;
}

export function clozeNumbersInText(text: string): number[] {
	const ordinals = new Set<number>();

	const visit = (nodes: readonly ClozeNode[]): void => {
		for (const node of nodes) {
			if (node.type === "text") {
				continue;
			}

			for (const ordinal of node.ordinals) {
				if (ordinal > 0) {
					ordinals.add(ordinal);
				}
			}

			visit(node.children);
		}
	};

	visit(parseClozeNodes(text));
	return [...ordinals].sort((left, right) => left - right);
}

export function renderClozeText(text: string, options: RenderClozeOptions): RenderClozeResult {
	const side = options.side ?? "question";
	const ordinals = clozeNumbersInText(text);
	const activeOrdinal = Math.max(1, Math.trunc(options.clozeOrdinal));

	let hasActiveCloze = false;

	const renderNode = (node: ClozeNode): string => {
		if (node.type === "text") {
			return node.value;
		}

		const active = node.ordinals.includes(activeOrdinal);
		hasActiveCloze = hasActiveCloze || active;

		const innerHtml = node.children.map(renderNode).join("");
		const ordinalAttribute = encodeHtmlAttribute(node.ordinals.join(","));

		if (side === "question" && active) {
			const hint = node.hint && node.hint.trim().length > 0 ? node.hint : "...";
			return `<span class="cloze" data-cloze="${encodeHtmlAttribute(innerHtml)}" data-ordinal="${ordinalAttribute}">[${escapeHtml(hint)}]</span>`;
		}

		if (side === "answer" && active) {
			return `<span class="cloze" data-ordinal="${ordinalAttribute}">${innerHtml}</span>`;
		}

		return `<span class="cloze-inactive" data-ordinal="${ordinalAttribute}">${innerHtml}</span>`;
	};

	const html = parseClozeNodes(text).map(renderNode).join("");
	if ((options.blankIfMissingActive ?? true) && !hasActiveCloze) {
		return {
			html: "",
			hasActiveCloze,
			ordinals,
		};
	}

	return {
		html,
		hasActiveCloze,
		ordinals,
	};
}

export function revealClozeTextOnly(text: string, options: RenderClozeOptions): string {
	const activeOrdinal = Math.max(1, Math.trunc(options.clozeOrdinal));
	const side = options.side ?? "question";
	const output: string[] = [];

	const collect = (node: ClozeNode): void => {
		if (node.type === "text") {
			return;
		}

		if (node.ordinals.includes(activeOrdinal)) {
			if (side === "question") {
				output.push(node.hint && node.hint.trim().length > 0 ? node.hint : "...");
			} else {
				output.push(flattenNodeText(node.children));
			}
		}

		for (const child of node.children) {
			collect(child);
		}
	};

	for (const node of parseClozeNodes(text)) {
		collect(node);
	}

	return output.join(", ");
}

function parseOpenCloze(
	source: string,
	startIndex: number,
): { readonly ordinals: number[]; readonly nextIndex: number } | null {
	if (!source.startsWith("{{c", startIndex)) {
		return null;
	}

	let cursor = startIndex + 3;
	while (cursor < source.length && /[\d,]/.test(source[cursor])) {
		cursor += 1;
	}

	const ordinalChunk = source.slice(startIndex + 3, cursor);
	if (ordinalChunk.length === 0 || !source.startsWith("::", cursor)) {
		return null;
	}

	const ordinals = [...new Set(
		ordinalChunk
			.split(",")
			.map((part) => Number.parseInt(part, 10))
			.filter((value) => Number.isFinite(value) && value >= 0),
	)].sort((left, right) => left - right);

	if (ordinals.length === 0) {
		return null;
	}

	return {
		ordinals,
		nextIndex: cursor + 2,
	};
}

function appendTextNode(nodes: ClozeNode[], value: string): void {
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

function flattenNodeText(nodes: readonly ClozeNode[]): string {
	let text = "";
	for (const node of nodes) {
		if (node.type === "text") {
			text += node.value;
			continue;
		}

		text += flattenNodeText(node.children);
	}
	return text;
}

function smallestPositive(left: number, right: number, fallback: number): number {
	if (left === -1 && right === -1) {
		return fallback;
	}
	if (left === -1) {
		return right;
	}
	if (right === -1) {
		return left;
	}
	return Math.min(left, right);
}

function serializeDanglingCloze(node: MutableClozeNode): string {
	const body = node.children
		.map((child) => child.type === "text" ? child.value : serializeClozeNode(child))
		.join("");
	const hint = node.hint !== undefined ? `::${node.hint}` : "";
	return `{{c${node.ordinals.join(",")}::${body}${hint}}}`;
}

function serializeClozeNode(node: ClozeDeletionNode): string {
	const body = node.children
		.map((child) => child.type === "text" ? child.value : serializeClozeNode(child))
		.join("");
	const hint = node.hint !== undefined ? `::${node.hint}` : "";
	return `{{c${node.ordinals.join(",")}::${body}${hint}}}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function encodeHtmlAttribute(value: string): string {
	return escapeHtml(value);
}
