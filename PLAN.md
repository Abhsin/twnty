# twnty — Plan

A tiny, open-source desktop companion for the **20-20-20 rule**: every 20 minutes, look at something 20 feet away for 20 seconds.

A pair of eyes lives in your menu bar (macOS) or system tray (Windows). They slowly turn red as 20 minutes pass. When time's up, a gentle reminder appears with a 20-second countdown, and the eyes go back to clear white.

---

## 1. Tech stack

| Choice | Why |
|---|---|
| **Tauri v2** (Rust backend + system webview) | ~5–10 MB installer and low RAM, compared with 100 MB+ for Electron. One codebase for Windows and macOS, with first-class tray/menu-bar support. Node 22 and Rust 1.89 are already installed. |
| **Vite + vanilla TypeScript** for the UI | The UI is just two small windows, so a framework isn't needed. Swap in Svelte later if the settings UI grows. |
| **SVG** for the eyes | Crisp at any size, easy to animate (redness, blinking, pupils), and the same art can be rasterized into tray icons. |
| Plugins: `tauri-plugin-notification`, `tauri-plugin-autostart`, `tauri-plugin-store` | Native notifications, launch at login, and persisted settings. |

**Timer lives in Rust**, not in the webview. Webviews get throttled when hidden, and the timer has to keep running while no window is open.

## 2. Where the eyes live

1. **Tray / menu-bar icon (MVP).** Pre-rendered icon frames (e.g. 8 stages from white → bloodshot red) are swapped as time passes. On macOS this sits in the menu bar; on Windows, in the notification area.
2. **Floating mini-widget (Phase 2).** A small, transparent, always-on-top, draggable window with the animated eyes (blinking, pupils following the cursor, veins spreading). This is the "eyes living on the desktop" experience.
3. **Native macOS widget (later / maybe).** A Notification Center widget needs Swift and WidgetKit, which is a separate project. Out of scope for now.

## 3. MVP scope (Phase 1)

Goal: something you can run all day and it works.

- [x] Scaffold Tauri v2 app (`npm create tauri-app`), no main window on launch (tray-only app; hide the Dock icon on macOS).
- [x] Rust timer: 20-min work interval → break state → 20-sec break → reset. Emits progress events (0.0–1.0).
- [x] Tray icon with ~4 redness stages for now (placeholder art), updated as progress changes.
- [x] Tray menu: *Time left: 12 min* · *Take a break now* · *Pause / Resume* · *Reset* · *Quit*.
- [x] Break reminder: small centered always-on-top window, "Look at something 20 feet away", big 20 → 0 countdown, *Skip* button, auto-closes and resets the timer.
- [x] Native notification as a fallback when the break starts.
- [x] Runs on Windows and macOS from `npm run tauri dev`.

**Not in the MVP:** settings UI, idle detection, sounds, installers, polished art.

## 4. Phase 2: Design it beautifully

- [x] Design the eyes: a friendly, minimal style. Iris color, highlight, eyelids, a vein layer whose opacity follows progress, and redness tinting the sclera.
- [x] Tray icon set: 8–10 frames, light and dark variants. macOS template-image considerations: colored eyes need a non-template icon, so test them against light and dark menu bars.
- [x] Floating widget: blinks every few seconds, blinks more often and looks "tired" (droopy lids) near 20 min, pupils track the cursor.
- [x] Break screen redesign: soft blurred backdrop, eyes closing and relaxing, breathing-style countdown ring, optional chime at the end.
- [x] Micro-interactions: eyes "wake up" fresh after a break, a happy squint when the break is completed rather than skipped.

## 5. Phase 3: Make it a good citizen

- [x] **Idle / lock detection:** pause the timer when the screen is locked or the user is idle for more than 5 min, and reset after a long absence.
- [x] Settings window: interval, break length, sound on/off, launch at login, show floating widget, strict mode (no skip).
- [x] Persist settings (`tauri-plugin-store` / JSON config persistence).
- [x] Don't interrupt fullscreen apps and presentations: defer the break, or just notify.
- [x] Multi-monitor: show the break window on the active display.
- [x] Optional stats: breaks taken vs skipped today.

## 6. Phase 4: Open-source release

- [ ] MIT license, README with GIF, CONTRIBUTING.md.
- [ ] GitHub Actions with `tauri-apps/tauri-action`: build `.msi`/`.exe` (Windows) and universal `.dmg` (macOS) on tag push, attached to GitHub Releases.
- [ ] Code signing: unsigned builds at first (document the Gatekeeper and SmartScreen workarounds). Add an Apple Developer ID and notarization later if there's demand.
- [ ] Auto-update via `tauri-plugin-updater` (optional).

## 7. Proposed structure

```
twntytwntytwnty/
├─ src/                  # frontend (TS + SVG)
│  ├─ break.html / break.ts     # break reminder window
│  ├─ widget.html / widget.ts   # floating eyes (Phase 2)
│  ├─ eyes/                     # shared SVG eye component + styles
│  └─ settings.html             # Phase 3
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs / lib.rs       # app setup, tray, windows
│  │  ├─ timer.rs               # state machine: Working → Break → Working
│  │  └─ tray.rs                # icon frames + menu
│  ├─ icons/tray/               # eye-0.png … eye-7.png (+ @2x)
│  └─ tauri.conf.json
└─ PLAN.md
```

## 8. Open questions

1. **App name:** keep `twntytwntytwnty`? (Short alternatives: *Blink*, *2020eyes*.)
2. **Floating widget in the MVP?** Recommendation: no. Ship tray-first and add the widget in Phase 2.
3. **Break style:** a small gentle window (recommended default) vs a full-screen dimmed overlay (more forceful). Could be a setting.
