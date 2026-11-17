use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Wry,
};

use crate::idle;
use crate::tray::{render_tray_icon_rgba, TrayHandles};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimerPhase {
    Working,
    Break,
    Paused,
}

fn default_eye_style() -> String {
    "classic".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub work_duration_secs: u64,
    pub break_duration_secs: u64,
    pub break_style: String, // "card" | "overlay"
    pub sound_enabled: bool,
    pub strict_mode: bool,
    pub show_floating_widget: bool,
    pub idle_detection_enabled: bool,
    pub idle_threshold_secs: u64,
    pub defer_on_fullscreen: bool,
    pub launch_at_login: bool,
    #[serde(default = "default_eye_style")]
    pub eye_style: String,
    #[serde(default)]
    pub show_tray_timer: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            work_duration_secs: 20 * 60, // 20 minutes
            break_duration_secs: 20,     // 20 seconds
            break_style: "card".to_string(),
            sound_enabled: true,
            strict_mode: false,
            show_floating_widget: false, // Tray-only by default (Phase 1), togglable for Phase 2
            idle_detection_enabled: true,
            idle_threshold_secs: 300, // 5 minutes
            defer_on_fullscreen: true,
            launch_at_login: false,
            eye_style: default_eye_style(),
            show_tray_timer: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStats {
    pub date: String,
    pub breaks_completed: u32,
    pub breaks_skipped: u32,
}

impl Default for DailyStats {
    fn default() -> Self {
        Self {
            date: Local::now().format("%Y-%m-%d").to_string(),
            breaks_completed: 0,
            breaks_skipped: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSnapshot {
    pub phase: TimerPhase,
    pub elapsed_secs: u64,
    pub total_secs: u64,
    pub remaining_secs: u64,
    pub progress: f32,
    pub is_idle_paused: bool,
    pub cursor_norm_x: f32,
    pub cursor_norm_y: f32,
    pub settings: AppSettings,
    pub stats: DailyStats,
}

pub struct InnerState {
    pub phase: TimerPhase,
    pub elapsed_secs: u64,
    pub total_secs: u64,
    pub is_idle_paused: bool,
    pub last_tray_bucket: i32,
    pub cursor_norm_x: f32,
    pub cursor_norm_y: f32,
    pub settings: AppSettings,
    pub stats: DailyStats,
    pub config_dir: PathBuf,
    pub tray_handles: Option<TrayHandles<Wry>>,
}

pub struct SharedAppState(pub Mutex<InnerState>);

impl InnerState {
    pub fn snapshot(&self) -> TimerSnapshot {
        let remaining_secs = self.total_secs.saturating_sub(self.elapsed_secs);
        let progress = if self.total_secs > 0 {
            (self.elapsed_secs as f32 / self.total_secs as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };
        TimerSnapshot {
            phase: self.phase,
            elapsed_secs: self.elapsed_secs,
            total_secs: self.total_secs,
            remaining_secs,
            progress,
            is_idle_paused: self.is_idle_paused,
            cursor_norm_x: self.cursor_norm_x,
            cursor_norm_y: self.cursor_norm_y,
            settings: self.settings.clone(),
            stats: self.stats.clone(),
        }
    }

    pub fn ensure_today_stats(&mut self) {
        let today = Local::now().format("%Y-%m-%d").to_string();
        if self.stats.date != today {
            self.stats = DailyStats {
                date: today,
                breaks_completed: 0,
                breaks_skipped: 0,
            };
            self.save_stats();
        }
    }

    pub fn save_settings(&self) {
        let _ = fs::create_dir_all(&self.config_dir);
        let path = self.config_dir.join("settings.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.settings) {
            let _ = fs::write(path, json);
        }
    }

    pub fn save_stats(&self) {
        let _ = fs::create_dir_all(&self.config_dir);
        let path = self.config_dir.join("stats.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.stats) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn load_persisted(config_dir: &PathBuf) -> (AppSettings, DailyStats) {
    let settings = fs::read_to_string(config_dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default();

    let today = Local::now().format("%Y-%m-%d").to_string();
    let stats = fs::read_to_string(config_dir.join("stats.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<DailyStats>(&s).ok())
        .filter(|st| st.date == today)
        .unwrap_or_default();

    (settings, stats)
}

fn format_mm_ss(secs: u64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    format!("{:02}:{:02}", m, s)
}

pub fn sync_tray_and_emit(app: &AppHandle, state: &mut InnerState) {
    let snap = state.snapshot();

    if let Some(ref handles) = state.tray_handles {
        let status_label = match snap.phase {
            TimerPhase::Working => {
                if snap.is_idle_paused {
                    format!("Idle paused ({})", format_mm_ss(snap.remaining_secs))
                } else {
                    format!("Next break in {}", format_mm_ss(snap.remaining_secs))
                }
            }
            TimerPhase::Break => format!("Resting eyes ({}s left)", snap.remaining_secs),
            TimerPhase::Paused => format!("Paused ({})", format_mm_ss(snap.remaining_secs)),
        };

        let _ = handles.status_item.set_text(&status_label);
        let _ = handles.pause_item.set_text(if snap.phase == TimerPhase::Paused {
            "Resume timer"
        } else {
            "Pause timer"
        });
        let _ = handles.widget_item.set_text(if snap.settings.show_floating_widget {
            "Hide Floating Eyes"
        } else {
            "Show Floating Eyes"
        });

        for (style_id, item) in &handles.style_items {
            let _ = item.set_checked(style_id == &snap.settings.eye_style);
        }

        // macOS status bar title next to the eyes icon
        if snap.settings.show_tray_timer {
            let bar_title = match snap.phase {
                TimerPhase::Break => format!(" {}s", snap.remaining_secs),
                TimerPhase::Paused => " ⏸".to_string(),
                TimerPhase::Working => {
                    if snap.is_idle_paused {
                        " ⏸".to_string()
                    } else {
                        format!(" {}", format_mm_ss(snap.remaining_secs))
                    }
                }
            };
            let _ = handles.tray.set_title(Some(&bar_title));
        } else {
            let _ = handles.tray.set_title(Some(""));
        }

        let tooltip = format!(
            "twnty — {} · Today: {} rest{}",
            status_label,
            snap.stats.breaks_completed,
            if snap.stats.breaks_completed == 1 { "" } else { "s" }
        );
        let _ = handles.tray.set_tooltip(Some(&tooltip));

        // Bucket tray icon into 10 redness stages (0..=9), or special buckets for Break (-2) / Paused (-3)
        let bucket = match snap.phase {
            TimerPhase::Break => -2,
            TimerPhase::Paused => -3,
            TimerPhase::Working => {
                if snap.is_idle_paused {
                    -3
                } else {
                    ((snap.progress * 9.0).round() as i32).clamp(0, 9)
                }
            }
        };

        if bucket != state.last_tray_bucket {
            state.last_tray_bucket = bucket;
            let icon = render_tray_icon_rgba(
                &snap.settings.eye_style,
                snap.progress,
                snap.phase == TimerPhase::Break,
                snap.phase == TimerPhase::Paused || snap.is_idle_paused,
            );
            let _ = handles.tray.set_icon(Some(icon));
        }
    }

    let _ = app.emit("timer-tick", &snap);
}

/// Positions and shows the break window on the active monitor where the cursor currently resides.
pub fn present_break_window(app: &AppHandle, break_style: &str) {
    if let Some(win) = app.get_webview_window("break") {
        let cursor = idle::get_cursor_screen_pos();
        let monitors = win.available_monitors().unwrap_or_default();

        let active_mon = cursor
            .and_then(|(cx, cy)| {
                monitors.iter().find(|m| {
                    let pos = m.position();
                    let size = m.size();
                    cx >= pos.x
                        && cx < pos.x + size.width as i32
                        && cy >= pos.y
                        && cy < pos.y + size.height as i32
                })
            })
            .or_else(|| monitors.first());

        if break_style == "overlay" {
            if let Some(mon) = active_mon {
                let pos = mon.position();
                let size = mon.size();
                let _ = win.set_size(PhysicalSize::new(size.width, size.height));
                let _ = win.set_position(PhysicalPosition::new(pos.x, pos.y));
            } else {
                let _ = win.set_size(LogicalSize::new(1280.0, 800.0));
                let _ = win.center();
            }
        } else {
            // Small gentle card (440x420 logical) centered on active monitor
            let scale = active_mon.map(|m| m.scale_factor()).unwrap_or(1.0);
            let card_w = (440.0 * scale) as u32;
            let card_h = (420.0 * scale) as u32;
            let _ = win.set_size(PhysicalSize::new(card_w, card_h));

            if let Some(mon) = active_mon {
                let pos = mon.position();
                let size = mon.size();
                let x = pos.x + (size.width as i32 - card_w as i32) / 2;
                let y = pos.y + (size.height as i32 - card_h as i32) / 2;
                let _ = win.set_position(PhysicalPosition::new(x, y));
            } else {
                let _ = win.center();
            }
        }

        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn hide_break_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("break") {
        let _ = win.hide();
    }
}

pub fn sync_widget_visibility(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window("widget") {
        if visible {
            let _ = win.set_size(LogicalSize::new(196.0, 136.0));
            let _ = win.show();
        } else {
            let _ = win.hide();
        }
    }
}

pub fn start_break_internal(app: &AppHandle, state: &mut InnerState, manual: bool) {
    state.ensure_today_stats();

    if !manual && state.settings.defer_on_fullscreen && idle::is_foreground_fullscreen() {
        // Defer popup window & send gentle notification instead of interrupting fullscreen app
        idle::send_native_notification(
            "20-20-20 Eye Break (Fullscreen Quiet Mode)",
            "Look 20 feet away for 20 seconds when you have a moment.",
        );
        state.phase = TimerPhase::Working;
        state.elapsed_secs = 0;
        state.total_secs = state.settings.work_duration_secs;
        sync_tray_and_emit(app, state);
        return;
    }

    state.phase = TimerPhase::Break;
    state.elapsed_secs = 0;
    state.total_secs = state.settings.break_duration_secs;
    state.is_idle_paused = false;

    let style = state.settings.break_style.clone();
    sync_tray_and_emit(app, state);
    present_break_window(app, &style);

    idle::send_native_notification(
        "Time for a 20-second eye rest",
        "Look at something 20 feet away for 20 seconds.",
    );
}

pub fn trigger_break_from_app<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_wry: AppHandle<Wry> = unsafe { std::mem::transmute_copy(app) };
    if let Some(shared) = app_wry.try_state::<SharedAppState>() {
        if let Ok(mut state) = shared.0.lock() {
            start_break_internal(&app_wry, &mut state, true);
        }
    }
}

pub fn toggle_pause_from_app<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_wry: AppHandle<Wry> = unsafe { std::mem::transmute_copy(app) };
    if let Some(shared) = app_wry.try_state::<SharedAppState>() {
        if let Ok(mut state) = shared.0.lock() {
            match state.phase {
                TimerPhase::Working => {
                    state.phase = TimerPhase::Paused;
                }
                TimerPhase::Paused => {
                    state.phase = TimerPhase::Working;
                }
                TimerPhase::Break => {
                    hide_break_window(&app_wry);
                    state.phase = TimerPhase::Paused;
                    state.elapsed_secs = 0;
                    state.total_secs = state.settings.work_duration_secs;
                }
            }
            sync_tray_and_emit(&app_wry, &mut state);
        }
    }
}

pub fn reset_timer_from_app<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_wry: AppHandle<Wry> = unsafe { std::mem::transmute_copy(app) };
    if let Some(shared) = app_wry.try_state::<SharedAppState>() {
        if let Ok(mut state) = shared.0.lock() {
            hide_break_window(&app_wry);
            state.phase = TimerPhase::Working;
            state.elapsed_secs = 0;
            state.total_secs = state.settings.work_duration_secs;
            state.is_idle_paused = false;
            sync_tray_and_emit(&app_wry, &mut state);
        }
    }
}

pub fn toggle_floating_widget_from_app<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_wry: AppHandle<Wry> = unsafe { std::mem::transmute_copy(app) };
    if let Some(shared) = app_wry.try_state::<SharedAppState>() {
        if let Ok(mut state) = shared.0.lock() {
            state.settings.show_floating_widget = !state.settings.show_floating_widget;
            let show = state.settings.show_floating_widget;
            state.save_settings();
            sync_widget_visibility(&app_wry, show);
            sync_tray_and_emit(&app_wry, &mut state);
        }
    }
}

pub fn show_settings_from_app<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn set_eye_style_from_app<R: tauri::Runtime>(app: &AppHandle<R>, style_id: &str) {
    let app_wry: AppHandle<Wry> = unsafe { std::mem::transmute_copy(app) };
    if let Some(shared) = app_wry.try_state::<SharedAppState>() {
        if let Ok(mut state) = shared.0.lock() {
            state.settings.eye_style = style_id.to_string();
            state.last_tray_bucket = -99;
            state.save_settings();
            sync_tray_and_emit(&app_wry, &mut state);
        }
    }
}

pub fn spawn_background_loops(app: AppHandle) {
    // 1. Main 1-second state machine & idle detection loop
    let app_tick = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));

        let mut completed_snapshot: Option<TimerSnapshot> = None;

        if let Some(shared) = app_tick.try_state::<SharedAppState>() {
            if let Ok(mut state) = shared.0.lock() {
                state.ensure_today_stats();

                match state.phase {
                    TimerPhase::Working => {
                        let idle_secs = if state.settings.idle_detection_enabled {
                            idle::get_system_idle_secs()
                        } else {
                            0
                        };

                        if state.settings.idle_detection_enabled
                            && idle_secs >= state.settings.idle_threshold_secs
                        {
                            state.is_idle_paused = true;
                            // Reset timer after a long absence (> 10 minutes idle)
                            if idle_secs >= state.settings.idle_threshold_secs * 2 {
                                state.elapsed_secs = 0;
                            }
                            sync_tray_and_emit(&app_tick, &mut state);
                        } else {
                            state.is_idle_paused = false;
                            state.elapsed_secs = state.elapsed_secs.saturating_add(1);

                            if state.elapsed_secs >= state.total_secs {
                                start_break_internal(&app_tick, &mut state, false);
                            } else {
                                sync_tray_and_emit(&app_tick, &mut state);
                            }
                        }
                    }
                    TimerPhase::Break => {
                        state.elapsed_secs = state.elapsed_secs.saturating_add(1);
                        if state.elapsed_secs >= state.total_secs {
                            state.stats.breaks_completed += 1;
                            state.save_stats();

                            state.phase = TimerPhase::Working;
                            state.elapsed_secs = 0;
                            state.total_secs = state.settings.work_duration_secs;
                            completed_snapshot = Some(state.snapshot());
                            sync_tray_and_emit(&app_tick, &mut state);
                        } else {
                            sync_tray_and_emit(&app_tick, &mut state);
                        }
                    }
                    TimerPhase::Paused => {
                        sync_tray_and_emit(&app_tick, &mut state);
                    }
                }
            }
        }

        if let Some(snap) = completed_snapshot {
            let _ = app_tick.emit("break-completed", &snap);
            let app_hide = app_tick.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1250));
                hide_break_window(&app_hide);
            });
        }
    });

    // 2. Global cursor tracking loop for the floating desktop eyes widget
    let app_cursor = app;
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(90));

        if let Some(shared) = app_cursor.try_state::<SharedAppState>() {
            let should_track = shared
                .0
                .lock()
                .map(|s| s.settings.show_floating_widget && s.phase == TimerPhase::Working)
                .unwrap_or(false);

            if !should_track {
                continue;
            }

            if let (Some((cx, cy)), Some(win)) = (
                idle::get_cursor_screen_pos(),
                app_cursor.get_webview_window("widget"),
            ) {
                if let (Ok(wpos), Ok(wsize)) = (win.outer_position(), win.outer_size()) {
                    let center_x = wpos.x as f32 + wsize.width as f32 * 0.5;
                    let center_y = wpos.y as f32 + wsize.height as f32 * 0.5;
                    let dx = (cx as f32 - center_x) / 480.0;
                    let dy = (cy as f32 - center_y) / 360.0;
                    let dist = (dx * dx + dy * dy).sqrt();
                    let scale = if dist > 1.0 { 1.0 / dist } else { 1.0 };
                    let nx = (dx * scale).clamp(-1.0, 1.0);
                    let ny = (dy * scale).clamp(-1.0, 1.0);

                    if let Ok(mut state) = shared.0.lock() {
                        state.cursor_norm_x = nx;
                        state.cursor_norm_y = ny;
                    }

                    let _ = app_cursor.emit(
                        "cursor-move",
                        serde_json::json!({ "x": nx, "y": ny }),
                    );
                }
            }
        }
    });
}

pub fn position_widget_top_right(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        if let Ok(Some(mon)) = win.primary_monitor() {
            let size = mon.size();
            let scale = mon.scale_factor();
            let logical_w = size.width as f64 / scale;
            let x = (logical_w - 180.0).max(20.0);
            let y = 36.0;
            let _ = win.set_position(LogicalPosition::new(x, y));
        }
    }
}

