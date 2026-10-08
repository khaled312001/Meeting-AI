"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWindowIpc = registerWindowIpc;
exports.attachWindowFocusNotifier = attachWindowFocusNotifier;
const electron_1 = require("electron");
const WINDOW_FOCUS_CHANNEL = "window:focus";
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
function createHitTester(getWindow) {
    let rects = null;
    let timer = null;
    let ignoring = null;
    const apply = (w, ignore) => {
        if (ignoring === ignore)
            return;
        ignoring = ignore;
        try {
            if (ignore)
                w.setIgnoreMouseEvents(true, { forward: true });
            else
                w.setIgnoreMouseEvents(false);
        }
        catch {
            /* destroyed mid-call */
        }
    };
    const tick = () => {
        const w = getWindow();
        if (!w || w.isDestroyed() || !rects)
            return;
        const cursor = electron_1.screen.getCursorScreenPoint();
        const b = w.getContentBounds();
        const zoom = w.webContents.getZoomFactor() || 1;
        const x = (cursor.x - b.x) / zoom;
        const y = (cursor.y - b.y) / zoom;
        const over = rects.some((r) => x >= r.x - HIT_PAD &&
            x <= r.x + r.width + HIT_PAD &&
            y >= r.y - HIT_PAD &&
            y <= r.y + r.height + HIT_PAD);
        apply(w, !over);
    };
    return {
        set(next) {
            rects = next;
            if (next && !timer) {
                timer = setInterval(tick, HIT_POLL_MS);
            }
            else if (!next && timer) {
                clearInterval(timer);
                timer = null;
                const w = getWindow();
                if (w && !w.isDestroyed())
                    apply(w, false);
                ignoring = null;
            }
            if (next)
                tick();
        },
    };
}
/** Window control IPC. Channel names and payload shapes are intentionally
 *  preserved verbatim — they are consumed by the preload script and any
 *  rename would silently break the renderer. */
function registerWindowIpc(getWindow) {
    const hitTester = createHitTester(getWindow);
    electron_1.ipcMain.on("window-set-hit-rects", (_, rects) => {
        if (rects === null)
            return hitTester.set(null);
        if (!Array.isArray(rects))
            return;
        const valid = rects
            .filter((r) => !!r &&
            typeof r === "object" &&
            ["x", "y", "width", "height"].every((k) => Number.isFinite(r[k])))
            .slice(0, 300);
        hitTester.set(valid);
    });
    electron_1.ipcMain.handle("window-minimize", () => {
        getWindow()?.minimize();
    });
    electron_1.ipcMain.handle("window-maximize", () => {
        const w = getWindow();
        if (w?.isMaximized()) {
            w.unmaximize();
            return false;
        }
        else {
            w?.maximize();
            return true;
        }
    });
    // The close button quits the app on every platform. On macOS, closing
    // the window alone would leave it running with no Dock icon to reach it.
    electron_1.ipcMain.handle("window-close", () => {
        electron_1.app.quit();
    });
    electron_1.ipcMain.handle("window-always-on-top", (_, flag) => {
        getWindow()?.setAlwaysOnTop(flag);
        return flag;
    });
    electron_1.ipcMain.handle("window-set-size", (_, width, height) => {
        const w = getWindow();
        if (!w)
            return;
        const [currentWidth, currentHeight] = w.getSize();
        const display = electron_1.screen.getDisplayMatching(w.getBounds());
        const maxW = display.workAreaSize.width;
        const maxH = display.workAreaSize.height;
        const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
        const nextW = Number.isFinite(width) && width > 0
            ? clamp(width, 200, maxW)
            : currentWidth;
        const nextH = Number.isFinite(height) && height > 0
            ? clamp(height, 100, maxH)
            : currentHeight;
        if (nextW !== currentWidth || nextH !== currentHeight) {
            // Windows ignores setSize on a non-resizable window (focus mode
            // locks resizing), so unlock it for the call.
            const resizable = w.isResizable();
            if (!resizable)
                w.setResizable(true);
            w.setSize(nextW, nextH, false);
            if (!resizable)
                w.setResizable(false);
        }
    });
    // Focus mode moves the window from the renderer (drag the bar): CSS drag
    // regions are unreliable on Windows once click-through has toggled.
    electron_1.ipcMain.on("window-set-position", (_, x, y) => {
        const w = getWindow();
        if (!w || w.isDestroyed())
            return;
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return;
        w.setPosition(Math.round(x), Math.round(y));
    });
    electron_1.ipcMain.handle("window-set-resizable", (_, resizable) => {
        const w = getWindow();
        if (!w)
            return false;
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
    electron_1.ipcMain.handle("window-set-ignore-mouse-events", (_, ignore, options) => {
        const w = getWindow();
        if (!w)
            return;
        try {
            w.setIgnoreMouseEvents(!!ignore, options ?? undefined);
        }
        catch {
            /* destroyed mid-call — ignore */
        }
    });
    electron_1.ipcMain.handle("window-is-always-on-top", () => {
        return getWindow()?.isAlwaysOnTop() || false;
    });
    electron_1.ipcMain.handle("window-is-maximized", () => {
        return getWindow()?.isMaximized() || false;
    });
    electron_1.ipcMain.handle("window-focus", () => {
        const w = getWindow();
        if (!w)
            return;
        if (!w.isVisible())
            w.show();
        w.focus();
    });
}
/** Notify renderer when the OS window gains focus (alt-tab back, etc.). */
function attachWindowFocusNotifier(window) {
    const notify = () => {
        if (!window.isDestroyed()) {
            window.webContents.send(WINDOW_FOCUS_CHANNEL);
        }
    };
    window.on("focus", notify);
}
