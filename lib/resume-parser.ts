/** Parse resume / knowledge files into plain text: PDF, Word, Excel,
 *  PowerPoint, OpenDocument, RTF, HTML, EPUB, CSV/Markdown/JSON and any
 *  other text file. */

import {
  decodeText,
  htmlToText,
  looksBinary,
  parseEpub,
  parseOdf,
  parsePptx,
  parseRtf,
  parseXlsx,
} from "./document-formats";

const RESUME_MAX_CHARS = 30_000;

type DocumentKind =
  | "text"
  | "html"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odf"
  | "rtf"
  | "epub";

const EXTENSION_KINDS: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  docm: "docx",
  dotx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  xltx: "xlsx",
  pptx: "pptx",
  pptm: "pptx",
  ppsx: "pptx",
  potx: "pptx",
  odt: "odf",
  ods: "odf",
  odp: "odf",
  rtf: "rtf",
  html: "html",
  htm: "html",
  xhtml: "html",
  epub: "epub",
};

/** Old binary Office formats: say what to do instead of failing vaguely. */
const LEGACY_OFFICE: Record<string, string> = {
  doc: ".docx",
  xls: ".xlsx",
  ppt: ".pptx",
  pps: ".pptx",
};

const MIME_KINDS: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odf",
  "application/vnd.oasis.opendocument.spreadsheet": "odf",
  "application/vnd.oasis.opendocument.presentation": "odf",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/html": "html",
  "application/epub+zip": "epub",
};

/** Upload pickers: no filter, since any text-based file works too. The
 *  list of named formats is for labels. */
export const DOCUMENT_ACCEPT = "";

export const DOCUMENT_FORMATS_LABEL =
  "PDF, Word, Excel, PowerPoint, CSV, Markdown, text, RTF, HTML, OpenDocument, EPUB";

function kindOf(file: File): DocumentKind | "legacy" | "image" | "unknown" {
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  if (EXTENSION_KINDS[ext]) return EXTENSION_KINDS[ext];
  if (LEGACY_OFFICE[ext]) return "legacy";
  const mime = file.type.toLowerCase();
  if (MIME_KINDS[mime]) return MIME_KINDS[mime];
  if (mime.startsWith("image/")) return "image";
  return "unknown";
}

async function parsePdf(file: File, maxChars: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (text.trim()) {
      pages.push(text);
      total += text.length + 2;
    }
    if (total >= maxChars) break;
  }
  return pages.join("\n\n");
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

export interface ParsedDocument {
  text: string;
  fileName: string;
  /** True when the extracted text was cut to `maxChars`. */
  truncated: boolean;
}

export async function parseDocumentFile(
  file: File,
  { maxChars }: { maxChars: number },
): Promise<ParsedDocument> {
  const kind = kindOf(file);
  if (kind === "legacy") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    throw new Error(
      `Old .${ext} files can't be read. Open it and save it as ${LEGACY_OFFICE[ext]}, then upload again.`,
    );
  }
  if (kind === "image") {
    throw new Error(
      "Images have no text to read. Upload the document itself, or paste its text.",
    );
  }

  const bytes = () => file.arrayBuffer().then((b) => new Uint8Array(b));
  let text: string;
  switch (kind) {
    case "pdf":
      text = await parsePdf(file, maxChars);
      break;
    case "docx":
      text = await parseDocx(file);
      break;
    case "xlsx":
      text = parseXlsx(await bytes(), maxChars);
      break;
    case "pptx":
      text = parsePptx(await bytes(), maxChars);
      break;
    case "odf":
      text = parseOdf(await bytes(), maxChars);
      break;
    case "epub":
      text = parseEpub(await bytes(), maxChars);
      break;
    case "rtf":
      text = parseRtf(decodeText(await bytes()));
      break;
    case "html":
      text = htmlToText(decodeText(await bytes()));
      break;
    default: {
      // Markdown, CSV, JSON, code, subtitles… anything that is text.
      const data = await bytes();
      if (looksBinary(data)) {
        throw new Error(
          `Can't read text from “${file.name}”. Supported: ${DOCUMENT_FORMATS_LABEL}, or any text file.`,
        );
      }
      text = decodeText(data);
    }
  }

  text = text.replace(/\u0000/g, "").trim();
  if (!text) {
    throw new Error(
      kind === "pdf"
        ? "This PDF has no selectable text (it's a scan). Paste the text instead, or export it from the original document."
        : "No readable text found in that file.",
    );
  }

  const truncated = text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    fileName: file.name,
    truncated,
  };
}

export interface ParseResumeResult {
  text: string;
  fileName: string;
}

export async function parseResumeFile(file: File): Promise<ParseResumeResult> {
  const { text, fileName } = await parseDocumentFile(file, {
    maxChars: RESUME_MAX_CHARS,
  });
  return { text, fileName };
}
