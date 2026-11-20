import "./eyes.css";

/**
 * working  – open, slowly reddening and drooping with progress
 * paused   – half-lidded
 * relaxing – closed, content (‿ ‿)
 * happy    – closed, smiling (^ ^)
 */
export type EyeMood = "working" | "paused" | "relaxing" | "happy";
export type EyeStyle = "classic" | "googly" | "cat" | "anime" | "dot";

export const EYE_STYLES: { id: EyeStyle; name: string }[] = [
  { id: "classic", name: "Classic" },
  { id: "googly", name: "Googly" },
  { id: "cat", name: "Cat" },
  { id: "anime", name: "Sparkle" },
  { id: "dot", name: "Dot" },
];

export interface EyesOptions {
  style?: EyeStyle;
  progress?: number;
  mood?: EyeMood;
  autoBlink?: boolean;
  trackCursor?: boolean;
  breathing?: boolean;
}

const INK = "#1c1c1a";
const INK_RGB = [28, 28, 26];
const RED = "#e5484d";
const WHITE = [255, 255, 255];
const PINK = [255, 214, 211];
const CY = 56;

type Side = -1 | 1;

interface StyleDef {
  shape(cx: number, side: Side): string;
  rx: number;
  ry: number;
  sclera: [number[], number[]];
  veins: boolean;
  pupil(cx: number): string;
  range: [number, number];
  closedW: number;
  squash?: boolean;
  googly?: boolean;
  overlay?(cx: number): string;
  under?(cx: number): string;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;

const STYLES: Record<EyeStyle, StyleDef> = {
  classic: {
    shape: (cx) => ellipse(cx, CY, 38, 44),
    rx: 38,
    ry: 44,
    sclera: [WHITE, PINK],
    veins: true,
    pupil: (cx) => `
      <circle cx="${cx}" cy="${CY}" r="15" fill="${INK}" />
      <circle cx="${cx - 5}" cy="${CY - 6}" r="4.5" fill="#fff" />`,
    range: [10, 12],
    closedW: 22,
  },

  googly: {
    shape: (cx) => ellipse(cx, CY, 43, 43),
    rx: 43,
    ry: 43,
    sclera: [WHITE, PINK],
    veins: true,
    pupil: (cx) => `<circle cx="${cx}" cy="${CY}" r="20" fill="${INK}" />`,
    range: [18, 18],
    closedW: 24,
    googly: true,
  },

  cat: {
    shape: (cx, side) => {
      const outer = cx + side * 42;
      const inner = cx - side * 40;
      return `M ${outer} 50 Q ${cx} -4 ${inner} 62 Q ${cx} 112 ${outer} 50 Z`;
    },
    rx: 42,
    ry: 34,
    sclera: [
      [196, 222, 112],
      [244, 146, 98],
    ],
    veins: false,
    pupil: (cx) => `
      <ellipse class="slit" cx="${cx}" cy="${CY}" rx="5" ry="23" fill="${INK}" />
      <circle cx="${cx - 8}" cy="${CY - 9}" r="3.5" fill="#fff" />`,
    range: [9, 5],
    closedW: 24,
  },

  anime: {
    shape: (cx) => ellipse(cx, CY, 32, 44),
    rx: 32,
    ry: 44,
    sclera: [WHITE, PINK],
    veins: true,
    pupil: (cx) => `
      <ellipse cx="${cx}" cy="${CY}" rx="21" ry="28" fill="${INK}" />
      <ellipse cx="${cx}" cy="${CY + 13}" rx="13" ry="10" fill="#55554f" />
      <circle cx="${cx - 7}" cy="${CY - 11}" r="7.5" fill="#fff" />
      <circle cx="${cx + 8}" cy="${CY + 9}" r="3" fill="#fff" />`,
    range: [6, 7],
    closedW: 20,
    overlay: (cx) =>
      `<path d="M ${cx - 30} ${CY - 14} A 32 44 0 0 1 ${cx + 30} ${CY - 14}"
        fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" />`,
  },

  dot: {
    shape: (cx) => ellipse(cx, CY, 15, 21),
    rx: 15,
    ry: 21,
    sclera: [INK_RGB, INK_RGB],
    veins: false,
    pupil: (cx) => `<circle cx="${cx - 4}" cy="${CY - 7}" r="4.5" fill="#fff" />`,
    range: [3, 3],
    closedW: 13,
    squash: true,
    under: (cx) =>
      `<ellipse class="eye-blush" cx="${cx}" cy="${CY + 34}" rx="15" ry="6" fill="${RED}" opacity="0" />`,
  },
};

function mix(a: number[], b: number[], t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function closedPath(cx: number, mood: EyeMood, w: number): string {
  return mood === "happy"
    ? `M ${cx - w} ${CY + 8} Q ${cx} ${CY - 16} ${cx + w} ${CY + 8}`
    : `M ${cx - w} ${CY - 2} Q ${cx} ${CY + 16} ${cx + w} ${CY - 2}`;
}

function eyeMarkup(d: StyleDef, id: string, cx: number, side: Side): string {
  const shape = d.shape(cx, side);
  const { rx, ry } = d;

  const veins = d.veins
    ? `<g class="eye-veins" opacity="0" stroke="${RED}" stroke-width="1.6" fill="none" stroke-linecap="round">
        <path d="M ${cx - rx} ${CY - 6} q 10 2 16 -4 m -8 2 q 4 6 9 6" />
        <path d="M ${cx + rx} ${CY + 8} q -10 -1 -16 4 m 8 -2 q -3 -6 -9 -6" />
        <path d="M ${cx - rx + 5} ${CY + 24} q 9 -5 15 -2" />
        <path d="M ${cx + rx - 5} ${CY - 24} q -9 4 -14 1" />
      </g>`
    : "";

  const lid = d.squash
    ? ""
    : `<path class="eye-lid" fill="${INK}"
        d="M ${cx - rx - 6} ${CY - ry - 100} H ${cx + rx + 6} V ${CY - ry} Q ${cx} ${CY - ry + 12} ${cx - rx - 6} ${CY - ry} Z" />`;

  return `
    <defs>
      <clipPath id="clip-${id}"><path d="${shape}" /></clipPath>
    </defs>
    <g class="eye">
      ${d.under ? d.under(cx) : ""}
      <g class="eye-open">
        <g class="eye-squash">
          <path d="${shape}" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round" />
          <g clip-path="url(#clip-${id})">
            <path class="eye-sclera" d="${shape}" fill="#fff" />
            ${veins}
            <g class="eye-pupil">${d.pupil(cx)}</g>
            ${lid}
          </g>
          <path d="${shape}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" />
          ${d.overlay ? d.overlay(cx) : ""}
        </g>
      </g>
      <g class="eye-closed" fill="none" stroke-linecap="round">
        <path class="closed-path" stroke="#fff" stroke-width="11" />
        <path class="closed-path" stroke="${INK}" stroke-width="4" />
      </g>
    </g>`;
}

let instanceCounter = 0;

interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class EyesComponent {
  private stage: HTMLDivElement;
  private style: EyeStyle;
  private def: StyleDef;
  private progress: number;
  private mood: EyeMood;
  private autoBlink: boolean;
  private trackCursor: boolean;
  private celebrating = false;
  private blinking = false;
  private blinkTimer: number | null = null;
  private blinkEndTimer: number | null = null;
  private doubleBlinkTimer: number | null = null;
  private celebrateTimer: number | null = null;
  private target = { x: 0, y: 0 };
  private centers = [55, 145];

  private springs: Spring[] = [
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, vx: 0, vy: 0 },
  ];
  private raf = 0;

  private sclera: SVGElement[] = [];
  private veins: SVGElement[] = [];
  private pupils: SVGElement[] = [];
  private lids: SVGElement[] = [];
  private squashes: SVGElement[] = [];
  private slits: SVGElement[] = [];
  private blush: SVGElement[] = [];
  private closedPaths: SVGPathElement[] = [];

  // Cache last applied attribute/style values to skip redundant DOM writes
  private lastFill = "";
  private lastVein = "";
  private lastBlush = "";
  private lastSlit = "";
  private lastLid = "";
  private lastSquash = "";
  private lastPupilTf = "";
  private lastClosedKey = "";

  constructor(container: HTMLElement, opts: EyesOptions = {}) {
    this.style = opts.style ?? "classic";
    this.def = STYLES[this.style];
    this.progress = opts.progress ?? 0;
    this.mood = opts.mood ?? "working";
    this.autoBlink = opts.autoBlink !== false;
    this.trackCursor = Boolean(opts.trackCursor);

    this.stage = document.createElement("div");
    this.stage.className = "eyes-stage";
    if (opts.breathing) this.stage.classList.add("is-breathing");
    container.replaceChildren(this.stage);

    this.build();

    if (this.autoBlink && !document.hidden) this.scheduleBlink();
    if (this.trackCursor) window.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  setStyle(style: EyeStyle | string): void {
    const next = (style in STYLES ? style : "classic") as EyeStyle;
    if (next === this.style) return;
    this.style = next;
    this.def = STYLES[next];
    this.build();
  }

  setProgress(p: number): void {
    this.progress = Math.max(0, Math.min(1, p));
    this.render();
  }

  setMood(mood: EyeMood): void {
    if (this.celebrating && mood === "working") return;
    if (mood !== "happy" && this.celebrating) {
      this.celebrating = false;
      if (this.celebrateTimer !== null) {
        window.clearTimeout(this.celebrateTimer);
        this.celebrateTimer = null;
      }
    }
    if (mood === this.mood) return;
    this.mood = mood;
    this.kick();
    this.render();
  }

  /** Smile for a moment, then open fresh and clear. */
  celebrate(ms = 1600): void {
    if (this.celebrateTimer !== null) {
      window.clearTimeout(this.celebrateTimer);
    }
    this.celebrating = true;
    this.progress = 0;
    this.mood = "happy";
    this.render();
    this.celebrateTimer = window.setTimeout(() => {
      this.celebrateTimer = null;
      this.celebrating = false;
      if (this.mood === "happy") {
        this.mood = "working";
        this.kick();
        this.render();
      }
    }, ms);
  }

  /** Normalized -1..1 gaze direction. */
  look(nx: number, ny: number): void {
    this.target.x = Math.max(-1, Math.min(1, nx));
    this.target.y = Math.max(-1, Math.min(1, ny));
    if (this.def.googly) {
      this.wakeSprings();
    } else {
      this.renderPupils();
    }
  }

  blink(): void {
    if (this.blinking || this.mood === "relaxing" || this.mood === "happy" || document.hidden) {
      return;
    }
    this.blinking = true;
    this.render();
    if (this.blinkEndTimer !== null) window.clearTimeout(this.blinkEndTimer);
    this.blinkEndTimer = window.setTimeout(() => {
      this.blinkEndTimer = null;
      this.blinking = false;
      this.kick();
      this.render();
    }, 130 + this.progress * 90);
  }

  destroy(): void {
    this.clearTimers();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.trackCursor) window.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  // ---------------------------------------------------------------------------

  private clearTimers(): void {
    if (this.blinkTimer !== null) {
      window.clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.blinkEndTimer !== null) {
      window.clearTimeout(this.blinkEndTimer);
      this.blinkEndTimer = null;
    }
    if (this.doubleBlinkTimer !== null) {
      window.clearTimeout(this.doubleBlinkTimer);
      this.doubleBlinkTimer = null;
    }
    if (this.celebrateTimer !== null) {
      window.clearTimeout(this.celebrateTimer);
      this.celebrateTimer = null;
    }
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.blinkTimer !== null) {
        window.clearTimeout(this.blinkTimer);
        this.blinkTimer = null;
      }
      if (this.doubleBlinkTimer !== null) {
        window.clearTimeout(this.doubleBlinkTimer);
        this.doubleBlinkTimer = null;
      }
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      if (this.autoBlink && this.blinkTimer === null) this.scheduleBlink();
      if (this.def.googly) this.wakeSprings();
    }
  };

  private build(): void {
    const uid = `e${instanceCounter++}`;
    const d = this.def;
    this.stage.classList.toggle("is-googly", Boolean(d.googly));
    this.stage.innerHTML = `
      <svg class="eyes-svg" viewBox="0 0 200 112" xmlns="http://www.w3.org/2000/svg">
        ${eyeMarkup(d, `${uid}l`, this.centers[0], -1)}
        ${eyeMarkup(d, `${uid}r`, this.centers[1], 1)}
      </svg>`;

    const q = <T extends Element>(s: string) => Array.from(this.stage.querySelectorAll<T>(s));
    this.sclera = q(".eye-sclera");
    this.veins = q(".eye-veins");
    this.pupils = q(".eye-pupil");
    this.lids = q(".eye-lid");
    this.squashes = q(".eye-squash");
    this.slits = q(".slit");
    this.blush = q(".eye-blush");
    this.closedPaths = q(".closed-path");

    this.lastFill = "";
    this.lastVein = "";
    this.lastBlush = "";
    this.lastSlit = "";
    this.lastLid = "";
    this.lastSquash = "";
    this.lastPupilTf = "";
    this.lastClosedKey = "";

    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (d.googly) {
      this.springs.forEach((s) => Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0 }));
      this.wakeSprings();
    }

    this.render();
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (document.hidden) return;
    const r = this.stage.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dx = (e.clientX - (r.left + r.width / 2)) / 260;
    const dy = (e.clientY - (r.top + r.height / 2)) / 200;
    const d = Math.hypot(dx, dy);
    const s = d > 1 ? 1 / d : 1;
    this.look(dx * s, dy * s);
  };

  private wakeSprings(): void {
    if (!this.def.googly || this.raf !== 0 || document.hidden) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Give googly pupils a little jolt. */
  private kick(): void {
    if (!this.def.googly) return;
    this.springs.forEach((s, i) => {
      s.vy -= 3 + i;
      s.vx += (Math.random() - 0.5) * 4;
    });
    this.wakeSprings();
  }

  private tick = (): void => {
    if (document.hidden) {
      this.raf = 0;
      return;
    }

    const [rx, ry] = this.def.range;
    const tx = this.target.x * rx;
    const ty = this.target.y * ry + 7; // gravity: pupils settle low
    const max = 19;

    let allSettled = true;
    this.springs.forEach((s, i) => {
      const k = i ? 0.085 : 0.12;
      const damp = i ? 0.84 : 0.8;
      s.vx = (s.vx + (tx - s.x) * k) * damp;
      s.vy = (s.vy + (ty - s.y) * k) * damp;
      s.x += s.vx;
      s.y += s.vy;
      const len = Math.hypot(s.x, s.y);
      if (len > max) {
        s.x *= max / len;
        s.y *= max / len;
        s.vx *= -0.4;
        s.vy *= -0.4;
      }

      const settled =
        Math.abs(s.vx) < 0.05 &&
        Math.abs(s.vy) < 0.05 &&
        Math.abs(tx - s.x) < 0.1 &&
        Math.abs(ty - s.y) < 0.1;

      if (settled) {
        s.x = tx;
        s.y = ty;
        s.vx = 0;
        s.vy = 0;
      } else {
        allSettled = false;
      }

      const el = this.pupils[i];
      if (el) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    });

    if (allSettled) {
      this.raf = 0;
      return;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private scheduleBlink(): void {
    if (this.blinkTimer !== null) window.clearTimeout(this.blinkTimer);
    if (document.hidden) {
      this.blinkTimer = null;
      return;
    }
    const t = this.progress;
    const min = 3000 - t * 1500;
    const max = 6000 - t * 3000;
    this.blinkTimer = window.setTimeout(() => {
      this.blinkTimer = null;
      this.blink();
      if (t > 0.7 && Math.random() < 0.3 && !document.hidden) {
        if (this.doubleBlinkTimer !== null) window.clearTimeout(this.doubleBlinkTimer);
        this.doubleBlinkTimer = window.setTimeout(() => {
          this.doubleBlinkTimer = null;
          this.blink();
        }, 320);
      }
      this.scheduleBlink();
    }, min + Math.random() * (max - min));
  }

  private renderPupils(): void {
    if (this.def.googly) return;
    const [rx, ry] = this.def.range;
    const droop = this.mood === "working" ? Math.max(0, this.progress - 0.6) * 10 : 0;
    const x = this.target.x * rx;
    const y = this.target.y * ry + droop;
    const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (tf === this.lastPupilTf) return;
    this.lastPupilTf = tf;
    for (const p of this.pupils) p.style.transform = tf;
  }

  private render(): void {
    const d = this.def;
    const closed = this.mood === "relaxing" || this.mood === "happy";
    this.stage.classList.toggle("is-closed", closed);

    const p = closed ? 0 : this.progress;
    const strain = Math.pow(p, 1.3);

    const fill = mix(d.sclera[0], d.sclera[1], strain);
    if (fill !== this.lastFill) {
      this.lastFill = fill;
      for (const s of this.sclera) s.setAttribute("fill", fill);
    }

    const veinOpacity = (p < 0.25 ? 0 : Math.pow((p - 0.25) / 0.75, 1.2)).toFixed(2);
    if (veinOpacity !== this.lastVein) {
      this.lastVein = veinOpacity;
      for (const v of this.veins) v.setAttribute("opacity", veinOpacity);
    }

    const blushOpacity = (p < 0.2 ? 0 : ((p - 0.2) / 0.8) * 0.55).toFixed(2);
    if (blushOpacity !== this.lastBlush) {
      this.lastBlush = blushOpacity;
      for (const b of this.blush) b.setAttribute("opacity", blushOpacity);
    }

    const slitRx = (4 + p * 8).toFixed(1);
    if (slitRx !== this.lastSlit) {
      this.lastSlit = slitRx;
      for (const s of this.slits) s.setAttribute("rx", slitRx);
    }

    if (d.squash) {
      let sy = 1 - (Math.max(0, p - 0.4) / 0.6) * 0.35;
      if (this.mood === "paused") sy = 0.55;
      if (this.blinking) sy = 0.08;
      const squashTf = `scaleY(${sy.toFixed(2)})`;
      if (squashTf !== this.lastSquash) {
        this.lastSquash = squashTf;
        for (const s of this.squashes) s.style.transform = squashTf;
      }
    } else {
      const open = -12;
      let lid = open;
      if (this.blinking) lid = 2 * d.ry + 4;
      else if (this.mood === "paused") lid = d.ry * 0.8;
      else if (this.mood === "working" && p > 0.5) lid = open + ((p - 0.5) / 0.5) * d.ry * 0.8;
      const lidTf = `translateY(${lid.toFixed(1)}px)`;
      if (lidTf !== this.lastLid) {
        this.lastLid = lidTf;
        for (const l of this.lids) l.style.transform = lidTf;
      }
    }

    if (closed) {
      const closedKey = `${this.mood}:${d.closedW}`;
      if (closedKey !== this.lastClosedKey) {
        this.lastClosedKey = closedKey;
        this.closedPaths.forEach((path, i) => {
          const cx = this.centers[i < 2 ? 0 : 1];
          path.setAttribute("d", closedPath(cx, this.mood, d.closedW));
        });
      }
    }

    this.renderPupils();
  }
}
