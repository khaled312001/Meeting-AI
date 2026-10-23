"use client";

/** The two files chosen for this interview: the instructions file (its
 *  rules govern every answer) and the feed. When either is chosen, only
 *  these are sent, so an older copy of a file can't slip in. Kept on this
 *  device. */

import { useCallback, useEffect, useState } from "react";

export interface InterviewFiles {
  instructionsDocId?: string;
  feedDocId?: string;
}

const KEY = "meeting-ai-interview-files";
const listeners = new Set<(files: InterviewFiles) => void>();

export function getInterviewFiles(): InterviewFiles {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}") as InterviewFiles;
    return {
      instructionsDocId:
        typeof parsed.instructionsDocId === "string" ? parsed.instructionsDocId : undefined,
      feedDocId: typeof parsed.feedDocId === "string" ? parsed.feedDocId : undefined,
    };
  } catch {
    return {};
  }
}

function saveInterviewFiles(files: InterviewFiles) {
  try {
    localStorage.setItem(KEY, JSON.stringify(files));
  } catch {
    /* storage unavailable — applies for this session */
  }
  for (const l of listeners) l(files);
}

export function useInterviewFiles() {
  const [files, setFiles] = useState<InterviewFiles>({});
  useEffect(() => {
    setFiles(getInterviewFiles());
    listeners.add(setFiles);
    return () => {
      listeners.delete(setFiles);
    };
  }, []);
  const choose = useCallback((role: keyof InterviewFiles, id: string | undefined) => {
    saveInterviewFiles({ ...getInterviewFiles(), [role]: id || undefined });
  }, []);
  return { files, choose };
}
