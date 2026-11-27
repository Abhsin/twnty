// Shared behaviour for every page: analytics, theme toggle, mobile menu,
// footer year, and the download click -> /thanks flow.
import { trackDownload } from "./analytics";

const THEME_KEY = "twnty-web-theme";
const root = document.documentElement;

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
try {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);
} catch {
  // Storage unavailable
}

function currentTheme(): "light" | "dark" {
  const attr = root.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Ignore storage restrictions
  }
});

// ---------------------------------------------------------------------------
// Mobile menu (disclosure pattern)
// ---------------------------------------------------------------------------
const navToggle = document.getElementById("nav-toggle");
const navPanel = document.getElementById("nav-links");
const header = document.querySelector(".site-header");

if (navToggle && navPanel) {
  const setOpen = (open: boolean): void => {
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    navPanel.classList.toggle("is-open", open);
  };
  const isOpen = (): boolean => navToggle.getAttribute("aria-expanded") === "true";

  navToggle.addEventListener("click", () => setOpen(!isOpen()));
  navPanel.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) setOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (isOpen() && header && !header.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      (navToggle as HTMLElement).focus();
    }
  });
  window.matchMedia("(min-width: 681px)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

// ---------------------------------------------------------------------------
// Footer year
// ---------------------------------------------------------------------------
for (const el of Array.from(document.querySelectorAll("[data-year]"))) {
  el.textContent = String(new Date().getFullYear());
}

// ---------------------------------------------------------------------------
// Download links: plain left-click goes to the thank-you page, which starts the
// download. Modified clicks (new tab, etc.) keep the direct file link.
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[data-download]");
  if (!link) return;
  const os = link.dataset.download;
  if (os !== "mac" && os !== "win") return;
  e.preventDefault();
  trackDownload(os);
  window.location.href = `/thanks?os=${os}`;
});
