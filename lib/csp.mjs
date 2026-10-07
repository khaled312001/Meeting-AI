/** Canonical Content-Security-Policy strings (imported by TS/JS consumers). */

import { BACKEND_API_ORIGIN } from "./backend-url.mjs";

const ANALYTICS_CONNECT =
  "https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.doubleclick.net";

const ANALYTICS_IMG =
  "https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://www.google.co.in https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.doubleclick.net";

const DEEPGRAM = "https://*.deepgram.com https://api.deepgram.com wss://*.deepgram.com";

function build({ dev }) {
  const scriptExtra = dev ? " 'unsafe-eval'" : "";
  const connectExtra = dev
    ? " http://localhost:8787 ws://localhost:* ws://127.0.0.1:*"
    : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self'${scriptExtra} 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com`,
    `connect-src 'self' ${BACKEND_API_ORIGIN} ${DEEPGRAM} ${ANALYTICS_CONNECT}${connectExtra}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${ANALYTICS_IMG}`,
    "font-src 'self' data:",
    "media-src 'self' blob:",
  ].join("; ") + ";";
}

export const DEV_CSP = build({ dev: true });

export const PROD_CSP = build({ dev: false });
