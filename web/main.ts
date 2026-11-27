import { EYE_STYLES, EyesComponent, type EyeStyle } from "../src/eyes/eyes";
import { playGentleChime } from "../src/eyes/chime";
import "./common";
import { LATEST_API, MAC_URL, WIN_URL } from "./release";

const APPLE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"/></svg>`;
const WINDOWS_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.45 10.94 4.3v7.1H3V5.45zm0 13.1 7.94 1.15v-7.03H3v5.88zm8.97-14.4L21 2.8v8.6h-9.03V4.15zm0 15.7L21 21.2v-8.53h-9.03v7.18z"/></svg>`;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Live eyes: Hero, Menu-bar preview, Style picker
// ---------------------------------------------------------------------------
let currentStyle: EyeStyle = "classic";
let currentProgress = 0;

const heroEyesBtn = byId<HTMLButtonElement>("hero-eyes");
const trayEyesEl = byId("tray-eyes");
const stylePickerEl = byId("style-picker");

const heroEyes = new EyesComponent(heroEyesBtn, {
  style: currentStyle,
  progress: 0,
  mood: "working",
  autoBlink: true,
  trackCursor: true,
});

const trayEyes = new EyesComponent(trayEyesEl, {
  style: currentStyle,
  progress: 0,
  mood: "working",
  autoBlink: false,
  trackCursor: false,
});

heroEyesBtn.addEventListener("click", () => heroEyes.blink());

const styleTiles = new Map<EyeStyle, { button: HTMLButtonElement; eyes: EyesComponent }>();

for (const s of EYE_STYLES) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "style-tile" + (s.id === currentStyle ? " is-active" : "");
  tile.setAttribute("role", "radio");
  tile.setAttribute("aria-checked", String(s.id === currentStyle));
  tile.tabIndex = s.id === currentStyle ? 0 : -1;

  const box = document.createElement("div");
  box.className = "style-eyes";
  const label = document.createElement("span");
  label.className = "style-name";
  label.textContent = s.name;

  tile.append(box, label);
  stylePickerEl.append(tile);

  const mini = new EyesComponent(box, {
    style: s.id,
    progress: 0,
    mood: "working",
    autoBlink: false,
    trackCursor: false,
  });

  tile.addEventListener("click", () => selectEyeStyle(s.id));
  tile.addEventListener("keydown", (e) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const ids = EYE_STYLES.map((x) => x.id);
    const idx = ids.indexOf(s.id);
    let nextIdx: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % ids.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + ids.length) % ids.length;
    else if (e.key === "Home") nextIdx = 0;
    else nextIdx = ids.length - 1;
    selectEyeStyle(ids[nextIdx]);
    styleTiles.get(ids[nextIdx])?.button.focus();
  });
  styleTiles.set(s.id, { button: tile, eyes: mini });
}

function selectEyeStyle(next: EyeStyle): void {
  currentStyle = next;
  heroEyes.setStyle(next);
  trayEyes.setStyle(next);
  modalEyes?.setStyle(next);

  for (const [id, item] of styleTiles) {
    const active = id === next;
    item.button.classList.toggle("is-active", active);
    item.button.setAttribute("aria-checked", String(active));
    item.button.tabIndex = active ? 0 : -1;
  }
}

// ---------------------------------------------------------------------------
// Strain timeline scrubber + simulated clock
// ---------------------------------------------------------------------------
const strainSlider = byId<HTMLInputElement>("strain-slider");
const strainReadout = byId("strain-readout");
const simClock = byId("sim-clock");
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".preset-btn"));

function describeStrain(pct: number): { label: string; due: boolean } {
  if (pct >= 98) return { label: "20 min · Break due", due: true };
  if (pct >= 75) {
    const mins = Math.round((pct / 100) * 20);
    return { label: `${mins} min · Tired & reddening`, due: false };
  }
  if (pct >= 35) {
    const mins = Math.round((pct / 100) * 20);
    return { label: `${mins} min · Screen fatigue building`, due: false };
  }
  if (pct > 0) {
    const mins = Math.round((pct / 100) * 20);
    return { label: `${mins} min · Focused`, due: false };
  }
  return { label: "0 min · Fresh & clear", due: false };
}

function setStrainPercent(pctRaw: number): void {
  const pct = Math.max(0, Math.min(100, Math.round(pctRaw)));
  currentProgress = pct / 100;
  strainSlider.value = String(pct);

  heroEyes.setProgress(currentProgress);
  trayEyes.setProgress(currentProgress);
  for (const [, item] of styleTiles) {
    item.eyes.setProgress(currentProgress * 0.45);
  }

  const remainingSecs = Math.max(0, Math.round((1 - currentProgress) * 20 * 60));
  const mm = String(Math.floor(remainingSecs / 60)).padStart(2, "0");
  const ss = String(remainingSecs % 60).padStart(2, "0");
  simClock.textContent = `${mm}:${ss}`;

  const desc = describeStrain(pct);
  strainReadout.textContent = desc.label;
  strainSlider.setAttribute("aria-valuetext", desc.label);
  strainReadout.classList.toggle("is-due", desc.due);

  for (const btn of presetButtons) {
    const target = Number(btn.dataset.strain ?? "-1");
    btn.classList.toggle("is-active", target === pct);
    btn.setAttribute("aria-pressed", String(target === pct));
  }
}

strainSlider.addEventListener("input", () => {
  setStrainPercent(Number(strainSlider.value));
});

for (const btn of presetButtons) {
  btn.addEventListener("click", () => {
    setStrainPercent(Number(btn.dataset.strain ?? "0"));
  });
}

setStrainPercent(0);

// ---------------------------------------------------------------------------
// Interactive Break Preview Modal
// ---------------------------------------------------------------------------
const breakModal = byId("break-modal");
const previewBreakBtn = byId<HTMLButtonElement>("preview-break-btn");
const modalEyesEl = byId("modal-eyes");
const modalTitle = byId("modal-title");
const modalHint = byId("modal-hint");
const modalSecs = byId("modal-secs");
const modalBarFill = byId("modal-bar-fill");
const modalPlus = byId<HTMLButtonElement>("modal-plus");
const modalSkip = byId<HTMLButtonElement>("modal-skip");
const modalCloseX = byId<HTMLButtonElement>("modal-close-x");
const modalSoundToggle = byId<HTMLButtonElement>("modal-sound-toggle");
const modalModeCard = byId<HTMLButtonElement>("modal-mode-card");
const modalModeOverlay = byId<HTMLButtonElement>("modal-mode-overlay");

const BREAK_HINTS = [
  "About 20 feet. Let your eyes go soft.",
  "Breathe in...",
  "And let it out.",
  "Unclench your jaw. Drop your shoulders.",
];

let modalEyes: EyesComponent | null = null;
let breakTotalSecs = 20;
let breakRemainingSecs = 20;
let breakInterval: number | null = null;
let hintTimer: number | null = null;
let hintIndex = 0;
let soundEnabled = true;

function setBreakStyle(mode: "card" | "overlay"): void {
  const overlay = mode === "overlay";
  breakModal.classList.toggle("mode-overlay", overlay);
  breakModal.classList.toggle("mode-card", !overlay);
  modalModeCard.classList.toggle("is-active", !overlay);
  modalModeOverlay.classList.toggle("is-active", overlay);
  modalModeCard.setAttribute("aria-pressed", String(!overlay));
  modalModeOverlay.setAttribute("aria-pressed", String(overlay));
}

modalModeCard.addEventListener("click", () => setBreakStyle("card"));
modalModeOverlay.addEventListener("click", () => setBreakStyle("overlay"));

modalSoundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  modalSoundToggle.setAttribute("aria-pressed", String(soundEnabled));
  modalSoundToggle.textContent = soundEnabled ? "Sound on" : "Muted";
});

function updateBreakCountdownUI(): void {
  modalSecs.textContent = String(breakRemainingSecs);
  const ratio = breakTotalSecs > 0 ? breakRemainingSecs / breakTotalSecs : 0;
  modalBarFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
}

function stopBreakTimers(): void {
  if (breakInterval !== null) {
    window.clearInterval(breakInterval);
    breakInterval = null;
  }
  if (hintTimer !== null) {
    window.clearTimeout(hintTimer);
    hintTimer = null;
  }
}

function scheduleNextHint(): void {
  if (breakModal.classList.contains("hidden")) return;
  hintTimer = window.setTimeout(() => {
    hintTimer = null;
    if (breakModal.classList.contains("hidden")) return;
    hintIndex = (hintIndex + 1) % BREAK_HINTS.length;
    modalHint.classList.add("fade");
    window.setTimeout(() => {
      if (breakModal.classList.contains("hidden")) return;
      modalHint.textContent = BREAK_HINTS[hintIndex];
      modalHint.classList.remove("fade");
      scheduleNextHint();
    }, 240);
  }, 4500);
}

const inertTargets = ["site-header", "main", "site-footer", "mobile-cta"].map((id) => byId(id));
let lastFocused: HTMLElement | null = null;

function setBackgroundInert(on: boolean): void {
  for (const el of inertTargets) {
    if (on) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }
}

function closeModalUI(): void {
  breakModal.classList.add("hidden");
  document.body.style.overflow = "";
  setBackgroundInert(false);
  updateStickyBar();
  lastFocused?.focus();
  lastFocused = null;
}

function finishBreakPreview(celebrate: boolean): void {
  stopBreakTimers();
  if (celebrate) {
    if (soundEnabled) playGentleChime("complete");
    modalTitle.textContent = "Nice";
    modalHint.textContent = "Back to work when you are ready.";
    modalEyes?.setMood("happy");

    window.setTimeout(() => {
      closeModalUI();
      setStrainPercent(0);
      heroEyes.celebrate(1600);
      trayEyes.celebrate(1600);
    }, 850);
  } else {
    closeModalUI();
  }
}

function openBreakPreview(): void {
  stopBreakTimers();
  if (!modalEyes) {
    modalEyes = new EyesComponent(modalEyesEl, {
      style: currentStyle,
      mood: "relaxing",
      autoBlink: false,
      breathing: true,
    });
  } else {
    modalEyes.setStyle(currentStyle);
    modalEyes.setMood("relaxing");
  }

  breakTotalSecs = 20;
  breakRemainingSecs = 20;
  hintIndex = 0;
  modalTitle.textContent = "Look at something far away";
  modalHint.classList.remove("fade");
  modalHint.textContent = BREAK_HINTS[0];
  updateBreakCountdownUI();

  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  breakModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setBackgroundInert(true);
  updateStickyBar();
  modalSkip.focus();

  if (soundEnabled) playGentleChime("start");

  breakInterval = window.setInterval(() => {
    breakRemainingSecs = Math.max(0, breakRemainingSecs - 1);
    updateBreakCountdownUI();
    if (breakRemainingSecs <= 0) {
      finishBreakPreview(true);
    }
  }, 1000);

  scheduleNextHint();
}

previewBreakBtn.addEventListener("click", openBreakPreview);
modalPlus.addEventListener("click", () => {
  breakRemainingSecs += 10;
  breakTotalSecs = Math.max(breakTotalSecs + 10, breakRemainingSecs);
  updateBreakCountdownUI();
});
modalSkip.addEventListener("click", () => finishBreakPreview(true));
modalCloseX.addEventListener("click", () => finishBreakPreview(false));

breakModal.addEventListener("click", (e) => {
  if (e.target === breakModal && breakModal.classList.contains("mode-card")) {
    finishBreakPreview(false);
  }
});

window.addEventListener("keydown", (e) => {
  if (breakModal.classList.contains("hidden")) return;
  if (e.key === "Escape") {
    finishBreakPreview(false);
    return;
  }
  if (e.key === "Tab") {
    // Keep keyboard focus inside the dialog.
    const focusables = Array.from(breakModal.querySelectorAll<HTMLElement>("button")).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !breakModal.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !breakModal.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
});

// ---------------------------------------------------------------------------
// OS detection & download links
// ---------------------------------------------------------------------------
type Platform = "mac" | "win" | "linux" | "mobile" | "other";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };
  const uaPlatform = (nav.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  const touchMac = uaPlatform.includes("mac") && navigator.maxTouchPoints > 1; // iPadOS
  if (nav.userAgentData?.mobile || /android|iphone|ipad|ipod|mobile/.test(ua) || touchMac) {
    return "mobile";
  }
  if (ua.includes("windows") || uaPlatform.includes("win")) return "win";
  if (ua.includes("mac") || uaPlatform.includes("mac")) return "mac";
  if (ua.includes("linux") || ua.includes("x11") || uaPlatform.includes("linux")) return "linux";
  return "other";
}

const platform = detectPlatform();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const downloadLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-download]"));
const heroCtas = byId("hero-ctas");
const platformNote = byId("platform-note");

for (const holder of Array.from(document.querySelectorAll<HTMLElement>("[data-os-icon]"))) {
  holder.innerHTML = holder.dataset.osIcon === "win" ? WINDOWS_ICON : APPLE_ICON;
}

function setDownloadHref(kind: "mac" | "win", url: string): void {
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-download]"))) {
    if (a.dataset.download === kind) a.href = url;
  }
}

// Direct-download fallbacks (the version lives in release.ts).
setDownloadHref("mac", MAC_URL);
setDownloadHref("win", WIN_URL);

// Style the detected OS as the primary action. Buttons keep identical sizes, so
// nothing shifts when this runs.
if (platform === "win") {
  for (const a of downloadLinks) {
    const isWin = a.dataset.download === "win";
    if (!a.classList.contains("btn-ghost")) {
      a.classList.toggle("btn-primary", isWin);
      a.classList.toggle("btn-secondary", !isWin);
    }
    a.style.order = isWin ? "-1" : "0";
  }
} else if (platform !== "mac") {
  // Mobile, Linux or unknown: do not pretend there is a right download.
  for (const a of downloadLinks) {
    a.classList.remove("btn-primary");
    a.classList.add("btn-secondary");
  }
  platformNote.hidden = false;
  platformNote.textContent =
    platform === "linux"
      ? "Linux isn't supported yet. twnty runs on macOS and Windows."
      : platform === "mobile"
        ? "twnty is a desktop app. Open twnty.app on your Mac or PC to install it."
        : "twnty runs on macOS and Windows. Pick your system below.";
}

// Hover or focus on a download button: the hero eyes glance at it (and blink on hover).
function glanceAt(el: HTMLElement): void {
  const e = heroEyesBtn.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const dx = r.left + r.width / 2 - (e.left + e.width / 2);
  const dy = r.top + r.height / 2 - (e.top + e.height / 2);
  const len = Math.hypot(dx, dy) || 1;
  heroEyes.look(dx / len, dy / len);
}
if (!reduceMotion) {
  for (const a of Array.from(heroCtas.querySelectorAll<HTMLAnchorElement>("a[data-download]"))) {
    a.addEventListener("pointerenter", () => {
      glanceAt(a);
      heroEyes.blink();
    });
    a.addEventListener("focus", () => glanceAt(a));
  }
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubAsset[];
}

async function hydrateReleaseLinks(): Promise<void> {
  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const data = (await res.json()) as GitHubRelease;
    const assets = data.assets ?? [];

    const macAsset =
      assets.find((a) => a.name.endsWith("universal.dmg")) ??
      assets.find((a) => a.name.endsWith(".dmg"));
    const winAsset =
      assets.find((a) => a.name.endsWith("-setup.exe")) ??
      assets.find((a) => a.name.endsWith(".exe")) ??
      assets.find((a) => a.name.endsWith(".msi"));

    // Only upgrade to exact asset URLs; otherwise keep the direct fallbacks.
    if (macAsset?.browser_download_url.startsWith("https://")) {
      setDownloadHref("mac", macAsset.browser_download_url);
    }
    if (winAsset?.browser_download_url.startsWith("https://")) {
      setDownloadHref("win", winAsset.browser_download_url);
    }

    if (data.tag_name && /^[\w.-]{1,24}$/.test(data.tag_name)) {
      byId("release-version").textContent = data.tag_name;
    }
    if (data.html_url?.startsWith("https://github.com/")) {
      byId<HTMLAnchorElement>("release-notes").href = data.html_url;
    }
  } catch {
    // Keep the direct-download fallbacks
  }
}

void hydrateReleaseLinks();

// ---------------------------------------------------------------------------
// Sticky bottom CTA (narrow viewports only)
// ---------------------------------------------------------------------------
const stickyBar = byId("mobile-cta");
const stickyText = byId("mobile-cta-text");
const stickyDownload = byId<HTMLAnchorElement>("mobile-cta-download");
const stickyShare = byId<HTMLButtonElement>("mobile-cta-share");
const bottomCtas = document.querySelector<HTMLElement>(".bottom-cta .hero-ctas");
const narrowMq = window.matchMedia("(max-width: 720px)");

const STICKY_DEFAULT_TEXT = "twnty is for Mac & Windows";
let heroCtasPast = false;
let bottomCtasVisible = false;
let stickyMsgTimer: number | undefined;

if (platform === "mac" || platform === "win") {
  // Narrow desktop window: offer the real download.
  stickyDownload.dataset.download = platform;
  stickyDownload.href = platform === "mac" ? MAC_URL : WIN_URL;
  stickyDownload.textContent = platform === "mac" ? "Download for macOS" : "Download for Windows";
  stickyDownload.hidden = false;
  stickyText.textContent = "Free, open source";
} else {
  // Phones, tablets, Linux: send the link to a Mac or PC instead.
  stickyText.textContent = STICKY_DEFAULT_TEXT;
  stickyShare.hidden = false;
}

function updateStickyBar(): void {
  const modalOpen = !breakModal.classList.contains("hidden");
  const show = narrowMq.matches && heroCtasPast && !bottomCtasVisible && !modalOpen;
  stickyBar.classList.toggle("is-visible", show);
  document.body.classList.toggle("has-mobile-cta", narrowMq.matches && heroCtasPast);
}

if ("IntersectionObserver" in window) {
  new IntersectionObserver(
    ([entry]) => {
      heroCtasPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      updateStickyBar();
    },
    { threshold: 0 },
  ).observe(heroCtas);
  if (bottomCtas) {
    new IntersectionObserver(
      ([entry]) => {
        bottomCtasVisible = entry.isIntersecting;
        updateStickyBar();
      },
      { threshold: 0 },
    ).observe(bottomCtas);
  }
}
narrowMq.addEventListener("change", updateStickyBar);

function showStickyMessage(msg: string): void {
  stickyText.textContent = msg;
  window.clearTimeout(stickyMsgTimer);
  stickyMsgTimer = window.setTimeout(() => {
    stickyText.textContent = STICKY_DEFAULT_TEXT;
  }, 5000);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back to the legacy path (insecure contexts, older browsers).
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

stickyShare.addEventListener("click", async () => {
  const data = {
    title: "twnty",
    text: "twnty: a free 20-20-20 eye break app for Mac & Windows",
    url: "https://twnty.app",
  };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
      // Any other failure: fall through to copying the link.
    }
  }
  const ok = await copyToClipboard(data.url);
  showStickyMessage(
    ok ? "Link copied — open it on your computer" : "Couldn't copy — visit twnty.app on your computer",
  );
});
