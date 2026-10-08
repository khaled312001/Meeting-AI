"use client";

/**
 * Shared Assistant/Summarizer output and mode flag for full + compact surfaces.
 * Persisted to sessionStorage so reloads and mode switches stay in sync.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  APP_SESSION_KEYS,
  migrateLegacySessionKeys,
  readAppSession,
  writeAppSession,
} from "@/lib/app-session-storage";
import { FLAGS, type AnswerCitation } from "@/lib/types";
import type { CompactOutputMode } from "@/components/compact/OutputPanel";

export type AnswerKind = "answer" | "review";

/** An earlier answer kept above the current one. */
export interface PastAnswer {
  id: string;
  text: string;
  citations: AnswerCitation[];
  /** When it was written (ms since epoch). */
  at?: number;
  kind?: AnswerKind;
}

/** Answer on their own when a question ends, or only on request. */
export type AnswerMode = "auto" | "manual";

const MAX_PAST_ANSWERS = 30;
/** Earlier answers sent along so follow-ups stay consistent. */
const MAX_REMEMBERED_ANSWERS = 8;
const MAX_REMEMBERED_CHARS = 1500;
const ANSWER_MODE_KEY = "meeting-ai-answer-mode";

interface AnswerMeta {
  at: number | null;
  kind: AnswerKind;
}

function readAnswerMeta(): AnswerMeta {
  try {
    const parsed = JSON.parse(
      readAppSession(APP_SESSION_KEYS.answerMeta) || "{}",
    ) as Partial<AnswerMeta>;
    return {
      at: typeof parsed.at === "number" ? parsed.at : null,
      kind: parsed.kind === "review" ? "review" : "answer",
    };
  } catch {
    return { at: null, kind: "answer" };
  }
}

function readPastAnswers(): PastAnswer[] {
  try {
    const parsed: unknown = JSON.parse(
      readAppSession(APP_SESSION_KEYS.pastAnswers) || "[]",
    );
    return Array.isArray(parsed) ? (parsed as PastAnswer[]) : [];
  } catch {
    return [];
  }
}

type AssistantSessionValue = {
  completion: string;
  setCompletion: Dispatch<SetStateAction<string>>;
  /** Knowledge-file passages cited by the current answer (Anthropic only). */
  citations: AnswerCitation[];
  setCitations: Dispatch<SetStateAction<AnswerCitation[]>>;
  flag: FLAGS;
  setFlag: Dispatch<SetStateAction<FLAGS>>;
  outputMode: CompactOutputMode;
  setOutputMode: Dispatch<SetStateAction<CompactOutputMode>>;
  /** Earlier answers, oldest first; the live one is `completion`. */
  pastAnswers: PastAnswer[];
  /** When the current answer was started, and what it is. */
  answerAt: number | null;
  answerKind: AnswerKind;
  /** Move the current answer into the history (or drop it, with
   *  `replace`) and start an empty one. Returns the earlier answers, oldest
   *  first, for the model to stay consistent with. */
  startNewAnswer: (opts?: { replace?: boolean; kind?: AnswerKind }) => string[];
  /** Earlier answers (not reviews), oldest first, trimmed for a request. */
  getRememberedAnswers: () => string[];
  answerMode: AnswerMode;
  setAnswerMode: (mode: AnswerMode) => void;
  /** Drop the history and the current answer. */
  clearAnswers: () => void;
};


const AssistantSessionContext = createContext<AssistantSessionValue | null>(null);


function readOutputMode(): CompactOutputMode {
  const stored = readAppSession(APP_SESSION_KEYS.outputMode);
  return stored === "chat" ? "chat" : "transcript";
}

export function AssistantSessionProvider({ children }: { children: ReactNode }) {
  const [completion, setCompletion] = useState("");
  const [citations, setCitations] = useState<AnswerCitation[]>([]);
  const [flag, setFlag] = useState<FLAGS>(FLAGS.ASSISTANT);
  const [outputMode, setOutputMode] = useState<CompactOutputMode>("transcript");
  const [pastAnswers, setPastAnswers] = useState<PastAnswer[]>([]);
  // Read by startNewAnswer so it stays stable for the generate callbacks.
  const completionRef = useRef(completion);
  completionRef.current = completion;
  const citationsRef = useRef(citations);
  citationsRef.current = citations;

  const [answerMeta, setAnswerMeta] = useState<AnswerMeta>({
    at: null,
    kind: "answer",
  });
  const answerMetaRef = useRef(answerMeta);
  answerMetaRef.current = answerMeta;
  const pastAnswersRef = useRef(pastAnswers);
  pastAnswersRef.current = pastAnswers;

  const [answerMode, setAnswerModeState] = useState<AnswerMode>("auto");
  const setAnswerMode = useCallback((mode: AnswerMode) => {
    setAnswerModeState(mode);
    try {
      localStorage.setItem(ANSWER_MODE_KEY, mode);
    } catch {
      /* storage unavailable — applies for this session */
    }
  }, []);

  const getRememberedAnswers = useCallback(() => {
    const all: PastAnswer[] = [...pastAnswersRef.current];
    if (completionRef.current.trim()) {
      all.push({
        id: "current",
        text: completionRef.current,
        citations: [],
        kind: answerMetaRef.current.kind,
      });
    }
    return all
      .filter((a) => a.kind !== "review" && a.text.trim())
      .slice(-MAX_REMEMBERED_ANSWERS)
      .map((a) => a.text.trim().slice(0, MAX_REMEMBERED_CHARS));
  }, []);

  const startNewAnswer = useCallback(
    (opts?: { replace?: boolean; kind?: AnswerKind }) => {
      const text = completionRef.current;
      let past = pastAnswersRef.current;
      if (text.trim() && !opts?.replace) {
        const entry: PastAnswer = {
          id: `answer-${Date.now().toString(36)}`,
          text,
          citations: citationsRef.current,
          at: answerMetaRef.current.at ?? undefined,
          kind: answerMetaRef.current.kind,
        };
        past = [...past, entry].slice(-MAX_PAST_ANSWERS);
        pastAnswersRef.current = past;
        setPastAnswers(past);
      }
      completionRef.current = "";
      setCompletion("");
      setCitations([]);
      const meta: AnswerMeta = { at: Date.now(), kind: opts?.kind ?? "answer" };
      answerMetaRef.current = meta;
      setAnswerMeta(meta);
      return past
        .filter((a) => a.kind !== "review" && a.text.trim())
        .slice(-MAX_REMEMBERED_ANSWERS)
        .map((a) => a.text.trim().slice(0, MAX_REMEMBERED_CHARS));
    },
    [],
  );

  const clearAnswers = useCallback(() => {
    setPastAnswers([]);
    setCompletion("");
    setCitations([]);
    setAnswerMeta({ at: null, kind: "answer" });
  }, []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    migrateLegacySessionKeys();
    setCompletion(readAppSession(APP_SESSION_KEYS.completion));
    setOutputMode(readOutputMode());
    setPastAnswers(readPastAnswers());
    setAnswerMeta(readAnswerMeta());
    try {
      if (localStorage.getItem(ANSWER_MODE_KEY) === "manual")
        setAnswerModeState("manual");
    } catch {
      /* storage unavailable — keep Auto */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.completion, completion);
  }, [completion, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(
      APP_SESSION_KEYS.pastAnswers,
      pastAnswers.length ? JSON.stringify(pastAnswers) : "",
    );
  }, [pastAnswers, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.answerMeta, JSON.stringify(answerMeta));
  }, [answerMeta, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.flag, flag);
  }, [flag, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.outputMode, outputMode);
  }, [outputMode, ready]);

  return (
    <AssistantSessionContext.Provider
      value={{
        completion,
        setCompletion,
        citations,
        setCitations,
        flag,
        setFlag,
        outputMode,
        setOutputMode,
        pastAnswers,
        answerAt: answerMeta.at,
        answerKind: answerMeta.kind,
        startNewAnswer,
        getRememberedAnswers,
        answerMode,
        setAnswerMode,
        clearAnswers,
      }}
    >
      {children}
    </AssistantSessionContext.Provider>
  );
}

export function useAssistantSession() {
  const ctx = useContext(AssistantSessionContext);
  if (!ctx) {
    throw new Error(
      "useAssistantSession must be used within AssistantSessionProvider",
    );
  }
  return ctx;
}
