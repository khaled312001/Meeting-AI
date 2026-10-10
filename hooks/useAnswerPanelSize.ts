"use client";

/** The focus-mode answer panel's size: set by dragging its edge or corner,
 *  kept between launches (this device only). */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "focus-answer-size.v1";

export type AnswerPanelSize = { width: number; height: number };

/** `height` is the room the panel takes in the focus-mode window. */
export const ANSWER_PANEL_DEFAULT: AnswerPanelSize = { width: 860, height: 340 };
const MIN: AnswerPanelSize = { width: 420, height: 150 };

function clampSize(size: AnswerPanelSize): AnswerPanelSize {
  const screen = typeof window !== "undefined" ? window.screen : undefined;
  const maxW = Math.max(MIN.width, (screen?.availWidth ?? 1920) - 40);
  // Leave room for the bar and the status row above the panel.
  const maxH = Math.max(MIN.height, (screen?.availHeight ?? 1080) - 140);
  const clamp = (v: number, min: number, max: number) =>
    Math.round(Math.max(min, Math.min(max, v)));
  return {
    width: clamp(size.width, MIN.width, maxW),
    height: clamp(size.height, MIN.height, maxH),
  };
}

export function useAnswerPanelSize() {
  const [size, setSizeState] = useState<AnswerPanelSize>(ANSWER_PANEL_DEFAULT);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
        setSizeState(clampSize(saved));
      }
    } catch {
      /* keep the default */
    }
  }, []);

  const setSize = useCallback((next: AnswerPanelSize) => {
    setSizeState(clampSize(next));
  }, []);

  /** Remember the size once a drag ends. */
  const saveSize = useCallback((next: AnswerPanelSize) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clampSize(next)));
    } catch {
      /* not remembered — fine */
    }
  }, []);

  return { size, setSize, saveSize };
}
