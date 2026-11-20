/**
 * Synthesizes a gentle, soothing harmonic singing-bowl chime using Web Audio API.
 * Reuses a single AudioContext across calls to avoid leaking OS audio threads.
 */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioCtx();
  }
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

export function playGentleChime(type: "start" | "complete" = "complete"): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes =
      type === "complete"
        ? [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
        : [440.0, 523.25]; // A4, C5

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.11;
      const stop = start + 1.45;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12 / (idx * 0.4 + 1), start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };

      osc.start(start);
      osc.stop(stop);
    });
  } catch {
    // Ignore if audio is blocked by autoplay policy
  }
}
