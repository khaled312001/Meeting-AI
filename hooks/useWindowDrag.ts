"use client";

/** Drag the desktop window by any empty part of an element (focus mode
 *  bar). Moves the window from the renderer instead of a CSS drag region,
 *  which stops responding on Windows once click-through has toggled.
 *  Presses on buttons, inputs and menus keep working as usual. */

import { useCallback, useRef } from "react";

const SKIP_SELECTOR =
  'button, a, input, textarea, select, [role="menu"], [role="menuitem"], [role="radio"], [data-no-drag]';

export function useWindowDrag() {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    frame: number | null;
    nextX: number;
    nextY: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const api = window.electronAPI;
    if (!api?.windowSetPosition || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(SKIP_SELECTOR)) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
      frame: null,
      nextX: window.screenX,
      nextY: window.screenY,
    };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.nextX = d.winX + (ev.screenX - d.startX);
      d.nextY = d.winY + (ev.screenY - d.startY);
      // One move per frame keeps it smooth without flooding IPC.
      if (d.frame === null) {
        d.frame = requestAnimationFrame(() => {
          d.frame = null;
          api.windowSetPosition?.(d.nextX, d.nextY);
        });
      }
    };
    const onEnd = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      if (d.frame !== null) cancelAnimationFrame(d.frame);
      api.windowSetPosition?.(d.nextX, d.nextY);
      drag.current = null;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
  }, []);

  return { onPointerDown };
}
