import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EyesComponent } from "./eyes/eyes";
import { playGentleChime } from "./eyes/chime";
import type { TimerSnapshot } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = $("root");
const title = $("title");
const hint = $("hint");
const secs = $("secs");
const fill = $("bar-fill");
const skip = $<HTMLButtonElement>("skip");
const plus = $<HTMLButtonElement>("plus");
const sep = $("sep");

const eyes = new EyesComponent($("eyes"), {
  mood: "relaxing",
  autoBlink: false,
  breathing: true,
});

const HINTS = ["About 20 feet. Let your eyes go soft.", "Breathe in…", "…and out."];
let hintTimer: number | null = null;

function setHint(text: string): void {
  hint.classList.add("fade");
  window.setTimeout(() => {
    hint.textContent = text;
    hint.classList.remove("fade");
  }, 300);
}

function startHints(): void {
  stopHints();
  hint.textContent = HINTS[0];
  let i = 0;
  hintTimer = window.setInterval(() => {
    i = i === 1 ? 2 : 1;
    setHint(HINTS[i]);
  }, 4000);
}

function stopHints(): void {
  if (hintTimer !== null) window.clearInterval(hintTimer);
  hintTimer = null;
}

let lastPhase = "";
let done = false;

function render(s: TimerSnapshot): void {
  eyes.setStyle(s.settings.eye_style);
  const overlay = s.settings.break_style === "overlay";
  root.classList.toggle("mode-overlay", overlay);
  root.classList.toggle("mode-card", !overlay);
  skip.classList.toggle("hidden", s.settings.strict_mode);
  sep.classList.toggle("hidden", s.settings.strict_mode);

  if (s.phase === "Break") {
    if (lastPhase !== "Break") {
      done = false;
      root.classList.remove("is-done");
      title.textContent = "Look at something far away";
      eyes.setProgress(0);
      eyes.setMood("relaxing");
      startHints();
      // Reset bar without animating backwards
      fill.style.transition = "none";
      fill.style.transform = "scaleX(1)";
      void fill.offsetWidth;
      fill.style.transition = "";
      if (s.settings.sound_enabled) playGentleChime("start");
    }

    if (!done) {
      secs.textContent = String(Math.max(0, s.remaining_secs));
      const frac = s.total_secs > 0 ? s.remaining_secs / s.total_secs : 0;
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    }
  }

  lastPhase = s.phase;
}

skip.addEventListener("click", () => invoke("skip_break"));
plus.addEventListener("click", () => invoke("extend_break", { extraSecs: 10 }));

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !skip.classList.contains("hidden")) invoke("skip_break");
});

async function init(): Promise<void> {
  try {
    render(await invoke<TimerSnapshot>("get_timer_snapshot"));
  } catch {
    /* backend not ready */
  }

  await listen<TimerSnapshot>("timer-tick", (e) => render(e.payload));

  await listen<TimerSnapshot>("break-completed", (e) => {
    done = true;
    stopHints();
    root.classList.add("is-done");
    title.textContent = "Nice. Eyes refreshed.";
    setHint("See you in a bit.");
    eyes.setMood("happy");
    if (e.payload.settings.sound_enabled) playGentleChime("complete");
  });
}

init();
