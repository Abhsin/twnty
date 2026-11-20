import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EyesComponent } from "./eyes/eyes";
import type { TimerSnapshot } from "./types";

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;

const handle = $<HTMLDivElement>("handle");
const timeEl = $<HTMLSpanElement>("time");
const pauseBtn = $<HTMLButtonElement>("pause");
const iconPause = $<SVGElement>("icon-pause");
const iconPlay = $<SVGElement>("icon-play");

const eyes = new EyesComponent($<HTMLDivElement>("eyes"), { autoBlink: true });

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function setPaused(paused: boolean): void {
  iconPause.classList.toggle("hidden", paused);
  iconPlay.classList.toggle("hidden", !paused);
  pauseBtn.title = paused ? "Resume" : "Pause";
}

function render(s: TimerSnapshot): void {
  eyes.setStyle(s.settings.eye_style);
  if (s.phase === "Break") {
    eyes.setProgress(0);
    eyes.setMood("relaxing");
    timeEl.textContent = `${s.remaining_secs}s`;
    setPaused(false);
  } else if (s.phase === "Paused" || s.is_idle_paused) {
    eyes.setProgress(s.progress);
    eyes.setMood("paused");
    timeEl.textContent = mmss(s.remaining_secs);
    setPaused(s.phase === "Paused");
  } else {
    eyes.setProgress(s.progress);
    eyes.setMood("working");
    timeEl.textContent = mmss(s.remaining_secs);
    setPaused(false);
  }
}

// Drag only after pointer moves >= 4px so double-click can fire reliably
let dragStart: { x: number; y: number } | null = null;

handle.addEventListener("mousedown", (e) => {
  if (e.button === 0) {
    dragStart = { x: e.clientX, y: e.clientY };
  }
});

window.addEventListener("mousemove", (e) => {
  if (!dragStart) return;
  if ((e.buttons & 1) === 0) {
    dragStart = null;
    return;
  }
  if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) >= 4) {
    dragStart = null;
    getCurrentWindow().startDragging().catch(() => {});
  }
});

window.addEventListener("mouseup", () => {
  dragStart = null;
});

handle.addEventListener("dblclick", () => invoke("start_break_now"));

pauseBtn.addEventListener("click", () => invoke("toggle_pause"));
$<HTMLButtonElement>("break").addEventListener("click", () => invoke("start_break_now"));
$<HTMLButtonElement>("settings").addEventListener("click", () => invoke("open_settings_window"));

async function init(): Promise<void> {
  await listen<TimerSnapshot>("timer-tick", (e) => render(e.payload));
  await listen<{ x: number; y: number }>("cursor-move", (e) => eyes.look(e.payload.x, e.payload.y));
  await listen<TimerSnapshot>("break-completed", () => eyes.celebrate());

  try {
    render(await invoke<TimerSnapshot>("get_timer_snapshot"));
  } catch {
    /* backend not ready */
  }
}

init();
