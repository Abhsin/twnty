import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EyesComponent, EYE_STYLES } from "./eyes/eyes";
import type { AppSettings, SettingsPatch, TimerSnapshot } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const eyesBtn = $("eyes");
const timeEl = $("time");
const captionEl = $("caption");
const pauseBtn = $<HTMLButtonElement>("pause");
const todayEl = $("today");
const demoBtn = $<HTMLButtonElement>("demo");
const stylesEl = $("styles");
const rowTrayTimer = $("row-tray-timer");
const versionEl = $("version");

const eyes = new EyesComponent(eyesBtn, { autoBlink: true, trackCursor: true });
eyesBtn.addEventListener("click", () => eyes.blink());

const tiles = EYE_STYLES.map(({ id, name }) => {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "style-tile";
  tile.dataset.value = id;
  tile.title = name;

  const preview = document.createElement("div");
  preview.className = "style-eyes";
  const label = document.createElement("span");
  label.className = "style-name";
  label.textContent = name;
  tile.append(preview, label);
  stylesEl.append(tile);

  const previewEyes = new EyesComponent(preview, { style: id, trackCursor: true });
  tile.addEventListener("mouseenter", () => previewEyes.blink());
  tile.addEventListener("click", () => {
    if (!currentSettings || currentSettings.eye_style === id) return;
    void applyPatch({ eye_style: id });
  });
  return tile;
});

const SWITCHES: Record<string, keyof SettingsPatch> = {
  "sw-widget": "show_floating_widget",
  "sw-tray-timer": "show_tray_timer",
  "sw-sound": "sound_enabled",
  "sw-strict": "strict_mode",
  "sw-idle": "idle_detection_enabled",
  "sw-fullscreen": "defer_on_fullscreen",
  "sw-login": "launch_at_login",
};

let currentSettings: AppSettings | null = null;
let lastAppliedVersion = -1;
let lastRenderedVersion = -1;
let lastRenderedDemo: boolean | null = null;

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function renderControls(s: AppSettings, isDemo: boolean): void {
  document.querySelectorAll<HTMLDivElement>(".seg").forEach((seg) => {
    const key = seg.dataset.key as keyof AppSettings;
    const current = String(s[key]);
    seg.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.value === current);
    });
  });

  for (const [id, key] of Object.entries(SWITCHES)) {
    $<HTMLInputElement>(id).checked = Boolean(s[key]);
  }

  demoBtn.textContent = isDemo ? "Exit demo" : "Try a 20-second demo";

  for (const t of tiles) t.classList.toggle("is-active", t.dataset.value === s.eye_style);
  eyes.setStyle(s.eye_style);
}

function render(snap: TimerSnapshot): void {
  if (snap.settings_version < lastAppliedVersion) return;
  lastAppliedVersion = snap.settings_version;
  currentSettings = snap.settings;

  rowTrayTimer.classList.toggle("hidden", snap.platform !== "macos");

  if (
    snap.settings_version !== lastRenderedVersion ||
    snap.is_demo !== lastRenderedDemo
  ) {
    lastRenderedVersion = snap.settings_version;
    lastRenderedDemo = snap.is_demo;
    renderControls(snap.settings, snap.is_demo);
  }

  if (snap.phase === "Break") {
    timeEl.textContent = mmss(snap.remaining_secs);
    captionEl.textContent = "resting your eyes";
    eyes.setMood("relaxing");
  } else if (snap.phase === "Paused" || snap.is_idle_paused) {
    timeEl.textContent = mmss(snap.remaining_secs);
    captionEl.textContent = snap.is_idle_paused ? "paused while you're away" : "paused";
    eyes.setProgress(snap.progress);
    eyes.setMood("paused");
  } else {
    timeEl.textContent = mmss(snap.remaining_secs);
    captionEl.textContent = snap.is_demo
      ? "until your next break · demo"
      : "until your next break";
    eyes.setProgress(snap.progress);
    eyes.setMood("working");
  }

  pauseBtn.textContent = snap.phase === "Paused" ? "Resume" : "Pause";

  const { breaks_completed: done, breaks_skipped: skipped } = snap.stats;
  todayEl.textContent =
    done === 0 && skipped === 0
      ? "No breaks yet today."
      : `Today · ${done} break${done === 1 ? "" : "s"} taken` +
        (skipped ? ` · ${skipped} skipped` : "");
}

async function applyPatch(patch: SettingsPatch): Promise<void> {
  if (currentSettings) {
    currentSettings = { ...currentSettings, ...patch };
    renderControls(currentSettings, lastRenderedDemo ?? false);
  }
  const snap = await invoke<TimerSnapshot>("patch_settings", { patch });
  render(snap);
}

document.querySelectorAll<HTMLDivElement>(".seg").forEach((seg) => {
  const key = seg.dataset.key as keyof SettingsPatch;
  seg.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || !currentSettings) return;
    const raw = btn.dataset.value!;
    const val = key === "break_style" ? raw : Number(raw);
    void applyPatch({ [key]: val } as SettingsPatch);
  });
});

for (const [id, key] of Object.entries(SWITCHES)) {
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    if (!currentSettings) return;
    const checked = (e.target as HTMLInputElement).checked;
    void applyPatch({ [key]: checked } as SettingsPatch);
  });
}

$("break-now").addEventListener("click", () => invoke("start_break_now"));
pauseBtn.addEventListener("click", () => invoke("toggle_pause"));
$("reset").addEventListener("click", () => invoke("reset_timer"));

demoBtn.addEventListener("click", async () => {
  const snap = await invoke<TimerSnapshot>("toggle_demo_mode");
  render(snap);
});

async function init(): Promise<void> {
  void getVersion()
    .then((v) => {
      versionEl.textContent = `v${v}`;
    })
    .catch(() => {});

  await listen<TimerSnapshot>("timer-tick", (e) => render(e.payload));
  await listen<TimerSnapshot>("break-completed", () => eyes.celebrate());

  try {
    render(await invoke<TimerSnapshot>("get_timer_snapshot"));
  } catch {
    /* backend not ready */
  }
}

init();
