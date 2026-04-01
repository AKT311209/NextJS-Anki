const DEFAULT_ALLOWED_TAGS = new Set([
	"a",
	"abbr",
	"audio",
	"b",
	"blockquote",
	"br",
	"code",
	"div",
	"em",
	"hr",
	"i",
	"img",
	"li",
	"ol",
	"p",
	"pre",
	"rb",
	"rp",
	"rt",
	"ruby",
	"s",
	"small",
	"source",
	"span",
	"strong",
	"sub",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
	"video",
]);

const GLOBAL_ALLOWED_ATTRIBUTES = new Set([
	"class",
	"id",
	"lang",
	"dir",
	"title",
	"role",
	"aria-label",
	"aria-hidden",
]);

const TAG_ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
	a: ["href", "target", "rel"],
	audio: ["src", "controls", "autoplay", "loop", "preload"],
	img: ["src", "alt", "width", "height", "loading", "decoding"],
	source: ["src", "type", "srcset"],
	table: ["cellpadding", "cellspacing"],
	td: ["colspan", "rowspan"],
	th: ["colspan", "rowspan", "scope"],
	video: ["src", "controls", "autoplay", "loop", "muted", "playsinline", "poster", "preload", "width", "height"],
};

const DROP_TAGS_WITH_CONTENT = new Set([
	"applet",
	"embed",
	"frame",
	"frameset",
	"iframe",
	"link",
	"meta",
	"noscript",
	"object",
	"script",
	"style",
]);

const URL_ATTRIBUTES = new Set(["href", "poster", "src"]);

export interface SanitizeHtmlOptions {
	readonly preserveComments?: boolean;
	readonly allowDataAttributes?: boolean;
	readonly allowStyleAttribute?: boolean;
}

export function sanitizeHtml(html: string, options: SanitizeHtmlOptions = {}): string {
	if (!html) {
		return "";
	}

	if (typeof DOMParser === "undefined") {
		return sanitizeHtmlFallback(html);
	}

	const parser = new DOMParser();
	const document = parser.parseFromString(`<div id="anki-sanitize-root">${html}</div>`, "text/html");
	const root = document.getElementById("anki-sanitize-root");
	if (!root) {
		return sanitizeHtmlFallback(html);
	}

	sanitizeNodeChildren(root, options);
	return root.innerHTML;
}

export function stripHtmlToText(value: string): string {
	if (!value) {
		return "";
	}

	if (typeof DOMParser === "undefined") {
		return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	}

	const parser = new DOMParser();
	const document = parser.parseFromString(`<div>${value}</div>`, "text/html");
	const text = document.body.textContent ?? "";
	return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeNodeChildren(parent: Node, options: SanitizeHtmlOptions): void {
	const children = Array.from(parent.childNodes);
	for (const child of children) {
		if (child.nodeType === Node.TEXT_NODE) {
			continue;
		}

		if (child.nodeType === Node.COMMENT_NODE) {
			if (!(options.preserveComments ?? false)) {
				parent.removeChild(child);
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) {
			parent.removeChild(child);
			continue;
		}

		const element = child as Element;
		const tagName = element.tagName.toLowerCase();

		if (!DEFAULT_ALLOWED_TAGS.has(tagName)) {
			if (DROP_TAGS_WITH_CONTENT.has(tagName)) {
				parent.removeChild(element);
				continue;
			}

			while (element.firstChild) {
				parent.insertBefore(element.firstChild, element);
			}
			parent.removeChild(element);
			continue;
		}

		sanitizeAttributes(element, tagName, options);
		sanitizeNodeChildren(element, options);
	}
}

function sanitizeAttributes(element: Element, tagName: string, options: SanitizeHtmlOptions): void {
	const attributes = Array.from(element.attributes);
	for (const attribute of attributes) {
		const attributeName = attribute.name.toLowerCase();
		const value = attribute.value;

		if (attributeName.startsWith("on")) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (attributeName === "style" && !(options.allowStyleAttribute ?? false)) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (!isAllowedAttribute(attributeName, tagName, options)) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (URL_ATTRIBUTES.has(attributeName) && !isSafeUrl(value)) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (attributeName === "srcset" && !isSafeSrcSet(value)) {
			element.removeAttribute(attribute.name);
			continue;
		}
	}

	if (tagName === "a" && element.getAttribute("target") === "_blank") {
		const rel = (element.getAttribute("rel") ?? "")
			.split(/\s+/)
			.map((token) => token.trim())
			.filter((token) => token.length > 0);

		if (!rel.includes("noopener")) {
			rel.push("noopener");
		}
		if (!rel.includes("noreferrer")) {
			rel.push("noreferrer");
		}

		element.setAttribute("rel", rel.join(" "));
	}
}

function isAllowedAttribute(attributeName: string, tagName: string, options: SanitizeHtmlOptions): boolean {
	if (GLOBAL_ALLOWED_ATTRIBUTES.has(attributeName)) {
		return true;
	}

	if ((options.allowDataAttributes ?? true) && attributeName.startsWith("data-")) {
		return true;
	}

	const allowedForTag = TAG_ALLOWED_ATTRIBUTES[tagName] ?? [];
	return allowedForTag.includes(attributeName);
}

function isSafeUrl(url: string): boolean {
	const normalized = url.trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
	if (!normalized) {
		return true;
	}

	const lower = normalized.toLowerCase();
	if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) {
		return false;
	}

	if (lower.startsWith("data:")) {
		return /^data:(image|audio|video)\//i.test(lower);
	}

	const protocolMatch = lower.match(/^([a-z0-9+.-]+):/i);
	if (!protocolMatch) {
		return true;
	}

	const protocol = protocolMatch[1];
	return protocol === "http" || protocol === "https" || protocol === "mailto" || protocol === "tel" || protocol === "blob";
}

function isSafeSrcSet(srcset: string): boolean {
	return srcset
		.split(",")
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0)
		.every((candidate) => {
			const [url] = candidate.split(/\s+/, 1);
			return isSafeUrl(url);
		});
}

function sanitizeHtmlFallback(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s(href|src|poster)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]*)/gi, "");
}
