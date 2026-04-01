const BLOCK_MATH_PATTERN = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_PATTERN = /\\\(([\s\S]+?)\\\)/g;

type KatexOutputMode = "html" | "mathml" | "htmlAndMathml";

interface KatexLike {
	renderToString(
		expression: string,
		options: {
			displayMode: boolean;
			throwOnError: boolean;
			output: KatexOutputMode;
			trust: boolean;
		},
	): string;
}

export interface MathRenderOptions {
	readonly throwOnError?: boolean;
	readonly output?: KatexOutputMode;
	readonly trust?: boolean;
}

let cachedKatexModule: KatexLike | null = null;
let katexLoadPromise: Promise<KatexLike | null> | null = null;
const renderCache = new Map<string, string>();

export async function preloadMathRenderer(): Promise<boolean> {
	const katex = await loadKatex();
	return katex !== null;
}

export async function renderMathInHtml(html: string, options: MathRenderOptions = {}): Promise<string> {
	const katex = await loadKatex();
	if (!katex) {
		return html;
	}

	return renderMathWithKatex(html, katex, options);
}

export function renderMathInHtmlSync(html: string, options: MathRenderOptions = {}): string {
	if (!cachedKatexModule) {
		return html;
	}

	return renderMathWithKatex(html, cachedKatexModule, options);
}

export function clearMathRenderCache(): void {
	renderCache.clear();
}

export function getMathRenderCacheSize(): number {
	return renderCache.size;
}

async function loadKatex(): Promise<KatexLike | null> {
	if (cachedKatexModule) {
		return cachedKatexModule;
	}

	if (!katexLoadPromise) {
		katexLoadPromise = import("katex")
			.then((module) => {
				const resolved = ("default" in module ? module.default : module) as unknown;
				if (resolved && typeof resolved === "object" && "renderToString" in resolved) {
					const katexCandidate = resolved as KatexLike;
					cachedKatexModule = katexCandidate;
					return katexCandidate;
				}
				return null;
			})
			.catch(() => null);
	}

	return katexLoadPromise;
}

function renderMathWithKatex(html: string, katex: KatexLike, options: MathRenderOptions): string {
	const inlineOutput = html.replace(INLINE_MATH_PATTERN, (_matched, expression) =>
		renderExpression(expression, false, katex, options),
	);

	return inlineOutput.replace(BLOCK_MATH_PATTERN, (_matched, expression) =>
		renderExpression(expression, true, katex, options),
	);
}

function renderExpression(
	expression: string,
	displayMode: boolean,
	katex: KatexLike,
	options: MathRenderOptions,
): string {
	const normalizedExpression = expression.trim();
	if (!normalizedExpression) {
		return displayMode ? "$$$$" : "\\(\\)";
	}

	const cacheKey = [
		displayMode ? "display" : "inline",
		normalizedExpression,
		options.output ?? "htmlAndMathml",
		options.throwOnError ? "throw" : "soft",
		options.trust ? "trust" : "safe",
	].join("::");

	const cachedOutput = renderCache.get(cacheKey);
	if (cachedOutput) {
		return cachedOutput;
	}

	const throwOnError = options.throwOnError ?? false;
	const output = options.output ?? "htmlAndMathml";
	const trust = options.trust ?? false;

	let rendered: string;
	try {
		rendered = katex.renderToString(normalizedExpression, {
			displayMode,
			throwOnError,
			output,
			trust,
		});
	} catch {
		return displayMode
			? `$$${normalizedExpression}$$`
			: `\\(${normalizedExpression}\\)`;
	}

	const wrapped = displayMode
		? `<div class="anki-math anki-math-block">${rendered}</div>`
		: `<span class="anki-math anki-math-inline">${rendered}</span>`;

	renderCache.set(cacheKey, wrapped);
	return wrapped;
}
