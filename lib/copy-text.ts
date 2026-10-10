/** Copy text to the clipboard.
 *
 *  In the desktop app this goes through the main process: the browser
 *  clipboard API refuses to write while the window isn't focused, and the
 *  focus-mode overlay often isn't (clicks pass through it on purpose). */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (api?.copyText) {
    try {
      if (await api.copyText(text)) return true;
    } catch {
      /* fall back to the browser clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall back to a hidden textarea */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
