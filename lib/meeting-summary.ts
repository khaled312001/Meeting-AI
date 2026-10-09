/** The end-of-meeting summary document: the AI summary, the answers
 *  suggested during the meeting and the full transcript, as one printable
 *  HTML page (saved as PDF on desktop, as .html in the browser). */

import type { MeetingLanguage } from "@/lib/meeting-language";

const TITLES: Record<
  MeetingLanguage,
  { title: string; answers: string; transcript: string; interviewer: string; me: string }
> = {
  en: { title: "Meeting summary", answers: "Suggested answers", transcript: "Full transcript", interviewer: "Interviewer", me: "Me" },
  ar: { title: "ملخص المقابلة", answers: "الإجابات المقترحة", transcript: "نص المحادثة كاملاً", interviewer: "المحاور", me: "أنا" },
  de: { title: "Zusammenfassung des Gesprächs", answers: "Vorgeschlagene Antworten", transcript: "Vollständiges Transkript", interviewer: "Interviewer", me: "Ich" },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Markdown as the model writes it (headings, lists, bold, paragraphs)
 *  to HTML. Text is escaped first, so nothing in it can become markup. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line.trim());
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (numbered || bullet) {
      flushPara();
      const kind = numbered ? "ol" : "ul";
      // An indented bullet under a numbered item reads as its detail.
      if (bullet && list === "ol" && /^\s{2,}/.test(line)) {
        out.push(`<div class="detail">${inline(bullet[1])}</div>`);
        continue;
      }
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((numbered ?? bullet)![1])}</li>`);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      out.push(`<div class="detail">${inline(line.trim())}</div>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join("\n");
}

export interface SummaryDocumentInput {
  summary: string;
  /** Labeled transcript ("Interviewer: …" / "Me: …" lines). */
  transcript: string;
  answers: string[];
  language: MeetingLanguage;
  startedAt: Date;
}

function transcriptHtml(transcript: string, t: (typeof TITLES)[MeetingLanguage]): string {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(Interviewer|Me):\s*(.*)$/.exec(line);
      if (!m) return `<p class="line">${escapeHtml(line)}</p>`;
      const me = m[1] === "Me";
      return `<p class="line"><span class="who ${me ? "me" : "them"}">${me ? t.me : t.interviewer}</span>${escapeHtml(m[2])}</p>`;
    })
    .join("\n");
}

export function buildSummaryDocument({
  summary,
  transcript,
  answers,
  language,
  startedAt,
}: SummaryDocumentInput): string {
  const t = TITLES[language];
  const rtl = language === "ar";
  const when = startedAt.toLocaleString(language === "ar" ? "ar-EG" : language, {
    dateStyle: "full",
    timeStyle: "short",
  });
  const answerBlocks = answers
    .map((a) => `<div class="answer">${markdownToHtml(a)}</div>`)
    .join("\n");
  return `<!doctype html>
<html lang="${language}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; color: #0f172a; background: #fff; font: 11.5pt/1.6 "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Arabic", sans-serif; }
  .page { max-width: 760px; margin: 0 auto; padding: 8px 4px; }
  header { border-bottom: 2px solid #1a56e8; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 22pt; margin: 0 0 2px; }
  .when { color: #64748b; font-size: 10pt; }
  h2 { font-size: 14pt; color: #1a56e8; margin: 22px 0 8px; }
  h3, h4 { font-size: 12pt; margin: 16px 0 6px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0; padding-inline-start: 22px; }
  li { margin: 4px 0; }
  .detail { color: #475569; margin: 0 0 6px; padding-inline-start: 22px; }
  code { background: #f1f5f9; border-radius: 4px; padding: 0 4px; font-size: 10pt; }
  .answer { border-inline-start: 3px solid #bfd7fe; padding: 2px 12px; margin: 10px 0; break-inside: avoid; }
  .section { break-before: page; }
  .line { margin: 3px 0; }
  .who { display: inline-block; min-width: 82px; font-weight: 700; margin-inline-end: 8px; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .02em; }
  .who.them { color: #0369a1; }
  .who.me { color: #047857; }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>${escapeHtml(t.title)}</h1>
    <div class="when">${escapeHtml(when)}</div>
  </header>
  <main dir="auto">
${markdownToHtml(summary)}
  </main>
${answers.length ? `  <div class="section"><h2>${escapeHtml(t.answers)}</h2>\n${answerBlocks}\n  </div>` : ""}
${transcript.trim() ? `  <div class="section"><h2>${escapeHtml(t.transcript)}</h2>\n${transcriptHtml(transcript, t)}\n  </div>` : ""}
</div>
</body>
</html>`;
}

/** "Meeting summary 2026-10-09 14-30" — safe on Windows and macOS. */
export function summaryFileBaseName(language: MeetingLanguage, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `${language === "de" ? "Meeting-Zusammenfassung" : "Meeting summary"} ${stamp}`;
}
