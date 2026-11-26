import { EYE_STYLES, EyesComponent, type EyeStyle } from "../src/eyes/eyes";
import { playGentleChime } from "../src/eyes/chime";

const RELEASES_FALLBACK = "https://github.com/Abhsin/twnty/releases/latest";
const LATEST_API = "https://api.github.com/repos/Abhsin/twnty/releases/latest";

const APPLE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"/></svg>`;
const WINDOWS_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.45 10.94 4.3v7.1H3V5.45zm0 13.1 7.94 1.15v-7.03H3v5.88zm8.97-14.4L21 2.8v8.6h-9.03V4.15zm0 15.7L21 21.2v-8.53h-9.03v7.18z"/></svg>`;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------
const THEME_KEY = "twnty-web-theme";
const rootEl = document.documentElement;
const themeToggle = byId<HTMLButtonElement>("theme-toggle");

function getEffectiveTheme(): "light" | "dark" {
  const attr = rootEl.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    rootEl.setAttribute("data-theme", savedTheme);
  }
} catch {
  // Ignore storage restrictions
}

themeToggle.addEventListener("click", () => {
  const next = getEffectiveTheme() === "dark" ? "light" : "dark";
  rootEl.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Ignore storage restrictions
  }
});

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
  strainReadout.classList.toggle("is-due", desc.due);

  for (const btn of presetButtons) {
    const target = Number(btn.dataset.strain ?? "-1");
    btn.classList.toggle("is-active", target === pct);
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

function finishBreakPreview(celebrate: boolean): void {
  stopBreakTimers();
  if (celebrate) {
    if (soundEnabled) playGentleChime("complete");
    modalTitle.textContent = "Nice";
    modalHint.textContent = "Back to work when you are ready.";
    modalEyes?.setMood("happy");

    window.setTimeout(() => {
      breakModal.classList.add("hidden");
      document.body.style.overflow = "";
      setStrainPercent(0);
      heroEyes.celebrate(1600);
      trayEyes.celebrate(1600);
    }, 850);
  } else {
    breakModal.classList.add("hidden");
    document.body.style.overflow = "";
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

  breakModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

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
  if (e.key === "Escape" && !breakModal.classList.contains("hidden")) {
    finishBreakPreview(false);
  }
});

// ---------------------------------------------------------------------------
// OS detection & GitHub latest release download links
// ---------------------------------------------------------------------------
const dlPrimary = byId<HTMLAnchorElement>("dl-primary");
const dlPrimaryIcon = byId("dl-primary-icon");
const dlPrimaryLabel = byId("dl-primary-label");
const dlSecondary = byId<HTMLAnchorElement>("dl-secondary");
const dlSecondaryIcon = byId("dl-secondary-icon");
const dlSecondaryLabel = byId("dl-secondary-label");
const dlBottomMac = byId<HTMLAnchorElement>("dl-bottom-mac");
const dlBottomWin = byId<HTMLAnchorElement>("dl-bottom-win");
const releaseMeta = byId("release-meta");

function detectIsWindows(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("windows");
}

const isWin = detectIsWindows();
if (isWin) {
  dlPrimaryIcon.innerHTML = WINDOWS_ICON;
  dlPrimaryLabel.textContent = "Download for Windows";
  dlSecondaryIcon.innerHTML = APPLE_ICON;
  dlSecondaryLabel.textContent = "Download for macOS";
} else {
  dlPrimaryIcon.innerHTML = APPLE_ICON;
  dlPrimaryLabel.textContent = "Download for macOS";
  dlSecondaryIcon.innerHTML = WINDOWS_ICON;
  dlSecondaryLabel.textContent = "Download for Windows";
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

    const macUrl = macAsset?.browser_download_url ?? data.html_url ?? RELEASES_FALLBACK;
    const winUrl = winAsset?.browser_download_url ?? data.html_url ?? RELEASES_FALLBACK;

    dlBottomMac.href = macUrl;
    dlBottomWin.href = winUrl;

    if (isWin) {
      dlPrimary.href = winUrl;
      dlSecondary.href = macUrl;
    } else {
      dlPrimary.href = macUrl;
      dlSecondary.href = winUrl;
    }

    if (data.tag_name) {
      const notesUrl =
        data.html_url && data.html_url.startsWith("https://") ? data.html_url : RELEASES_FALLBACK;
      const notesLink = document.createElement("a");
      notesLink.className = "link";
      notesLink.href = notesUrl;
      notesLink.target = "_blank";
      notesLink.rel = "noopener noreferrer";
      notesLink.textContent = "Release notes";

      releaseMeta.replaceChildren(
        document.createTextNode(
          `${data.tag_name} · macOS Universal & Windows · Free & MIT open source · `,
        ),
        notesLink,
      );
    }
  } catch {
    // Keep clean fallback URLs pointing to GitHub Releases
  }
}

void hydrateReleaseLinks();
