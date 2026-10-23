"use client";

import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Tightened schema: disallow raw HTML, images (we don't need them in AI
// responses), and scheme-unsafe URLs. Keeps the common GFM output.
const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== "img"),
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

function safeUrlTransform(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    (lower.startsWith("data:") && !lower.startsWith("data:image/"))
  ) {
    return "";
  }
  return trimmed;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** "**" left as text is bold the parser couldn't take (e.g. "**46%**"
 *  right before a letter): a pair becomes bold all the same, a lone one is
 *  dropped, so the stars never show. Code keeps its text. */
function boldStrayMarks() {
  const split = (value: string): HastNode[] => {
    const out: HastNode[] = [];
    const parts = value.split("**");
    const pairs = parts.length % 2 === 1 ? parts.length : parts.length - 1;
    parts.forEach((part, i) => {
      if (i % 2 === 1 && i < pairs) {
        out.push({ type: "element", tagName: "strong", properties: {}, children: [{ type: "text", value: part }] });
      } else if (part) {
        out.push({ type: "text", value: part });
      }
    });
    return out;
  };
  const walk = (node: HastNode) => {
    if (node.type === "element" && (node.tagName === "code" || node.tagName === "pre")) return;
    if (!node.children) return;
    node.children = node.children.flatMap((child) =>
      child.type === "text" && child.value?.includes("**") ? split(child.value) : [child],
    );
    node.children.forEach(walk);
  };
  return (tree: HastNode) => walk(tree);
}

type SafeMarkdownProps = Omit<
  Options,
  "remarkPlugins" | "rehypePlugins" | "urlTransform"
> & {
  children: string;
};

export default function SafeMarkdown(props: SafeMarkdownProps) {
  // dir="auto" lays Arabic answers out right-to-left without a layout box.
  return (
    <div dir="auto" className="contents">
      <ReactMarkdown
        {...props}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema], boldStrayMarks]}
        urlTransform={safeUrlTransform}
      />
    </div>
  );
}
