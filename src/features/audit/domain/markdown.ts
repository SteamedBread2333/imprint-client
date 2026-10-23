import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.use({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    code({ text, lang }) {
      if (lang === "mermaid") {
        return `<div class="mermaid-wrap"><pre class="mermaid">${escapeHtml(text)}</pre></div>`;
      }
      try {
        const language = lang && hljs.getLanguage(lang) ? lang : null;
        const html = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
        return `<pre><code class="hljs${language ? ` language-${language}` : ""}">${html}</code></pre>`;
      } catch {
        return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
      }
    },
  },
});

export function injectMatchAnchor(markdown: string, lineStart = 1): string {
  const lines = markdown.split("\n");
  const index = Math.max(0, lineStart - 1);
  if (index >= lines.length) return markdown;
  lines.splice(index, 0, '<span id="doc-anchor" class="doc-match-anchor"></span>');
  return lines.join("\n");
}

export function renderSafeMarkdown(markdown: string, lineStart?: number): string {
  const source = lineStart ? injectMatchAnchor(markdown, lineStart) : markdown;
  const html = String(marked.parse(source));
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["class", "id"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "style"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}

export function searchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const part of query.trim().toLowerCase().split(/\s+/)) {
    if (part.length >= 2) terms.add(part);
    for (const char of part) {
      if (/[\u4e00-\u9fff]/.test(char)) terms.add(char);
    }
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitHighlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const terms = searchTerms(query);
  if (!terms.length || !text) return [{ text, hit: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).filter((part) => part !== "").map((part) => ({
    text: part,
    hit: terms.some((term) => part.toLowerCase() === term.toLowerCase()),
  }));
}

export function renderDocBody(content: string, lineStart?: number, lineEnd?: number): string {
  if (!lineStart) return renderSafeMarkdown(content);
  const lines = content.split("\n");
  const start = Math.max(0, lineStart - 1);
  const end = Math.min(lines.length - 1, (lineEnd || lineStart) - 1);
  if (start > end || start >= lines.length) return renderSafeMarkdown(injectMatchAnchor(content, lineStart));
  const before = lines.slice(0, start).join("\n");
  const range = lines.slice(start, end + 1).join("\n");
  const after = lines.slice(end + 1).join("\n");
  return [
    before.trim() ? renderSafeMarkdown(before) : "",
    `<div class="doc-rule-range" id="doc-anchor">${renderSafeMarkdown(range)}</div>`,
    after.trim() ? renderSafeMarkdown(after) : "",
  ].join("");
}

export function highlightInElement(root: HTMLElement, query: string) {
  const terms = searchTerms(query);
  if (!terms.length) return;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const skip = new Set(["SCRIPT", "STYLE", "MARK", "CODE", "PRE"]);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || skip.has(parent.tagName) || !node.nodeValue?.trim()) continue;
    textNodes.push(node);
  }
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const span = document.createElement("span");
    const escaped = escapeHtml(text);
    pattern.lastIndex = 0;
    span.innerHTML = escaped.replace(pattern, '<mark class="search-hl">$1</mark>');
    node.replaceWith(...span.childNodes);
  }
}
