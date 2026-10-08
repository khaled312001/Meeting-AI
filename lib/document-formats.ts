/** Text extraction for office and other document formats, done in the
 *  browser: Excel / PowerPoint (OOXML), OpenDocument, RTF, HTML, EPUB and
 *  any plain-text file. PDF and Word (.docx) live in resume-parser.ts. */

import { strFromU8, unzipSync, type Unzipped } from "fflate";

/** Stop collecting once this far past the caller's character budget. */
const OVERSHOOT = 1.05;

// ─── Plain text ─────────────────────────────────────────────────────────

/** Looks like a binary file (images, executables, legacy Office). */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.length === 0) return false;
  // UTF-16 text is full of NULs but starts with a BOM.
  if (
    (sample[0] === 0xff && sample[1] === 0xfe) ||
    (sample[0] === 0xfe && sample[1] === 0xff)
  ) {
    return false;
  }
  let control = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length > 0.1;
}

/** Decode text bytes: BOM-aware, UTF-8 first, then the local legacy code
 *  page (Excel's CSV export on Arabic Windows is windows-1256). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const lang =
      typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
    const legacy = lang.startsWith("ar") ? "windows-1256" : "windows-1252";
    return new TextDecoder(legacy).decode(bytes);
  }
}

// ─── XML / HTML helpers ─────────────────────────────────────────────────

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function readEntry(files: Unzipped, path: string): string | null {
  const data = files[path];
  return data ? strFromU8(data) : null;
}

function openZip(bytes: Uint8Array): Unzipped {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("This file looks damaged or isn't the format its name says.");
  }
}

/** Resolve a relationship target against the folder of the part that
 *  references it (`../notesSlides/x.xml` from `ppt/slides/`). */
function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Relationship id → { target part path, type } for an OOXML part. */
function readRels(
  files: Unzipped,
  partPath: string,
): Map<string, { path: string; type: string }> {
  const dir = partPath.slice(0, partPath.lastIndexOf("/") + 1);
  const name = partPath.slice(dir.length);
  const xml = readEntry(files, `${dir}_rels/${name}.rels`);
  const map = new Map<string, { path: string; type: string }>();
  if (!xml) return map;
  for (const rel of byLocalName(parseXml(xml), "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) {
      map.set(id, {
        path: resolvePart(dir, target),
        type: rel.getAttribute("Type") ?? "",
      });
    }
  }
  return map;
}

function relId(el: Element): string | null {
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === "id" && attr.prefix === "r") return attr.value;
  }
  return null;
}

function numericSuffix(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** Visible text of an HTML document, with line breaks at block ends. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
  doc
    .querySelectorAll("br, p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, blockquote, pre")
    .forEach((el) => el.append("\n"));
  doc.querySelectorAll("td, th").forEach((el) => el.append(" | "));
  return (doc.body?.textContent ?? "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ─── Excel (.xlsx / .xlsm) ──────────────────────────────────────────────

/** "BC12" → 54 (0-based column of a cell reference). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function cellsToLine(cells: string[]): string {
  let end = cells.length;
  while (end > 0 && !cells[end - 1]) end--;
  return cells.slice(0, end).join(" | ");
}

export function parseXlsx(bytes: Uint8Array, maxChars: number): string {
  const files = openZip(bytes);
  const workbookXml = readEntry(files, "xl/workbook.xml");
  if (!workbookXml) throw new Error("Not an Excel workbook.");

  const shared: string[] = [];
  const sharedXml = readEntry(files, "xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of byLocalName(parseXml(sharedXml), "si")) {
      // Rich text keeps runs as several <t>; phonetic hints (<rPh>) are noise.
      shared.push(
        byLocalName(si, "t")
          .filter((t) => t.parentElement?.localName !== "rPh")
          .map((t) => t.textContent ?? "")
          .join(""),
      );
    }
  }

  const rels = readRels(files, "xl/workbook.xml");
  const out: string[] = [];
  let total = 0;
  for (const sheet of byLocalName(parseXml(workbookXml), "sheet")) {
    if (sheet.getAttribute("state") === "hidden") continue;
    const id = relId(sheet);
    const path = id ? rels.get(id)?.path : undefined;
    const xml = path ? readEntry(files, path) : null;
    if (!xml) continue;

    const lines: string[] = [];
    for (const row of byLocalName(parseXml(xml), "row")) {
      const cells: string[] = [];
      for (const c of byLocalName(row, "c")) {
        const ref = c.getAttribute("r");
        const col = ref ? columnIndex(ref) : cells.length;
        const type = c.getAttribute("t");
        const v = byLocalName(c, "v")[0]?.textContent ?? "";
        let value: string;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") {
          value = byLocalName(c, "t").map((t) => t.textContent ?? "").join("");
        } else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else value = v;
        cells[col] = value.replace(/\s+/g, " ").trim();
      }
      for (let i = 0; i < cells.length; i++) cells[i] ??= "";
      const line = cellsToLine(cells);
      if (line) {
        lines.push(line);
        total += line.length + 1;
      }
      if (total > maxChars * OVERSHOOT) break;
    }
    if (lines.length) {
      out.push(`## Sheet: ${sheet.getAttribute("name") ?? ""}\n${lines.join("\n")}`);
    }
    if (total > maxChars * OVERSHOOT) break;
  }
  return out.join("\n\n");
}

// ─── PowerPoint (.pptx / .ppsx / .pptm) ─────────────────────────────────

function drawingParagraphs(root: Document | Element): string[] {
  return byLocalName(root, "p")
    .filter((p) => p.namespaceURI?.includes("drawingml"))
    .map((p) =>
      byLocalName(p, "t")
        .map((t) => t.textContent ?? "")
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

export function parsePptx(bytes: Uint8Array, maxChars: number): string {
  const files = openZip(bytes);
  const presXml = readEntry(files, "ppt/presentation.xml");
  if (!presXml) throw new Error("Not a PowerPoint presentation.");

  // Slide order comes from the presentation, not the file names.
  const rels = readRels(files, "ppt/presentation.xml");
  let slides = byLocalName(parseXml(presXml), "sldId")
    .map((s) => {
      const id = relId(s);
      return id ? rels.get(id)?.path : undefined;
    })
    .filter((p): p is string => !!p && !!files[p]);
  if (slides.length === 0) {
    slides = Object.keys(files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => numericSuffix(a) - numericSuffix(b));
  }

  const out: string[] = [];
  let total = 0;
  slides.forEach((path, i) => {
    if (total > maxChars * OVERSHOOT) return;
    const xml = readEntry(files, path);
    if (!xml) return;
    const parts = [`## Slide ${i + 1}`, ...drawingParagraphs(parseXml(xml))];

    const notes = [...readRels(files, path).values()].find((r) =>
      r.type.endsWith("/notesSlide"),
    );
    const notesXml = notes ? readEntry(files, notes.path) : null;
    if (notesXml) {
      // Drop the slide-number field that every notes page carries.
      const lines = drawingParagraphs(parseXml(notesXml)).filter(
        (l) => !/^\d+$/.test(l),
      );
      if (lines.length) parts.push(`Speaker notes: ${lines.join("\n")}`);
    }
    if (parts.length > 1) {
      const block = parts.join("\n");
      out.push(block);
      total += block.length + 2;
    }
  });
  return out.join("\n\n");
}

// ─── OpenDocument (.odt / .ods / .odp) ──────────────────────────────────

const ODF_TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const ODF_TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const ODF_DRAW_NS = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";

function odfParagraphs(root: Element): string[] {
  const lines: string[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (
        child.namespaceURI === ODF_TEXT_NS &&
        (child.localName === "p" || child.localName === "h")
      ) {
        const text = (child.textContent ?? "").trim();
        if (text) lines.push(text);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return lines;
}

export function parseOdf(bytes: Uint8Array, maxChars: number): string {
  const files = openZip(bytes);
  const xml = readEntry(files, "content.xml");
  if (!xml) throw new Error("Not an OpenDocument file.");
  const doc = parseXml(xml);
  const body = byLocalName(doc, "body")[0];
  if (!body) return "";

  const sheets = Array.from(body.getElementsByTagNameNS(ODF_TABLE_NS, "table"));
  const pages = Array.from(body.getElementsByTagNameNS(ODF_DRAW_NS, "page"));
  const out: string[] = [];
  let total = 0;

  if (byLocalName(body, "spreadsheet").length) {
    for (const table of sheets) {
      const lines: string[] = [];
      for (const row of Array.from(table.getElementsByTagNameNS(ODF_TABLE_NS, "table-row"))) {
        const cells: string[] = [];
        for (const cell of Array.from(row.children)) {
          if (cell.localName !== "table-cell") continue;
          const value = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
          // Rows end in a run of thousands of repeated empty cells; the
          // cap keeps that cheap and cellsToLine trims what is left.
          const repeat = Number(cell.getAttributeNS(ODF_TABLE_NS, "number-columns-repeated") ?? 1);
          for (let i = 0; i < Math.min(repeat, 100); i++) cells.push(value);
        }
        const line = cellsToLine(cells);
        if (line) {
          lines.push(line);
          total += line.length + 1;
        }
        if (total > maxChars * OVERSHOOT) break;
      }
      if (lines.length) {
        out.push(`## Sheet: ${table.getAttributeNS(ODF_TABLE_NS, "name") ?? ""}\n${lines.join("\n")}`);
      }
      if (total > maxChars * OVERSHOOT) break;
    }
    return out.join("\n\n");
  }

  if (pages.length) {
    pages.forEach((page, i) => {
      const lines = odfParagraphs(page);
      if (lines.length) out.push([`## Slide ${i + 1}`, ...lines].join("\n"));
    });
    return out.join("\n\n");
  }

  return odfParagraphs(body).join("\n");
}

// ─── EPUB ───────────────────────────────────────────────────────────────

export function parseEpub(bytes: Uint8Array, maxChars: number): string {
  const files = openZip(bytes);
  const container = readEntry(files, "META-INF/container.xml");
  const opfPath = container
    ? byLocalName(parseXml(container), "rootfile")[0]?.getAttribute("full-path")
    : null;
  const opf = opfPath ? readEntry(files, opfPath) : null;
  if (!opfPath || !opf) throw new Error("Not an EPUB book.");

  const opfDoc = parseXml(opf);
  const dir = opfPath.slice(0, opfPath.lastIndexOf("/") + 1);
  const manifest = new Map<string, string>();
  for (const item of byLocalName(opfDoc, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, resolvePart(dir, decodeURIComponent(href)));
  }
  const out: string[] = [];
  let total = 0;
  for (const ref of byLocalName(opfDoc, "itemref")) {
    const path = manifest.get(ref.getAttribute("idref") ?? "");
    const html = path ? readEntry(files, path) : null;
    if (!html) continue;
    const text = htmlToText(html).trim();
    if (text) {
      out.push(text);
      total += text.length + 2;
    }
    if (total > maxChars * OVERSHOOT) break;
  }
  return out.join("\n\n");
}

// ─── RTF ────────────────────────────────────────────────────────────────

/** Groups whose content is formatting data, not document text. */
const RTF_SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata",
  "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "listtable",
  "listoverridetable", "rsidtbl", "generator", "header", "footer", "headerl",
  "headerr", "footerl", "footerr", "fldinst", "bkmkstart", "bkmkend",
]);

export function parseRtf(raw: string): string {
  const codepage = /\\ansicpg(\d+)/.exec(raw)?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(codepage ? `windows-${codepage}` : "windows-1252");
  } catch {
    decoder = new TextDecoder("windows-1252");
  }

  const out: string[] = [];
  const pendingBytes: number[] = [];
  const flushBytes = () => {
    if (pendingBytes.length) {
      out.push(decoder.decode(new Uint8Array(pendingBytes)));
      pendingBytes.length = 0;
    }
  };
  const emit = (s: string) => {
    flushBytes();
    out.push(s);
  };

  // Each group remembers whether it is skipped and its \ucN fallback size.
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      i++;
      // `{\*\dest ...}` marks an optional destination readers may ignore.
      if (raw.startsWith("\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === "'") {
        const byte = parseInt(raw.slice(i + 2, i + 4), 16);
        i += 4;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!skip && !Number.isNaN(byte)) pendingBytes.push(byte);
        continue;
      }
      if (next === "\\" || next === "{" || next === "}") {
        if (!skip) emit(next);
        i += 2;
        continue;
      }
      if (next === "~") {
        if (!skip) emit(" ");
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        if (!skip) emit("\n");
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i + 1, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      const word = m[1];
      const param = m[2] !== undefined ? Number(m[2]) : null;
      if (RTF_SKIP_DESTINATIONS.has(word)) {
        skip = true;
        continue;
      }
      if (skip) continue;
      if (word === "uc" && param !== null) uc = param;
      else if (word === "u" && param !== null) {
        emit(String.fromCharCode(param < 0 ? param + 65536 : param));
        skipChars = uc;
      } else if (word === "par" || word === "line" || word === "row" || word === "sect" || word === "page") {
        emit("\n");
      } else if (word === "tab" || word === "cell") {
        emit(word === "cell" ? " | " : "\t");
      }
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (skipChars > 0) {
      skipChars--;
      i++;
      continue;
    }
    if (!skip) emit(ch);
    i++;
  }
  flushBytes();
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
