/**
 * Coalesces rapid updates (SSE tokens) into bounded-frequency React state
 * writes. Tokens accumulate in caller-owned buffers; this helper just
 * decides *when* to apply them.
 *
 * - `schedule()` applies immediately if enough time has passed since the
 *   last apply, otherwise pins a single trailing timeout.
 * - `flush()` applies now (used on stream end / abort so nothing is lost).
 * - `dispose()` cancels any pending trailing apply without applying.
 */
export interface StreamFlusher {
  schedule: () => void;
  flush: () => void;
  dispose: () => void;
}

export function createStreamFlusher(
  apply: () => void,
  intervalMs = 30,
): StreamFlusher {
  let lastApplied = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const applyNow = () => {
    lastApplied = Date.now();
    apply();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastApplied;
      if (elapsed >= intervalMs) {
        applyNow();
        return;
      }
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          applyNow();
        }, intervalMs - elapsed);
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      applyNow();
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
