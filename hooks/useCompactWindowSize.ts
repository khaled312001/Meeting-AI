"use client";

/** Resize the Electron window whenever focus (compact) mode toggles.
 *
 *  Locks resizability while compact so the user can't drag-stretch the
 *  toolbar to full height. Height is computed from visible panels so
 *  output and inline Ask AI aren't clipped below the frame. */

import { useEffect } from "react";

export const COMPACT_WINDOW_WIDTH = 980;
const FULL_WINDOW = { width: 1180, height: 640 } as const;

/** Focus mode: just the top pill. */
export const COMPACT_HEIGHT_IDLE = 54;
/** The listening / live-line pill under it. */
const COMPACT_HEIGHT_STATUS_ROW = 42;
const COMPACT_HEIGHT_COMPOSER = 68;
const COMPACT_HEIGHT_COMPOSER_IMAGES = 116;
/** Each extra line in the Ask AI box. */
const COMPACT_ASK_ROW = 16;
const COMPACT_HEIGHT_OUTPUT = 340;
export const COMPACT_HEIGHT_OUTPUT_EXPANDED = 560;
const COMPACT_HEIGHT_CONTEXT = 212;
/** Room for the ⋮ menu to drop down without being cut off. */
const COMPACT_HEIGHT_MENU_MIN = 330;

export type CompactLayoutState = {
  showContext: boolean;
  askMode: boolean;
  hasVisibleOutput: boolean;
  hasStatusRow: boolean;
  hasAttachedImages: boolean;
  outputExpanded: boolean;
  /** Lines showing in the Ask AI box (it grows with pasted text). */
  askRows?: number;
  /** The answer panel's height as the user sized it. */
  outputHeight?: number;
  menuOpen: boolean;
};

/** Derive pixel height from which focus-mode panels are open. */
export function resolveCompactHeight(state: CompactLayoutState): number {
  let height = COMPACT_HEIGHT_IDLE;
  if (state.hasStatusRow) height += COMPACT_HEIGHT_STATUS_ROW;
  if (state.showContext) height += COMPACT_HEIGHT_CONTEXT;
  if (state.askMode) {
    height += state.hasAttachedImages
      ? COMPACT_HEIGHT_COMPOSER_IMAGES
      : COMPACT_HEIGHT_COMPOSER;
    height += Math.max(0, (state.askRows ?? 1) - 1) * COMPACT_ASK_ROW;
  }
  if (state.hasVisibleOutput) {
    const output = state.outputHeight ?? COMPACT_HEIGHT_OUTPUT;
    height += state.outputExpanded
      ? Math.max(COMPACT_HEIGHT_OUTPUT_EXPANDED, output)
      : output;
  }
  if (state.menuOpen) height = Math.max(height, COMPACT_HEIGHT_MENU_MIN);
  return height;
}

export function useCompactWindowSize(
  compactMode: boolean,
  compactHeight: number,
  /** Wider than the default when the user widened the answer panel. */
  compactWidth: number = COMPACT_WINDOW_WIDTH,
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.windowSetSize) return;
    if (compactMode) {
      api.windowSetResizable?.(false);
      void api.windowSetSize(Math.max(COMPACT_WINDOW_WIDTH, compactWidth), compactHeight);
    } else {
      void api.windowSetSize(FULL_WINDOW.width, FULL_WINDOW.height);
      api.windowSetResizable?.(true);
    }
  }, [compactMode, compactHeight, compactWidth]);
}
