/** The Interprova mark: the rehearsal (outline) and the real interview (solid).
 *  Inline SVG so it works in the file:// Electron build as well as the web. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="8 8 562 472" className={className} aria-hidden focusable="false">
      <path
        d="M69.5 21.5H334.5A48 48 0 0 1 382.5 69.5V223.5A48 48 0 0 1 334.5 271.5H172L92 340V271.5H69.5A48 48 0 0 1 21.5 223.5V69.5A48 48 0 0 1 69.5 21.5Z"
        fill="none"
        stroke="#FEAF00"
        strokeWidth="23"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M250 133H502A65 65 0 0 1 567 198V341A65 65 0 0 1 502 406H492V466A10 10 0 0 1 475 473L404 406H250A65 65 0 0 1 185 341V198A65 65 0 0 1 250 133Z"
        fill="#125DF6"
      />
    </svg>
  );
}
