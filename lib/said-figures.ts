/** Figures said so far in a meeting (numbers, dates, amounts, durations),
 *  sent with each live answer so later answers reuse the same figures even
 *  after the talk that held them has scrolled out of what is sent. */

const MAX_FIGURES = 30;
const MAX_FIGURE_CHARS = 240;

/** A digit in any script, or a number word (English, Arabic, German). */
const FIGURE_RE = new RegExp(
  [
    "\\p{Nd}",
    "(?<!\\p{L})(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|dozen|percent)(?!\\p{L})",
    "(?<!\\p{L})(?:اثنين|اتنين|ثلاث|تلات|أربع|اربع|خمس|سبع|ثمان|تمان|تسع|عشرة|عشرين|مية|مائة|مليون|بالمية|بالمائة)",
    "(?<!\\p{L})(?:ألف|آلاف)(?!\\p{L})",
    "(?<!\\p{L})(?:zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwanzig|hundert|tausend|millionen?|prozent)(?!\\p{L})",
  ].join("|"),
  "iu",
);

const sentences = (text: string) =>
  text
    // Part lines ("[1/3 Current role]") are display marks, not figures.
    .replace(/^[ \t]*\[\d+\s*\/\s*\d+[^\]\n]*\][ \t]*$/gm, "")
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** The sentences with a figure in them: from the transcript, labelled by
 *  who said them, and from earlier answers (their question lines left out,
 *  since the question is in the transcript). Latest last, without repeats. */
export function collectSaidFigures(
  answers: string[],
  transcript: string,
): string[] {
  const found: string[] = [];
  for (const line of transcript.split("\n")) {
    const m = /^(Interviewer|Me):\s*(.*)$/.exec(line.trim());
    const who = m?.[1] === "Me" ? "Me" : "Them";
    for (const s of sentences(m ? m[2] : line)) {
      if (FIGURE_RE.test(s)) found.push(`${who}: ${s}`);
    }
  }
  for (const answer of answers) {
    // Live answers start with their question ("**Question 2:** …"), which
    // is in the transcript already; only the answer after it counts.
    const body = /^\*\*[^*\n]{1,30}:\*\*/.test(answer)
      ? answer
          .replace(/^[^\n]*\n\n/, "")
          .replace(/^\*\*[^*\n]{1,30}:\*\*\s*/, "")
      : answer;
    for (const s of sentences(body)) {
      if (FIGURE_RE.test(s)) found.push(`Earlier answer: ${s}`);
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (let i = found.length - 1; i >= 0; i--) {
    const key = found[i].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.unshift(found[i].slice(0, MAX_FIGURE_CHARS));
  }
  return unique.slice(-MAX_FIGURES);
}
