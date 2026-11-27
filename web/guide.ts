import "./common";

/* ---------- 20-second try-it-now timer ---------- */

const DURATION_MS = 20_000;

const btn = document.getElementById("try-start") as HTMLButtonElement | null;
const readout = document.getElementById("try-count");
const prompt = document.getElementById("try-prompt");
const bar = document.getElementById("try-bar");
const status = document.getElementById("try-status");
const done = document.getElementById("try-done");

if (btn && readout && prompt && bar && status && done) {
  let timer: number | undefined;

  const reset = (): void => {
    window.clearInterval(timer);
    timer = undefined;
    btn.textContent = "Start 20-second break";
    btn.disabled = false;
    readout.textContent = "20";
    bar.style.transform = "scaleX(1)";
  };

  const finish = (): void => {
    window.clearInterval(timer);
    timer = undefined;
    readout.textContent = "0";
    bar.style.transform = "scaleX(0)";
    prompt.textContent = "Nice. That is one 20-20-20 break.";
    status.textContent = "Break complete.";
    done.hidden = false;
    btn.textContent = "Do it again";
    btn.disabled = false;
  };

  btn.addEventListener("click", () => {
    if (timer !== undefined) return;
    reset();
    done.hidden = true;
    btn.disabled = true;
    btn.textContent = "Looking far away...";
    prompt.textContent = "Look at something about 20 feet (6 metres) away.";
    status.textContent = "Timer started. Look at something 20 feet away for 20 seconds.";
    const start = Date.now();
    timer = window.setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - start));
      readout.textContent = String(Math.ceil(left / 1000));
      bar.style.transform = `scaleX(${left / DURATION_MS})`;
      if (left <= 0) finish();
    }, 100);
  });
}
