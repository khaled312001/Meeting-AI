/** Auto language: each audio source is transcribed twice at once — by the
 *  Arabic model, and by the multilingual model (English, German, …). The
 *  multilingual model alone turns Arabic into Persian, Hebrew or Swedish;
 *  the Arabic model hears English as next to nothing. So for each stretch
 *  of speech the line with more words heard wins: Arabic speech (English
 *  words in it included) comes from the Arabic model, English and German
 *  from the multilingual one. Lines are compared on the wall clock, since
 *  the two streams start a moment apart. */

export type Lane = "ar" | "multi";

export interface HeardLine<T> {
  lane: Lane;
  /** Wall-clock span of the words, in ms. */
  start: number;
  end: number;
  words: number;
  /** Share of the words the multilingual model tagged English or German. */
  latin: number;
  /** Share it tagged Arabic. */
  arabic: number;
  /** When the line arrived. */
  at: number;
  line: T;
}

/** How long a multilingual line waits for the Arabic model's line. */
const WAIT_MS = 500;
/** An Arabic line with no multilingual line over it is shown after this. */
const LONE_MS = 1500;
/** Lines this close count as the same stretch of speech. */
const SLACK_MS = 400;
/** The Arabic model wins when it heard at least this share of the words. */
const ARABIC_SHARE = 0.6;

const mid = (l: HeardLine<unknown>) => (l.start + l.end) / 2;

/** Lines from both models for one audio source, settled into one. */
export function createLanguagePicker<T>(emit: (line: T, lane: Lane) => void) {
  let multi: HeardLine<unknown>[] = [];
  let ar: HeardLine<unknown>[] = [];
  /** The model whose lines were shown last (its interim lines show too). */
  let current: Lane = "multi";

  const over = (m: HeardLine<unknown>, a: HeardLine<unknown>) =>
    mid(a) >= m.start - SLACK_MS && mid(a) <= m.end + SLACK_MS;

  /** Settle what can be settled now; true when lines are still waiting. */
  function settle(now = Date.now()): boolean {
    multi.sort((x, y) => x.start - y.start);
    ar.sort((x, y) => x.start - y.start);
    for (;;) {
      const m = multi[0];
      const lone = ar[0];
      // An Arabic line that no multilingual line covers, waited for long enough.
      if (lone && (!m || mid(lone) < m.start - SLACK_MS) && now - lone.at >= LONE_MS) {
        ar.shift();
        current = "ar";
        emit(lone.line as T, "ar");
        continue;
      }
      if (!m) break;
      const covering = ar.filter((a) => over(m, a));
      const arCaughtUp = ar.some((a) => a.end >= m.end - SLACK_MS);
      if (!arCaughtUp && now - m.at < WAIT_MS) break;
      multi.shift();
      ar = ar.filter((a) => !covering.includes(a));
      const arWords = covering.reduce((n, a) => n + a.words, 0);
      const arabic =
        arWords > 0 && (arWords >= ARABIC_SHARE * m.words || m.latin < 0.5);
      if (arabic) {
        current = "ar";
        for (const a of covering) emit(a.line as T, "ar");
      } else if (m.latin >= 0.5 || m.arabic >= 0.5) {
        current = "multi";
        emit(m.line as T, "multi");
      }
      // Otherwise: the multilingual model guessed another language and the
      // Arabic model heard nothing there — noise, not speech.
    }
    return multi.length > 0 || ar.length > 0;
  }

  return {
    add(line: HeardLine<T>) {
      (line.lane === "ar" ? ar : multi).push(line);
      return settle(line.at);
    },
    settle,
    /** The model whose interim lines to show. */
    get current() {
      return current;
    },
    clear() {
      multi = [];
      ar = [];
    },
  };
}
