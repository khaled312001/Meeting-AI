/** Parse resume / knowledge files (txt, md, pdf, docx) into plain text. */

const RESUME_MAX_CHARS = 6000;

const ALLOWED_EXTENSIONS = new Set(["txt", "md", "pdf", "docx"]);

export const DOCUMENT_ACCEPT =
  ".pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const UNSUPPORTED_MESSAGE = "Unsupported file type. Use .pdf, .docx, .txt, or .md.";

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  const mime = file.type.toLowerCase();
  if (mime === "text/plain") return "txt";
  if (mime === "text/markdown") return "md";
  if (mime === "application/pdf") return "pdf";
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return fromName;
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
  const ext = extensionOf(file);
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(UNSUPPORTED_MESSAGE);

  let text: string;
  switch (ext) {
    case "txt":
    case "md":
      text = await file.text();
      break;
    case "pdf":
      text = await parsePdf(file, maxChars);
      break;
    case "docx":
      text = await parseDocx(file);
      break;
    default:
      throw new Error(UNSUPPORTED_MESSAGE);
  }

  text = text.replace(/\u0000/g, "").trim();
  if (!text) {
    throw new Error(
      "Could not extract text from that file. Scanned PDFs need OCR first.",
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
