import { describe, expect, it } from "vitest";
import { applyFilterPipeline } from "@/lib/rendering/filters";
import {
    clearMathRenderCache,
    getMathRenderCacheSize,
    preloadMathRenderer,
    renderMathInHtml,
} from "@/lib/rendering/math";
import { sanitizeHtml } from "@/lib/rendering/sanitizer";
import { parseTemplate } from "@/lib/rendering/template-parser";
import {
    fieldIsEmpty,
    renderCardTemplates,
    renderTemplate,
    renderTemplateAsync,
} from "@/lib/rendering/template-renderer";

describe("Phase 3 rendering", () => {
    it("parses replacements, comments, conditionals, and alternative delimiters", () => {
        const nodes = parseTemplate("Hello {{Front}} <!--memo--> {{#Back}}{{text:Back}}{{/Back}}");

        expect(nodes).toHaveLength(6);
        expect(nodes[0]).toMatchObject({ type: "text", value: "Hello " });
        expect(nodes[1]).toMatchObject({ type: "replacement", key: "Front", filters: [] });
        expect(nodes[2]).toMatchObject({ type: "text", value: " " });
        expect(nodes[3]).toMatchObject({ type: "comment", value: "memo" });
        expect(nodes[4]).toMatchObject({ type: "text", value: " " });
        expect(nodes[5]).toMatchObject({
            type: "conditional",
            key: "Back",
            children: [{ type: "replacement", key: "Back", filters: ["text"] }],
        });

        const altNodes = parseTemplate("{{=<% %>=}}<%Front%><%#Back%>x<%/Back%>");
        expect(altNodes).toEqual([
            { type: "replacement", key: "Front", filters: [], raw: "Front" },
            {
                type: "conditional",
                key: "Back",
                children: [{ type: "text", value: "x" }],
            },
        ]);
    });

    it("renders question and answer templates with FrontSide support", () => {
        const rendered = renderCardTemplates({
            questionTemplate: "{{Front}}",
            answerTemplate: "{{FrontSide}}<hr id='answer'>{{Back}}",
            fields: {
                Front: "Capital of France?",
                Back: "Paris",
            },
            sanitize: true,
        });

        expect(rendered.question.html).toContain("Capital of France?");
        expect(rendered.answer.html).toContain("Capital of France?");
        expect(rendered.answer.html).toContain("Paris");
        expect(rendered.answer.html).toContain("<hr id=\"answer\">");
    });

    it("supports both filter:Field and Field:filter notations", () => {
        const prefixNotation = renderTemplate("{{text:Front}}", {
            fields: { Front: "<b>Bonjour</b>" },
            sanitize: true,
        });
        const suffixNotation = renderTemplate("{{Front:text}}", {
            fields: { Front: "<b>Bonjour</b>" },
            sanitize: true,
        });

        expect(prefixNotation.html).toBe("Bonjour");
        expect(suffixNotation.html).toBe("Bonjour");
    });

    it("renders cloze active/inactive regions", () => {
        const question = renderTemplate("{{cloze:Text}}", {
            fields: {
                Text: "The {{c1::capital}} of {{c2::France::country}}.",
            },
            side: "question",
            clozeOrdinal: 1,
            sanitize: true,
        });

        const answer = renderTemplate("{{cloze:Text}}", {
            fields: {
                Text: "The {{c1::capital}} of {{c2::France::country}}.",
            },
            side: "answer",
            clozeOrdinal: 1,
            sanitize: true,
        });

        expect(question.html).toContain("class=\"cloze\"");
        expect(question.html).toContain("[...]");
        expect(question.html).toContain("class=\"cloze-inactive\"");

        expect(answer.html).toContain("class=\"cloze\"");
        expect(answer.html).toContain("capital");
        expect(answer.html).toContain("class=\"cloze-inactive\"");
    });

    it("applies furigana and tts filters", () => {
        const furigana = applyFilterPipeline("日本語[にほんご]", ["furigana"], {
            fieldName: "Front",
        });
        const tts = applyFilterPipeline("hello", ["tts en_US"], {
            fieldName: "Front",
        });

        expect(furigana).toContain("<ruby>");
        expect(furigana).toContain("<rt>にほんご</rt>");
        expect(tts).toBe("[anki:tts lang=en_US]hello[/anki:tts]");
    });

    it("sanitizes dangerous HTML while preserving safe data attributes", () => {
        const sanitized = sanitizeHtml(
            "<div onclick=\"bad()\"><script>alert(1)</script><a href=\"javascript:evil()\">x</a><img src=\"https://example.com/a.png\" onerror=\"bad()\"><span data-ordinal=\"1\">ok</span></div>",
        );

        expect(sanitized).not.toContain("<script");
        expect(sanitized).not.toContain("onclick=");
        expect(sanitized).not.toContain("onerror=");
        expect(sanitized).not.toContain("javascript:");
        expect(sanitized).toContain("data-ordinal=\"1\"");
        expect(sanitized).toContain("https://example.com/a.png");
    });

    it("renders math with cache-backed katex integration", async () => {
        clearMathRenderCache();
        expect(getMathRenderCacheSize()).toBe(0);

        const loaded = await preloadMathRenderer();
        expect(loaded).toBe(true);

        const source = "Equation: \\(E=mc^2\\) and $$a^2+b^2=c^2$$";
        const rendered = await renderMathInHtml(source);

        expect(rendered).toContain("anki-math-inline");
        expect(rendered).toContain("anki-math-block");
        expect(getMathRenderCacheSize()).toBeGreaterThan(0);

        const asyncTemplate = await renderTemplateAsync(source, {
            fields: {},
            renderMath: true,
            sanitize: false,
        });

        expect(asyncTemplate.html).toContain("anki-math-inline");
    });

    it("detects empty fields similarly to Anki template checks", () => {
        expect(fieldIsEmpty("")).toBe(true);
        expect(fieldIsEmpty("   \n\t")).toBe(true);
        expect(fieldIsEmpty("<div><br></div>")).toBe(true);
        expect(fieldIsEmpty("<div>Text</div>")).toBe(false);
    });
});
