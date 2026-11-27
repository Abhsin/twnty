import { EYE_STYLES, EyesComponent, type EyeStyle } from "../src/eyes/eyes";
import { playGentleChime } from "../src/eyes/chime";
import "./common";
import { LATEST_API, MAC_URL, WIN_URL } from "./release";

const APPLE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"/></svg>`;
const WINDOWS_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.45 10.94 4.3v7.1H3V5.45zm0 13.1 7.94 1.15v-7.03H3v5.88zm8.97-14.4L21 2.8v8.6h-9.03V4.15zm0 15.7L21 21.2v-8.53h-9.03v7.18z"/></svg>`;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Platform + motion preference (used by the mockup and the download buttons)
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

// ---------------------------------------------------------------------------
// Live eyes: hero, tray, floating desktop eyes, style picker
// ---------------------------------------------------------------------------
let currentStyle: EyeStyle = "classic";
let currentProgress = 0;

const heroEyesBtn = byId<HTMLButtonElement>("hero-eyes");
const stylePickerEl = byId("style-picker");

const heroEyes = new EyesComponent(heroEyesBtn, {
  style: currentStyle,
  progress: 0,
  mood: "working",
  autoBlink: true,
  trackCursor: true,
});

const trayEyes = new EyesComponent(byId("tray-eyes"), {
  style: currentStyle,
  progress: 0,
  mood: "working",
  autoBlink: false,
  trackCursor: false,
});

const floatEyes = new EyesComponent(byId("float-eyes"), {
  style: currentStyle,
  progress: 0,
  mood: "working",
  autoBlink: true,
  trackCursor: true,
});

heroEyesBtn.addEventListener("click", () => heroEyes.blink());

const styleTiles = new Map<EyeStyle, { button: HTMLButtonElement; eyes: EyesComponent }>();
let breakEyes: EyesComponent | null = null;

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

  tile.addEventListener("click", () => {
    markUserInteracted();
    selectEyeStyle(s.id);
  });
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
  floatEyes.setStyle(next);
  breakEyes?.setStyle(next);

  for (const [id, item] of styleTiles) {
    const active = id === next;
    item.button.classList.toggle("is-active", active);
    item.button.setAttribute("aria-checked", String(active));
    item.button.tabIndex = active ? 0 : -1;
  }
}

// ---------------------------------------------------------------------------
// Desktop mockup: macOS menu bar or Windows taskbar
// ---------------------------------------------------------------------------
const desk = byId("desk");
const tray = byId("tray");
const traySlots = { mac: byId("slot-mac"), win: byId("slot-win") };
const osButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-os]"));

function setDeskOS(os: "mac" | "win"): void {
  desk.dataset.os = os;
  traySlots[os].append(tray);
  for (const btn of osButtons) {
    const on = btn.dataset.os === os;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

let userInteracted = false;
let autoPreviewRan = false;

function markUserInteracted(): void {
  userInteracted = true;
}

for (const btn of osButtons) {
  btn.addEventListener("click", () => {
    markUserInteracted();
    setDeskOS(btn.dataset.os === "win" ? "win" : "mac");
  });
}
setDeskOS(platform === "win" ? "win" : "mac");

// ---------------------------------------------------------------------------
// Strain scrubber + simulated clock
// ---------------------------------------------------------------------------
const strainSlider = byId<HTMLInputElement>("strain-slider");
const strainReadout = byId("strain-readout");
const simClock = byId("sim-clock");
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".preset-btn"));
let shownPct = -1;

function describeStrain(pct: number): { label: string; due: boolean } {
  if (pct >= 98) return { label: "20 min · Time for a break", due: true };
  const mins = Math.round((pct / 100) * 20);
  if (pct >= 75) return { label: `${mins} min · Tired & red`, due: false };
  if (pct >= 35) return { label: `${mins} min · Fatigue building`, due: false };
  if (pct > 0) return { label: `${mins} min · Focused`, due: false };
  return { label: "0 min · Fresh & clear", due: false };
}

/** Drive every eye, the countdown and the controls from one 0..1 progress value. */
function applyProgress(raw: number): void {
  const p = Math.max(0, Math.min(1, raw));
  currentProgress = p;
  const pct = Math.round(p * 100);

  heroEyes.setProgress(p);
  trayEyes.setProgress(p);
  floatEyes.setProgress(p);
  for (const [, item] of styleTiles) item.eyes.setProgress(p * 0.45);

  const remainingSecs = Math.max(0, Math.round((1 - p) * 20 * 60));
  const mm = String(Math.floor(remainingSecs / 60)).padStart(2, "0");
  const ss = String(remainingSecs % 60).padStart(2, "0");
  simClock.textContent = `${mm}:${ss}`;

  if (pct === shownPct) return;
  shownPct = pct;
  strainSlider.value = String(pct);
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
  markUserInteracted();
  cancelActivity();
  applyProgress(Number(strainSlider.value) / 100);
});

for (const btn of presetButtons) {
  btn.addEventListener("click", () => {
    markUserInteracted();
    cancelActivity();
    applyProgress(Number(btn.dataset.strain ?? "0") / 100);
  });
}

applyProgress(0);

// ---------------------------------------------------------------------------
// In-screen break + "play 20 minutes" sequence (one clock, paused offscreen)
// ---------------------------------------------------------------------------
const breakLayer = byId("break-layer");
const breakTitle = byId("break-title");
const breakHint = byId("break-hint");
const breakSecs = byId("break-secs");
const breakBarFill = byId("break-bar-fill");
const breakStatus = byId("break-status");
const breakPlus = byId<HTMLButtonElement>("break-plus");
const breakSkip = byId<HTMLButtonElement>("break-skip");
const playBtn = byId<HTMLButtonElement>("play-btn");
const previewBtn = byId<HTMLButtonElement>("preview-break-btn");
const modeCard = byId<HTMLButtonElement>("mode-card");
const modeOverlay = byId<HTMLButtonElement>("mode-overlay");
const soundToggle = byId<HTMLButtonElement>("sound-toggle");

const PLAY_MS = 10_000;
const HINT_MS = 4500;
const PLAY_LABEL = "Play 20 min in 10s";
const BREAK_HINTS = [
  "About 20 feet. Let your eyes go soft.",
  "Breathe in...",
  "And let it out.",
  "Unclench your jaw. Drop your shoulders.",
];

const AUTO_MS = 3600;
const AUTO_TARGET = 0.85;

type Phase = "idle" | "auto" | "playing" | "break" | "done";
let phase: Phase = "idle";
let playElapsed = 0;
let breakTotal = 20_000;
let breakElapsed = 0;
let shownSecs = -1;
let hintIndex = 0;
let soundEnabled = true;
let onScreen = true;
let rafId = 0;
let lastT = 0;
let lastApply = 0;
let finishTimer: number | undefined;
let lastFocused: HTMLElement | null = null;

function setBreakStyle(mode: "card" | "overlay"): void {
  const overlay = mode === "overlay";
  breakLayer.classList.toggle("mode-overlay", overlay);
  breakLayer.classList.toggle("mode-card", !overlay);
  modeCard.classList.toggle("is-active", !overlay);
  modeOverlay.classList.toggle("is-active", overlay);
  modeCard.setAttribute("aria-pressed", String(!overlay));
  modeOverlay.setAttribute("aria-pressed", String(overlay));
}
modeCard.addEventListener("click", () => setBreakStyle("card"));
modeOverlay.addEventListener("click", () => setBreakStyle("overlay"));

soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggle.textContent = soundEnabled ? "Sound on" : "Muted";
});

function renderBreak(): void {
  const secs = Math.max(0, Math.ceil((breakTotal - breakElapsed) / 1000));
  if (secs !== shownSecs) {
    shownSecs = secs;
    breakSecs.textContent = String(secs);
  }
  const ratio = breakTotal > 0 ? Math.max(0, 1 - breakElapsed / breakTotal) : 0;
  breakBarFill.style.transform = `scaleX(${ratio})`;

  const idx = Math.floor(breakElapsed / HINT_MS) % BREAK_HINTS.length;
  if (idx !== hintIndex) {
    hintIndex = idx;
    breakHint.classList.add("fade");
    window.setTimeout(() => {
      if (phase !== "break") return;
      breakHint.textContent = BREAK_HINTS[idx];
      breakHint.classList.remove("fade");
    }, 240);
  }
}

function tick(t: number): void {
  rafId = 0;
  if (phase === "idle" || phase === "done" || !onScreen) return;
  const dt = Math.max(0, t - lastT);
  lastT = t;

  if (phase === "auto") {
    if (userInteracted || document.hidden) {
      phase = "idle";
      return;
    }
    playElapsed += dt;
    const k = Math.min(1, playElapsed / AUTO_MS);
    if (k >= 1) {
      applyProgress(AUTO_TARGET);
      phase = "idle";
      return;
    }
    if (t - lastApply > 45) {
      lastApply = t;
      const eased = 1 - Math.pow(1 - k, 2);
      applyProgress(eased * AUTO_TARGET);
    }
  } else if (phase === "playing") {
    playElapsed += dt;
    const p = Math.min(1, playElapsed / PLAY_MS);
    if (p >= 1) {
      applyProgress(1);
      startBreak(false);
    } else if (t - lastApply > 45) {
      lastApply = t;
      applyProgress(p);
    }
  } else {
    breakElapsed += dt;
    if (breakElapsed >= breakTotal) {
      breakElapsed = breakTotal;
      renderBreak();
      finishBreak(true);
    } else {
      renderBreak();
    }
  }
  kick();
}

function kick(): void {
  if (
    rafId ||
    !onScreen ||
    document.hidden ||
    (phase !== "auto" && phase !== "playing" && phase !== "break")
  ) {
    return;
  }
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);
}

function setPlaying(on: boolean): void {
  playBtn.textContent = on ? "Playing..." : PLAY_LABEL;
  playBtn.setAttribute("aria-disabled", String(on));
  strainReadout.setAttribute("aria-live", on ? "off" : "polite");
}

function startBreak(fromPreview: boolean): void {
  window.clearTimeout(finishTimer);
  setPlaying(false);
  phase = "break";
  breakTotal = 20_000;
  breakElapsed = 0;
  shownSecs = -1;
  hintIndex = 0;

  if (!breakEyes) {
    breakEyes = new EyesComponent(byId("break-eyes"), {
      style: currentStyle,
      mood: "relaxing",
      autoBlink: false,
      breathing: true,
    });
  } else {
    breakEyes.setStyle(currentStyle);
    breakEyes.setMood("relaxing");
  }

  breakTitle.textContent = "Look at something far away";
  breakHint.classList.remove("fade");
  breakHint.textContent = BREAK_HINTS[0];
  renderBreak();
  breakLayer.hidden = false;
  desk.classList.add("is-break");
  breakStatus.textContent = "Break started. Look at something about 20 feet away for 20 seconds.";

  const active = document.activeElement;
  lastFocused = active instanceof HTMLElement && !breakLayer.contains(active) ? active : playBtn;
  if (fromPreview) breakSkip.focus();

  if (soundEnabled) playGentleChime("start");
  kick();
}

function closeBreak(): void {
  window.clearTimeout(finishTimer);
  const hadFocus = breakLayer.contains(document.activeElement);
  breakLayer.hidden = true;
  desk.classList.remove("is-break");
  phase = "idle";
  if (hadFocus) lastFocused?.focus();
  lastFocused = null;
}

function finishBreak(celebrate: boolean): void {
  if (phase !== "break") return;
  if (!celebrate) {
    closeBreak();
    return;
  }
  phase = "done";
  if (soundEnabled) playGentleChime("complete");
  breakTitle.textContent = "Nice";
  breakHint.classList.remove("fade");
  breakHint.textContent = "Back to work when you're ready.";
  breakEyes?.setMood("happy");
  breakStatus.textContent = "Break complete.";
  finishTimer = window.setTimeout(() => {
    closeBreak();
    applyProgress(0);
    heroEyes.celebrate(1600);
    trayEyes.celebrate(1600);
    floatEyes.celebrate(1600);
  }, 850);
}

/** Stop the 20-minutes sequence, auto-preview, or an open break without celebrating. */
function cancelActivity(): void {
  if (phase === "auto") {
    phase = "idle";
  } else if (phase === "playing") {
    phase = "idle";
    setPlaying(false);
  } else if (phase === "break" || phase === "done") {
    closeBreak();
  }
}

playBtn.addEventListener("click", () => {
  markUserInteracted();
  if (phase === "break" || phase === "done") return;
  if (reduceMotion) {
    applyProgress(1);
    startBreak(false);
    return;
  }
  applyProgress(0);
  playElapsed = 0;
  lastApply = 0;
  phase = "playing";
  setPlaying(true);
  kick();
});

previewBtn.addEventListener("click", () => {
  markUserInteracted();
  if (phase === "break" || phase === "done") return;
  if (phase === "playing") setPlaying(false);
  startBreak(true);
});

breakPlus.addEventListener("click", () => {
  if (phase !== "break") return;
  breakTotal += 10_000;
  renderBreak();
});
breakSkip.addEventListener("click", () => finishBreak(true));

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && phase === "break") finishBreak(false);
});

// Pause the sequence, countdown and CSS animation while the mockup is offscreen;
// trigger a gentle one-shot auto-preview the first time the desk enters view.
if ("IntersectionObserver" in window) {
  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      desk.classList.toggle("is-offscreen", !onScreen);
      if (!onScreen && phase === "auto") {
        phase = "idle";
      }
      if (
        entry.intersectionRatio >= 0.35 &&
        !reduceMotion &&
        !userInteracted &&
        !autoPreviewRan &&
        phase === "idle"
      ) {
        autoPreviewRan = true;
        playElapsed = 0;
        lastApply = 0;
        phase = "auto";
      }
      kick();
    },
    { threshold: [0, 0.35] },
  ).observe(desk);
}
document.addEventListener("visibilitychange", kick);

// ---------------------------------------------------------------------------
// Download links
// ---------------------------------------------------------------------------
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
  stickyText.textContent = "Free & open source";
} else {
  // Phones, tablets, Linux: send the link to a Mac or PC instead.
  stickyText.textContent = STICKY_DEFAULT_TEXT;
  stickyShare.hidden = false;
}

function updateStickyBar(): void {
  const show = narrowMq.matches && heroCtasPast && !bottomCtasVisible;
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
    ok ? "Link copied. Open it on your computer." : "Couldn't copy. Visit twnty.app on your computer.",
  );
});
