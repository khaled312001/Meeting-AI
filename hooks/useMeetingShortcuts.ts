"use client";

/** System-wide desktop shortcuts (registered in the Electron main process)
 *  so the overlay can be driven while the meeting app has focus:
 *  Ctrl/⌘+Alt+Enter answer · Ctrl/⌘+Alt+Backspace clear the answer ·
 *  Ctrl/⌘+Alt+M switch Auto / Manual. */

import { useEffect, useRef } from "react";

interface MeetingShortcutHandlers {
  answer: () => void;
  clearAnswer: () => void;
  toggleMode: () => void;
}

export function useMeetingShortcuts(
  enabled: boolean,
  handlers: MeetingShortcutHandlers,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const off = window.electronAPI?.onShortcut?.((action) => {
      const h = handlersRef.current;
      if (action === "answer") h.answer();
      else if (action === "clear-answer") h.clearAnswer();
      else if (action === "toggle-mode") h.toggleMode();
    });
    return () => off?.();
  }, [enabled]);
}
