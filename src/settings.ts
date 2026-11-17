import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EyesComponent, EYE_STYLES } from "./eyes/eyes";
import type { AppSettings, TimerSnapshot } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const eyesBtn = $("eyes");
const timeEl = $("time");
const captionEl = $("caption");
const pauseBtn = $<HTMLButtonElement>("pause");
const todayEl = $("today");
const demoBtn = $<HTMLButtonElement>("demo");
const stylesEl = $("styles");

const eyes = new EyesComponent(eyesBtn, { autoBlink: true, trackCursor: true });
eyesBtn.addEventListener("click", () => eyes.blink());

// Live previews for each eye style
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
    if (!settings || settings.eye_style === id) return;
    settings.eye_style = id;
    save();
  });
  return tile;
});

const DEMO_SECS = 20;
const DEFAULT_WORK = 1200;

const SWITCHES: Record<string, keyof AppSettings> = {
  "sw-widget": "show_floating_widget",
  "sw-tray-timer": "show_tray_timer",
  "sw-sound": "sound_enabled",
  "sw-strict": "strict_mode",
  "sw-idle": "idle_detection_enabled",
  "sw-fullscreen": "defer_on_fullscreen",
  "sw-login": "launch_at_login",
};

let settings: AppSettings | null = null;

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function renderControls(): void {
  if (!settings) return;
  const s = settings;

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

  demoBtn.textContent =
    s.work_duration_secs === DEMO_SECS ? "Exit demo" : "Try a 20-second demo";

  for (const t of tiles) t.classList.toggle("is-active", t.dataset.value === s.eye_style);
  eyes.setStyle(s.eye_style);
}

function render(snap: TimerSnapshot): void {
  settings = { ...snap.settings };
  renderControls();

  const demo = snap.settings.work_duration_secs === DEMO_SECS;

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
    captionEl.textContent = demo ? "until your next break · demo" : "until your next break";
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

async function save(): Promise<void> {
  if (!settings) return;
  renderControls();
  await invoke("update_settings", { newSettings: settings });
}

document.querySelectorAll<HTMLDivElement>(".seg").forEach((seg) => {
  const key = seg.dataset.key as keyof AppSettings;
  seg.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || !settings) return;
    const raw = btn.dataset.value!;
    (settings as unknown as Record<string, unknown>)[key] =
      key === "break_style" ? raw : Number(raw);
    save();
  });
});

for (const [id, key] of Object.entries(SWITCHES)) {
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    if (!settings) return;
    (settings as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).checked;
    save();
  });
}

$("break-now").addEventListener("click", () => invoke("start_break_now"));
pauseBtn.addEventListener("click", () => invoke("toggle_pause"));
$("reset").addEventListener("click", () => invoke("reset_timer"));

demoBtn.addEventListener("click", async () => {
  if (!settings) return;
  settings.work_duration_secs =
    settings.work_duration_secs === DEMO_SECS ? DEFAULT_WORK : DEMO_SECS;
  await save();
  await invoke("reset_timer");
});

async function init(): Promise<void> {
  try {
    render(await invoke<TimerSnapshot>("get_timer_snapshot"));
  } catch {
    /* backend not ready */
  }
  await listen<TimerSnapshot>("timer-tick", (e) => render(e.payload));
  await listen<TimerSnapshot>("break-completed", () => eyes.celebrate());
}

init();
