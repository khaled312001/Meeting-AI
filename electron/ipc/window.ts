import { app, BrowserWindow, ipcMain, screen } from "electron";

import { minimizeWindow } from "../tray";

const WINDOW_FOCUS_CHANNEL = "window:focus";

type WindowAccessor = () => BrowserWindow | null;

interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How often the overlay checks where the cursor is. */
const HIT_POLL_MS = 30;
/** Slack around each control so edges don't flicker. */
const HIT_PAD = 4;

/** Focus-mode click-through, decided here in the main process.
 *
 *  The renderer reports where its controls are (window-relative CSS
 *  pixels). While rects are set, the cursor position is polled: over a
 *  control the window takes clicks, anywhere else they pass through to
 *  the app behind. This doesn't depend on forwarded mouse-move events,
 *  which Windows stops delivering once a window ignores the mouse. */
function createHitTester(getWindow: WindowAccessor) {
  let rects: HitRect[] | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ignoring: boolean | null = null;

  const apply = (w: BrowserWindow, ignore: boolean) => {
    if (ignoring === ignore) return;
    ignoring = ignore;
    try {
      if (ignore) w.setIgnoreMouseEvents(true, { forward: true });
      else w.setIgnoreMouseEvents(false);
    } catch {
      /* destroyed mid-call */
    }
  };

  const tick = () => {
    const w = getWindow();
    if (!w || w.isDestroyed() || !rects) return;
    const cursor = screen.getCursorScreenPoint();
    const b = w.getContentBounds();
    const zoom = w.webContents.getZoomFactor() || 1;
    const x = (cursor.x - b.x) / zoom;
    const y = (cursor.y - b.y) / zoom;
    const over = rects.some(
      (r) =>
        x >= r.x - HIT_PAD &&
        x <= r.x + r.width + HIT_PAD &&
        y >= r.y - HIT_PAD &&
        y <= r.y + r.height + HIT_PAD,
    );
    apply(w, !over);
  };

  return {
    set(next: HitRect[] | null) {
      rects = next;
      if (next && !timer) {
        timer = setInterval(tick, HIT_POLL_MS);
      } else if (!next && timer) {
        clearInterval(timer);
        timer = null;
        const w = getWindow();
        if (w && !w.isDestroyed()) apply(w, false);
        ignoring = null;
      }
      if (next) tick();
    },
  };
}

/** The size the window keeps while it is dragged. On Windows with display
 *  scaling above 100%, moving a window by position alone rounds its size
 *  on every step, so a drag made the bar grow and shrink. */
let heldSize: { width: number; height: number } | null = null;
/** The size focus mode asked for last (the window is locked to it). */
let askedSize: { width: number; height: number } | null = null;
let lastMoveAt = 0;
/** A pause this long between moves starts a new drag. */
const NEW_DRAG_MS = 300;
/** At least this much of the bar stays on screen at the bottom. */
const MIN_VISIBLE_HEIGHT = 60;

/** Move the window without changing its size, kept on the screen it is
 *  moved to so the bar can't be dragged out of reach. */
export function moveWindow(w: BrowserWindow, x: number, y: number): void {
  const now = Date.now();
  if (!heldSize || now - lastMoveAt > NEW_DRAG_MS) {
    const [width, height] = w.getSize();
    heldSize = !w.isResizable() && askedSize ? askedSize : { width, height };
  }
  lastMoveAt = now;
  const { width, height } = heldSize;
  const wa = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y),
  }).workArea;
  const nextX =
    width <= wa.width
      ? Math.min(Math.max(x, wa.x), wa.x + wa.width - width)
      : wa.x;
  const nextY = Math.min(
    Math.max(y, wa.y),
    wa.y + wa.height - MIN_VISIBLE_HEIGHT,
  );
  w.setBounds(
    { x: Math.round(nextX), y: Math.round(nextY), width, height },
    false,
  );
  // A locked (focus mode) window can refuse the size: put it back.
  const [nowW, nowH] = w.getSize();
  if (nowW !== width || nowH !== height) {
    const resizable = w.isResizable();
    if (!resizable) w.setResizable(true);
    w.setSize(width, height, false);
    if (!resizable) w.setResizable(false);
  }
}

/** Window control IPC. Channel names and payload shapes are intentionally
 *  preserved verbatim — they are consumed by the preload script and any
 *  rename would silently break the renderer. */
export function registerWindowIpc(getWindow: WindowAccessor): void {
  const hitTester = createHitTester(getWindow);
  ipcMain.on("window-set-hit-rects", (_, rects: unknown) => {
    if (rects === null) return hitTester.set(null);
    if (!Array.isArray(rects)) return;
    const valid = rects
      .filter(
        (r): r is HitRect =>
          !!r &&
          typeof r === "object" &&
          ["x", "y", "width", "height"].every((k) =>
            Number.isFinite((r as Record<string, unknown>)[k]),
          ),
      )
      .slice(0, 300);
    hitTester.set(valid);
  });

  // Hidden to the tray when the app is kept out of the taskbar.
  ipcMain.handle("window-minimize", () => {
    minimizeWindow(getWindow());
  });

  ipcMain.handle("window-maximize", () => {
    const w = getWindow();
    if (w?.isMaximized()) {
      w.unmaximize();
      return false;
    } else {
      w?.maximize();
      return true;
    }
  });

  // The close button quits the app on every platform. On macOS, closing
  // the window alone would leave it running with no Dock icon to reach it.
  ipcMain.handle("window-close", () => {
    app.quit();
  });

  ipcMain.handle("window-always-on-top", (_, flag: boolean) => {
    getWindow()?.setAlwaysOnTop(flag);
    return flag;
  });

  ipcMain.handle("window-set-size", (_, width: number, height: number) => {
    const w = getWindow();
    if (!w) return;
    const [currentWidth, currentHeight] = w.getSize();
    const display = screen.getDisplayMatching(w.getBounds());
    const maxW = display.workAreaSize.width;
    const maxH = display.workAreaSize.height;
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Math.round(v)));
    const nextW =
      Number.isFinite(width) && width > 0
        ? clamp(width, 200, maxW)
        : currentWidth;
    const nextH =
      Number.isFinite(height) && height > 0
        ? clamp(height, 100, maxH)
        : currentHeight;
    askedSize = { width: nextW, height: nextH };
    // A drag in progress keeps the new size from here on.
    if (heldSize) heldSize = askedSize;
    if (nextW !== currentWidth || nextH !== currentHeight) {
      // A change of width keeps the bar centred where it was, still on
      // the screen.
      const [x, y] = w.getPosition();
      const wa = display.workArea;
      const centred = x + Math.round((currentWidth - nextW) / 2);
      const nextX =
        nextW <= wa.width
          ? Math.min(Math.max(centred, wa.x), wa.x + wa.width - nextW)
          : wa.x;
      // Windows ignores a new size on a non-resizable window (focus mode
      // locks resizing), so unlock it for the call.
      const resizable = w.isResizable();
      if (!resizable) w.setResizable(true);
      w.setBounds({ x: nextX, y, width: nextW, height: nextH }, false);
      if (!resizable) w.setResizable(false);
    }
  });

  // Focus mode moves the window from the renderer (drag the bar): CSS drag
  // regions are unreliable on Windows once click-through has toggled.
  ipcMain.on("window-set-position", (_, x: number, y: number) => {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    moveWindow(w, x, y);
  });

  ipcMain.handle("window-set-resizable", (_, resizable: boolean) => {
    const w = getWindow();
    if (!w) return false;
    // setResizable on macOS also disables the green "zoom" button which is
    // exactly what we want in compact mode — no drag-edge resize, no zoom.
    w.setResizable(!!resizable);
    return w.isResizable();
  });

  // Used by the compact overlay to make most of its (transparent) surface
  // click-through so the user can click the app behind. The renderer
  // tracks mouse position over interactive regions (toolbar/drawers) and
  // flips this back to false when the cursor enters them. `forward: true`
  // keeps mousemove events flowing into the renderer even while ignored,
  // which is what lets that tracking work.
  ipcMain.handle(
    "window-set-ignore-mouse-events",
    (_, ignore: boolean, options?: { forward?: boolean }) => {
      const w = getWindow();
      if (!w) return;
      try {
        w.setIgnoreMouseEvents(!!ignore, options ?? undefined);
      } catch {
        /* destroyed mid-call — ignore */
      }
    },
  );

  ipcMain.handle("window-is-always-on-top", () => {
    return getWindow()?.isAlwaysOnTop() || false;
  });

  ipcMain.handle("window-is-maximized", () => {
    return getWindow()?.isMaximized() || false;
  });

  ipcMain.handle("window-focus", () => {
    const w = getWindow();
    if (!w) return;
    if (!w.isVisible()) w.show();
    w.focus();
  });
}

/** Notify renderer when the OS window gains focus (alt-tab back, etc.). */
export function attachWindowFocusNotifier(window: BrowserWindow): void {
  const notify = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_FOCUS_CHANNEL);
    }
  };
  window.on("focus", notify);
}
