export { BACKEND_API_URL } from "./backend-url.mjs";
export const APP_DISPLAY_NAME = "Meeting AI";
/** Matches worker MAX_IMAGES_PER_REQUEST — keep in sync. */
export const MAX_IMAGES = 4;
/** Target of the dashboard's "Download desktop app" button — an installer or a
 *  releases page. Set NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL at build time. */
export const DESKTOP_DOWNLOAD_URL = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL?.trim() || "";
