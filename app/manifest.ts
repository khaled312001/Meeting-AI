import type { MetadataRoute } from "next";
import { APP_DISPLAY_NAME } from "@/lib/constant";

// Static export: prerender to out/manifest.webmanifest.
export const dynamic = "force-static";

/** Lets Chrome/Edge install the web build as a desktop app. The Electron
 *  build ignores it. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_DISPLAY_NAME,
    short_name: APP_DISPLAY_NAME,
    description: "Real-time AI answers for meetings and interviews.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1c1917",
    theme_color: "#1c1917",
    icons: [
      { src: "/icons/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
