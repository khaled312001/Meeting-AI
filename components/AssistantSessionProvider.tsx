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

/** An earlier answer kept above the current one. */
export interface PastAnswer {
  id: string;
  text: string;
  citations: AnswerCitation[];
}

const MAX_PAST_ANSWERS = 30;

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
  /** Move the current answer into the history and start an empty one. */
  startNewAnswer: () => void;
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

  const startNewAnswer = useCallback(() => {
    const text = completionRef.current;
    if (text.trim()) {
      const past: PastAnswer = {
        id: `answer-${Date.now().toString(36)}`,
        text,
        citations: citationsRef.current,
      };
      setPastAnswers((prev) => [...prev, past].slice(-MAX_PAST_ANSWERS));
    }
    setCompletion("");
    setCitations([]);
  }, []);

  const clearAnswers = useCallback(() => {
    setPastAnswers([]);
    setCompletion("");
    setCitations([]);
  }, []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    migrateLegacySessionKeys();
    setCompletion(readAppSession(APP_SESSION_KEYS.completion));
    setOutputMode(readOutputMode());
    setPastAnswers(readPastAnswers());
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
        startNewAnswer,
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
