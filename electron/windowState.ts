import { app, screen, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Persist window geometry and overlay preferences across launches.
 *
 * Stored as JSON in userData so it survives updates without an extra
 * dependency. Bounds are validated against the current displays before
 * being applied — a saved position on a detached monitor must never
 * resurrect the window off-screen.
 */

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  bounds?: WindowBounds;
  alwaysOnTop?: boolean;
}

/** Generic small-persist helper reused for other launch-once flags
 *  (e.g. mic permission prompts) so we don't grow more files. */
const STATE_FILE = () =>
  path.join(app.getPath("userData"), "window-state.json");

function readStateFile<T>(fallback: T): T {
  try {
    const raw = fs.readFileSync(STATE_FILE(), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStateFile(state: Record<string, unknown>): void {
  try {
    const merged = { ...readStateFile<Record<string, unknown>>({}), ...state };
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* best-effort persistence */
  }
}

export function loadWindowState(): PersistedWindowState {
  return readStateFile<PersistedWindowState>({});
}

/** Read a namespaced value previously written via `writeStateValue`. */
export function readStateValue<T>(key: string): T | undefined {
  const state = readStateFile<Record<string, unknown>>({});
  return state[key] as T | undefined;
}

export function writeStateValue(key: string, value: unknown): void {
  writeStateFile({ [key]: value });
}

/** Saved bounds are only usable when they intersect a current display. */
function boundsAreVisible(bounds: WindowBounds): boolean {
  try {
    return screen.getAllDisplays().some((display) => {
      const wa = display.workArea;
      return (
        bounds.x + bounds.width > wa.x &&
        bounds.y + bounds.height / 2 > wa.y &&
        bounds.x < wa.x + wa.width &&
        bounds.y < wa.y + wa.height
      );
    });
  } catch {
    return false;
  }
}

export function loadRestoredBounds(): WindowBounds | null {
  const { bounds } = loadWindowState();
  if (
    !bounds ||
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    return null;
  }
  return boundsAreVisible(bounds) ? bounds : null;
}

let saveTimer: NodeJS.Timeout | null = null;

function scheduleSave(window: BrowserWindow): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow(window);
  }, 500);
}

function persistNow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  try {
    writeStateFile({
      bounds: window.getNormalBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
    });
  } catch {
    /* best-effort persistence */
  }
}

/** Track a window and persist its bounds/preferences until closed. */
export function trackWindowState(window: BrowserWindow): void {
  const onChange = () => scheduleSave(window);
  window.on("resize", onChange);
  window.on("move", onChange);
  window.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistNow(window);
  });
}
