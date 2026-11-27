/// <reference types="vite/client" />
import { inject, track } from "@vercel/analytics";

// Vercel Web Analytics: cookieless, same-origin script (/_vercel/insights/script.js).
// Skipped in `vite dev`, where that endpoint doesn't exist.
if (import.meta.env.PROD) {
  inject({ mode: "production" });
}

export function trackDownload(os: "mac" | "win"): void {
  try {
    track("download", { os });
  } catch {
    // Analytics must never block a download.
  }
}
