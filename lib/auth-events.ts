/**
 * Session-expiry signaling between the network layer and the auth UI.
 *
 * Any 401 from a non-auth API call means the cookie session died
 * mid-use. Instead of leaving the user stuck with an error message,
 * the network layer dispatches this event and the AuthGuard flips back
 * to the sign-in wizard. Debounced so parallel failing requests don't
 * spam the event.
 */

const SESSION_EXPIRED_EVENT = "auth:session-expired";
const DEBOUNCE_MS = 5000;

let lastNotified = 0;

export function notifySessionExpired(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastNotified < DEBOUNCE_MS) return;
  lastNotified = now;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}
