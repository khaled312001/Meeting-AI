/** Picks the transcription stream that matches the spoken language.
 *
 *  Deepgram's multilingual mode ("multi") code-switches across English,
 *  German, French, Spanish and others but not Arabic, which needs its own
 *  stream. Both streams hear the same audio; each stream's recent finals are
 *  scored by summed squared word confidence (a wrong-language model still
 *  emits words, but unsure ones), and the transcript follows the stream
 *  that recognises the speech clearly better. On a switch, the last few
 *  seconds already shown are replaced with the winning stream's text, so a
 *  sentence never mixes the two. */

import type { TranscriptionWord } from "@/lib/types";

export type StreamLang = "multi" | "ar";
export const STREAM_LANGS: readonly StreamLang[] = ["multi", "ar"];

export interface FinalChunk {
  id: string;
  lang: StreamLang;
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
  confidence: number;
  speaker?: number;
}

export interface ArbiterChange {
  add: FinalChunk[];
  remove: string[];
}

const NO_CHANGE: ArbiterChange = { add: [], remove: [] };

export class LanguageArbiter {
  active: StreamLang = "multi";
  private finals: Record<StreamLang, FinalChunk[]> = { multi: [], ar: [] };

  constructor(
    /** Seconds of recent audio compared (and replaceable on a switch). */
    private readonly windowSec = 12,
    /** How much better the other stream must score to take over. */
    private readonly margin = 1.2,
  ) {}

  /** Stream timestamps restart on reconnect; drop the old timeline. */
  reset(): void {
    this.finals = { multi: [], ar: [] };
  }

  addFinal(chunk: FinalChunk): ArbiterChange {
    const list = this.finals[chunk.lang];
    list.push(chunk);
    const from = chunk.end - this.windowSec;
    // Keep memory bounded: older chunks can no longer be replaced.
    while (list.length > 0 && list[0].end < from - this.windowSec) list.shift();

    const other: StreamLang = this.active === "multi" ? "ar" : "multi";
    const activeScore = this.score(this.active, from);
    const otherScore = this.score(other, from);
    if (
      this.wordCount(other, from) >= 3 &&
      otherScore > activeScore * this.margin + 0.3
    ) {
      const remove = this.finals[this.active]
        .filter((c) => c.end > from)
        .map((c) => c.id);
      this.active = other;
      return {
        add: this.finals[other].filter((c) => c.end > from),
        remove,
      };
    }
    return chunk.lang === this.active ? { add: [chunk], remove: [] } : NO_CHANGE;
  }

  private recent(lang: StreamLang, from: number): FinalChunk[] {
    return this.finals[lang].filter((c) => c.end > from);
  }

  private score(lang: StreamLang, from: number): number {
    return this.recent(lang, from).reduce(
      (sum, c) =>
        sum + c.words.reduce((s, w) => s + (w.confidence ?? 0) ** 2, 0),
      0,
    );
  }

  private wordCount(lang: StreamLang, from: number): number {
    return this.recent(lang, from).reduce((n, c) => n + c.words.length, 0);
  }
}
