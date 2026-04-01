import { renderClozeText, revealClozeTextOnly } from "@/lib/rendering/cloze";
import { stripHtmlToText } from "@/lib/rendering/sanitizer";

const FURIGANA_PATTERN = / ?([^ >]+?)\[(.+?)\]/g;

export interface FilterContext {
	readonly fieldName: string;
	readonly side?: "question" | "answer";
	readonly clozeOrdinal?: number;
}

export function applyFilterPipeline(value: string, filters: readonly string[], context: FilterContext): string {
	let output = value;
	const normalizedFilters = normalizeTypeFilters(filters);

	for (const filterName of normalizedFilters) {
		output = applySingleFilter(output, filterName, context);
	}

	return output;
}

function normalizeTypeFilters(filters: readonly string[]): string[] {
	const normalized = filters.map((filter) => filter.trim());

	if (normalized.length === 2 && normalized[0].toLowerCase() === "cloze" && normalized[1].toLowerCase() === "type") {
		return ["type-cloze"];
	}

	if (normalized.length === 2 && normalized[0].toLowerCase() === "nc" && normalized[1].toLowerCase() === "type") {
		return ["type-nc"];
	}

	if (normalized.length > 0 && normalized[normalized.length - 1].toLowerCase() === "type") {
		return ["type"];
	}

	return normalized;
}

function applySingleFilter(value: string, filterName: string, context: FilterContext): string {
	const loweredFilter = filterName.toLowerCase();

	switch (loweredFilter) {
		case "":
			return value;
		case "text":
			return stripHtmlToText(value);
		case "furigana":
			return applyFuriganaFilter(value);
		case "kana":
			return applyKanaFilter(value);
		case "kanji":
			return applyKanjiFilter(value);
		case "type":
			return `[[type:${context.fieldName}]]`;
		case "type-cloze":
			return `[[type:cloze:${context.fieldName}]]`;
		case "type-nc":
			return `[[type:nc:${context.fieldName}]]`;
		case "hint":
			return applyHintFilter(value, context.fieldName);
		case "cloze": {
			const rendered = renderClozeText(value, {
				clozeOrdinal: context.clozeOrdinal ?? 1,
				side: context.side ?? "question",
			});
			return rendered.html;
		}
		case "cloze-only":
			return revealClozeTextOnly(value, {
				clozeOrdinal: context.clozeOrdinal ?? 1,
				side: context.side ?? "question",
			});
		default:
			break;
	}

	if (loweredFilter.startsWith("tts ")) {
		const options = filterName.slice(4).trim();
		return options.length > 0
			? `[anki:tts lang=${options}]${value}[/anki:tts]`
			: value;
	}

	return value;
}

function applyKanaFilter(value: string): string {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(FURIGANA_PATTERN, (matched, base, ruby) => {
			if (typeof ruby === "string" && ruby.startsWith("sound:")) {
				return matched;
			}
			return ruby;
		});
}

function applyKanjiFilter(value: string): string {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(FURIGANA_PATTERN, (matched, base, ruby) => {
			if (typeof ruby === "string" && ruby.startsWith("sound:")) {
				return matched;
			}
			return base;
		});
}

function applyFuriganaFilter(value: string): string {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(FURIGANA_PATTERN, (matched, base, ruby) => {
			if (typeof ruby === "string" && ruby.startsWith("sound:")) {
				return matched;
			}
			return `<ruby><rb>${base}</rb><rt>${ruby}</rt></ruby>`;
		});
}

function applyHintFilter(value: string, fieldName: string): string {
	if (value.trim().length === 0) {
		return value;
	}

	const id = hashHint(`${fieldName}:${value}`);
	return [
		`<a class="hint" href="#" onclick="this.style.display='none';document.getElementById('hint${id}').style.display='block';return false;" draggable="false">`,
		fieldName,
		"</a>",
		`<div id="hint${id}" class="hint" style="display: none">${value}</div>`,
	].join("");
}

function hashHint(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let hash = 0x811c9dc5;

	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}
