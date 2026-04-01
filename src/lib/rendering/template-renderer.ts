import { applyFilterPipeline } from "@/lib/rendering/filters";
import { clozeNumbersInText } from "@/lib/rendering/cloze";
import { renderMathInHtml, renderMathInHtmlSync } from "@/lib/rendering/math";
import { sanitizeHtml } from "@/lib/rendering/sanitizer";
import {
	parseTemplate,
	TemplateParseError,
	type TemplateNode,
	type TemplateReplacementNode,
} from "@/lib/rendering/template-parser";

const EMPTY_FIELD_PATTERN = /^(?:[\s]|<\/?(?:br|div)\s*\/?>)*$/i;

export interface TemplateRenderContext {
	readonly fields: Readonly<Record<string, string | null | undefined>>;
	readonly side?: "question" | "answer";
	readonly frontSide?: string;
	readonly clozeOrdinal?: number;
	readonly sanitize?: boolean;
	readonly preserveComments?: boolean;
	readonly strictFieldCheck?: boolean;
	readonly renderMath?: boolean;
}

export interface TemplateRenderResult {
	readonly html: string;
	readonly errors: readonly string[];
	readonly missingFields: readonly string[];
}

export interface RenderCardTemplateInput {
	readonly questionTemplate: string | readonly TemplateNode[];
	readonly answerTemplate: string | readonly TemplateNode[];
	readonly fields: Readonly<Record<string, string | null | undefined>>;
	readonly clozeOrdinal?: number;
	readonly sanitize?: boolean;
	readonly preserveComments?: boolean;
	readonly strictFieldCheck?: boolean;
	readonly renderMath?: boolean;
}

export interface RenderCardTemplateResult {
	readonly question: TemplateRenderResult;
	readonly answer: TemplateRenderResult;
}

interface RenderRuntime {
	readonly fields: Readonly<Record<string, string>>;
	readonly side: "question" | "answer";
	readonly frontSide: string;
	readonly clozeOrdinal: number;
	readonly strictFieldCheck: boolean;
	readonly preserveComments: boolean;
	readonly errors: string[];
	readonly missingFields: Set<string>;
	readonly availableClozeOrdinals: Set<number>;
}

export function renderTemplate(
	template: string | readonly TemplateNode[],
	context: TemplateRenderContext,
): TemplateRenderResult {
	const result = renderTemplateCore(template, context);

	let html = result.html;
	if (context.sanitize ?? true) {
		html = sanitizeHtml(html, {
			preserveComments: context.preserveComments ?? true,
		});
	}

	if (context.renderMath ?? false) {
		html = renderMathInHtmlSync(html);
	}

	return {
		html,
		errors: result.errors,
		missingFields: result.missingFields,
	};
}

export async function renderTemplateAsync(
	template: string | readonly TemplateNode[],
	context: TemplateRenderContext,
): Promise<TemplateRenderResult> {
	const result = renderTemplateCore(template, context);

	let html = result.html;
	if (context.sanitize ?? true) {
		html = sanitizeHtml(html, {
			preserveComments: context.preserveComments ?? true,
		});
	}

	if (context.renderMath ?? false) {
		html = await renderMathInHtml(html);
	}

	return {
		html,
		errors: result.errors,
		missingFields: result.missingFields,
	};
}

export function renderCardTemplates(input: RenderCardTemplateInput): RenderCardTemplateResult {
	const question = renderTemplate(input.questionTemplate, {
		fields: input.fields,
		side: "question",
		clozeOrdinal: input.clozeOrdinal,
		sanitize: input.sanitize,
		preserveComments: input.preserveComments,
		strictFieldCheck: input.strictFieldCheck,
		renderMath: input.renderMath,
	});

	const answer = renderTemplate(input.answerTemplate, {
		fields: input.fields,
		side: "answer",
		frontSide: question.html,
		clozeOrdinal: input.clozeOrdinal,
		sanitize: input.sanitize,
		preserveComments: input.preserveComments,
		strictFieldCheck: input.strictFieldCheck,
		renderMath: input.renderMath,
	});

	return {
		question,
		answer,
	};
}

export async function renderCardTemplatesAsync(input: RenderCardTemplateInput): Promise<RenderCardTemplateResult> {
	const question = await renderTemplateAsync(input.questionTemplate, {
		fields: input.fields,
		side: "question",
		clozeOrdinal: input.clozeOrdinal,
		sanitize: input.sanitize,
		preserveComments: input.preserveComments,
		strictFieldCheck: input.strictFieldCheck,
		renderMath: input.renderMath,
	});

	const answer = await renderTemplateAsync(input.answerTemplate, {
		fields: input.fields,
		side: "answer",
		frontSide: question.html,
		clozeOrdinal: input.clozeOrdinal,
		sanitize: input.sanitize,
		preserveComments: input.preserveComments,
		strictFieldCheck: input.strictFieldCheck,
		renderMath: input.renderMath,
	});

	return {
		question,
		answer,
	};
}

export function fieldIsEmpty(value: string): boolean {
	return EMPTY_FIELD_PATTERN.test(value);
}

function renderTemplateCore(
	template: string | readonly TemplateNode[],
	context: TemplateRenderContext,
): TemplateRenderResult {
	let parsedNodes: readonly TemplateNode[];
	const errors: string[] = [];

	try {
		parsedNodes = typeof template === "string"
			? parseTemplate(template, {
				preserveComments: context.preserveComments ?? true,
			})
			: template;
	} catch (error) {
		if (error instanceof TemplateParseError) {
			return {
				html: "",
				errors: [`${error.code}: ${error.message}`],
				missingFields: [],
			};
		}

		const message = error instanceof Error ? error.message : "Unknown template parse error.";
		return {
			html: "",
			errors: [message],
			missingFields: [],
		};
	}

	const runtime: RenderRuntime = {
		fields: normalizeFields(context.fields),
		side: context.side ?? "question",
		frontSide: context.frontSide ?? "",
		clozeOrdinal: Math.max(1, Math.trunc(context.clozeOrdinal ?? 1)),
		strictFieldCheck: context.strictFieldCheck ?? false,
		preserveComments: context.preserveComments ?? true,
		errors,
		missingFields: new Set<string>(),
		availableClozeOrdinals: collectClozeOrdinals(context.fields),
	};

	const html = renderNodes(parsedNodes, runtime);
	return {
		html,
		errors,
		missingFields: [...runtime.missingFields].sort((left, right) => left.localeCompare(right)),
	};
}

function renderNodes(nodes: readonly TemplateNode[], runtime: RenderRuntime): string {
	let output = "";

	for (const node of nodes) {
		switch (node.type) {
			case "text":
				output += node.value;
				break;
			case "comment":
				if (runtime.preserveComments) {
					output += `<!--${node.value}-->`;
				}
				break;
			case "replacement":
				output += renderReplacement(node, runtime);
				break;
			case "conditional":
				if (evaluateConditional(node.key, runtime)) {
					output += renderNodes(node.children, runtime);
				}
				break;
			case "negated-conditional":
				if (!evaluateConditional(node.key, runtime)) {
					output += renderNodes(node.children, runtime);
				}
				break;
		}
	}

	return output;
}

function renderReplacement(node: TemplateReplacementNode, runtime: RenderRuntime): string {
	if (node.key === "FrontSide") {
		return runtime.frontSide;
	}

	let fieldKey = node.key;
	let filterChain = [...node.filters];
	let fieldValue: string | undefined = runtime.fields[fieldKey];

	if (fieldValue === undefined && node.filters.length > 0) {
		const suffixNotationParts = [...node.filters].reverse();
		const candidateField = suffixNotationParts[0] ?? "";
		const candidateFieldValue = runtime.fields[candidateField];

		if (candidateField.length > 0 && candidateFieldValue !== undefined) {
			fieldKey = candidateField;
			fieldValue = candidateFieldValue;
			filterChain = [...suffixNotationParts.slice(1), node.key].filter((filter) => filter.length > 0);
		}
	}

	if (fieldValue === undefined) {
		if (fieldKey.length > 0 || filterChain.length === 0) {
			runtime.missingFields.add(fieldKey || node.key);
			if (runtime.strictFieldCheck) {
				runtime.errors.push(`Unknown field referenced in template: "${fieldKey || node.key}".`);
			}
		}
		fieldValue = "";
	}

	return applyFilterPipeline(fieldValue, filterChain, {
		fieldName: fieldKey,
		side: runtime.side,
		clozeOrdinal: runtime.clozeOrdinal,
	});
}

function evaluateConditional(key: string, runtime: RenderRuntime): boolean {
	if (isClozeConditional(key)) {
		const ordinal = Number.parseInt(key.slice(1), 10);
		return runtime.availableClozeOrdinals.has(ordinal);
	}

	const fieldValue = runtime.fields[key];
	if (fieldValue === undefined) {
		if (runtime.strictFieldCheck) {
			runtime.errors.push(`Unknown conditional field referenced in template: "${key}".`);
		}
		return false;
	}

	return !fieldIsEmpty(fieldValue);
}

function collectClozeOrdinals(fields: Readonly<Record<string, string | null | undefined>>): Set<number> {
	const ordinals = new Set<number>();

	for (const value of Object.values(fields)) {
		if (!value) {
			continue;
		}

		for (const ordinal of clozeNumbersInText(value)) {
			ordinals.add(ordinal);
		}
	}

	return ordinals;
}

function normalizeFields(fields: Readonly<Record<string, string | null | undefined>>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		normalized[key] = value ?? "";
	}
	return normalized;
}

function isClozeConditional(key: string): boolean {
	return /^c\d+$/.test(key.trim());
}
