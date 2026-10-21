// Global type definitions for Electron API

type ScreenAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

type ScreenCaptureResult =
  | { success: true; dataUrl: string }
  | { success: false; error: string };

type UpdaterStatusPayload =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

/** Google Calendar / Tasks (desktop only; everything runs in the main
 *  process, see electron/googleAuth.ts and electron/googleApi.ts). */
export type GoogleErrorCode =
  | "not-configured"
  | "not-connected"
  | "reauth"
  | "cancelled"
  | "missing-scope"
  | "network"
  | "google"
  | "unknown";

export type CalendarResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: GoogleErrorCode; error: string };

export interface GoogleAccountStatus {
  /** A Google OAuth client id is baked into this build. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  canUseCalendar: boolean;
  canUseTasks: boolean;
  /** False when the sign-in can't be kept across restarts. */
  persisted: boolean;
  signingIn: boolean;
}

export type MeetingProvider = "meet" | "zoom" | "teams" | "webex" | "other";

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO date-time (all-day events: local midnight). */
  start: string;
  end: string;
  allDay: boolean;
  joinUrl: string | null;
  provider: MeetingProvider | null;
  isInterview: boolean;
  htmlLink: string | null;
  location: string | null;
  organizer: string | null;
  attendees: number;
}

export interface NewCalendarEventInput {
  title: string;
  /** ISO date-time. */
  start: string;
  durationMinutes: number;
  addMeet: boolean;
  timeZone: string;
  description?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD */
  due: string | null;
}

export interface CalendarAPI {
  getStatus: () => Promise<CalendarResult<GoogleAccountStatus>>;
  /** Opens Google's consent page in the browser; resolves after sign-in. */
  connect: () => Promise<CalendarResult<GoogleAccountStatus>>;
  cancelConnect: () => Promise<CalendarResult<GoogleAccountStatus>>;
  disconnect: () => Promise<CalendarResult<GoogleAccountStatus>>;
  /** Primary calendar, now until 7 days ahead. Also arms reminders. */
  listEvents: () => Promise<CalendarResult<CalendarEvent[]>>;
  createEvent: (
    input: NewCalendarEventInput,
  ) => Promise<CalendarResult<CalendarEvent>>;
  /** Open a meeting / event link in the default browser. */
  openLink: (url: string) => Promise<CalendarResult<boolean>>;
  listTasks: () => Promise<CalendarResult<GoogleTask[]>>;
  addTask: (input: {
    title: string;
    due?: string;
  }) => Promise<CalendarResult<GoogleTask>>;
  completeTask: (id: string) => Promise<CalendarResult<boolean>>;
  /** A meeting reminder notification was clicked. */
  onOpenEvent: (callback: (eventId: string) => void) => () => void;
}

export interface ElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  windowIsMaximized: () => Promise<boolean>;
  windowSetSize: (width: number, height: number) => Promise<void>;
  windowSetResizable: (resizable: boolean) => Promise<boolean>;
  /**
   * Toggle Electron's `setIgnoreMouseEvents` so the (mostly transparent)
   * compact overlay can pass clicks through to the app behind. Pass
   * `{ forward: true }` so mousemove events still reach the renderer,
   * which is what lets it detect the cursor entering an interactive
   * region and flip back to non-ignored.
   */
  windowSetIgnoreMouseEvents?: (
    ignore: boolean,
    options?: { forward?: boolean },
  ) => Promise<void>;
  windowFocus?: () => Promise<void>;
  /** Move the window (screen coordinates) — focus-mode bar dragging. */
  windowSetPosition?: (x: number, y: number) => void;
  /** Focus-mode click-through: where the controls are (window CSS px);
   *  null turns click-through off. */
  windowSetHitRects?: (
    rects: Array<{ x: number; y: number; width: number; height: number }> | null,
  ) => void;
  onWindowFocus?: (callback: () => void) => () => void;
  /** System-wide shortcuts: "answer" | "clear-answer" | "toggle-mode". */
  onShortcut?: (callback: (action: string) => void) => () => void;
  appQuit: () => Promise<void>;
  /** Render a meeting summary (HTML) to a PDF in Downloads; returns its path. */
  saveSummaryPdf?: (html: string, baseName: string) => Promise<string>;
  /** Open / reveal a file saved by saveSummaryPdf. */
  openSavedFile?: (file: string) => Promise<boolean>;
  showSavedFile?: (file: string) => Promise<boolean>;
  /** A meeting still needs its summary: quitting saves it first. */
  setMeetingPending?: (pending: boolean) => void;
  /** The summary asked for before quitting is done (or failed). */
  meetingFinished?: () => void;
  onFinishMeetingBeforeQuit?: (callback: () => void) => () => void;
  /** Copy through the main process (works while the window isn't focused). */
  copyText?: (text: string) => Promise<boolean>;
  appRelaunch: () => Promise<void>;
  updaterGetVersion?: () => Promise<string>;
  updaterGetStatus?: () => Promise<UpdaterStatusPayload>;
  updaterCheck?: () => Promise<void>;
  /** Restart into a downloaded update. */
  updaterInstall?: () => Promise<void>;
  onUpdaterStatus?: (
    callback: (status: UpdaterStatusPayload) => void,
  ) => () => void;
  platform: string;
  isElectron: boolean;
  supportsSystemAudio: boolean;
  screen: {
    getAccess: () => Promise<ScreenAccessStatus>;
    openSettings: () => Promise<boolean>;
    triggerPrompt: () => Promise<ScreenAccessStatus>;
    capture: () => Promise<ScreenCaptureResult>;
    onCaptureAndAsk: (callback: () => void) => () => void;
  };
  /** Missing on builds older than the calendar integration. */
  calendar?: CalendarAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
