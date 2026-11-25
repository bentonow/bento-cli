export const DASHBOARD_BASE_URL = process.env.BENTO_DASHBOARD_URL ?? "https://app.bentonow.com/";

/**
 * Turn a dashboard path returned by the API (such as a subscriber's `navigation_url`) into an
 * absolute URL. Returns null for anything that is not a same-origin path, so a missing or
 * unexpected value never produces a link that points somewhere else.
 */
export function resolveDashboardUrl(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return null;
  }

  const base = new URL(DASHBOARD_BASE_URL);
  const url = new URL(path, base);
  return url.origin === base.origin ? url.toString() : null;
}
