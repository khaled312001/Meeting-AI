/**
 * Links between the top-level pages (assistant, dashboard, admin).
 *
 * The packaged Electron app loads the static export from file://, where an
 * absolute "/dashboard" would resolve to the filesystem root. There we link
 * to the exported HTML file next to index.html instead.
 */
export type AppPage = "home" | "dashboard" | "admin";

export function appHref(page: AppPage, hash?: string): string {
  const suffix = hash ? `#${hash}` : "";
  const isFile =
    typeof window !== "undefined" && window.location.protocol === "file:";
  if (isFile) {
    return `./${page === "home" ? "index" : page}.html${suffix}`;
  }
  return `${page === "home" ? "/" : `/${page}`}${suffix}`;
}
