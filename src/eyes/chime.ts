/**
 * Synthesizes a gentle, soothing harmonic singing-bowl chime using Web Audio API.
 * Zero external audio assets needed, tiny footprint.
 */
export function playGentleChime(type: "start" | "complete" = "complete"): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes =
      type === "complete"
        ? [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6 (uplifting resolution)
        : [440.0, 523.25]; // A4, C5 (soft gentle reminder)

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.12 / (idx * 0.4 + 1), now + idx * 0.11 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 1.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 1.45);
    });
  } catch {
    // Ignore if audio is blocked by autoplay policy
  }
}

