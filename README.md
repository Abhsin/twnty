# twnty 👁️👁️

A tiny, open-source desktop companion for the **20-20-20 rule**: every 20 minutes, look at something 20 feet away for 20 seconds.

A pair of friendly eyes lives in your menu bar (macOS) or system tray (Windows) — and optionally floats on your desktop. They slowly turn bloodshot red and droop as 20 minutes pass. When time is up, a gentle reminder appears with a 20-second breathing countdown, a soft singing-bowl chime, and the eyes wake up fresh and clear white.

---

## Features

- **5 Selectable Eye Styles**: Choose between **Classic**, **Googly** (with spring-physics pupils), **Cat** (with dilating vertical slits), **Sparkle** (anime style), and **Dot** (minimalist ink dots with blushing cheeks).
- **macOS Status Bar & Windows System Tray**: 10 progressive redness stages rendered dynamically at Retina resolution (`60×44` `@2x` on macOS, `48×48` on Windows) with a subtle white sticker halo for both light and dark menu bars, plus an optional live countdown next to the eyes on macOS.
- **Floating Desktop Companion (Optional)**: Transparent, always-on-top, draggable SVG eyes that blink naturally, get sleepier near 20 minutes, track your cursor across the screen, and smile when you finish a break.
- **Configurable Break Reminder**:
  - **Card** (centered on your active monitor)
  - **Full screen** (calm field of color for deeper rest)
- **Rust-Powered State Machine**: Timer runs natively in Rust so hidden webviews never throttle your countdown.
- **Good Citizen Features**:
  - **Pause When Away**: Automatically pauses after 5 minutes without input and resets after a long absence.
  - **Respect Full Screen**: Defers popup windows and sends a quiet notification during fullscreen apps, games, and presentations.
  - **Multi-Monitor Aware**: Opens the break reminder on whichever display your cursor is currently on.
  - **Strict Mode**: Optionally hides the *Skip* button.
  - **Daily Stats & Settings**: Track breaks taken vs. skipped today and customize work/rest intervals (including a **20-second demo** mode).

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Rust** 1.80+

### Run in Development

```bash
npm install
npm run tauri dev
```

### Build Standalone Release

```bash
npm run build:exe
npm start
```

Or build platform installers (`.dmg` on macOS, `.msi`/`.exe` on Windows):

```bash
npm run tauri build
```

---

## License

MIT
