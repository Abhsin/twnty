use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::idle::{self, ScreenPoint};
use crate::tray::{render_tray_icon_rgba, TrayHandles};

static SETTINGS_IO_LOCK: Mutex<()> = Mutex::new(());
static SAVED_SETTINGS_VER: AtomicU64 = AtomicU64::new(0);
static STATS_IO_LOCK: Mutex<()> = Mutex::new(());
static WINDOW_OP_LOCK: Mutex<()> = Mutex::new(());

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
    #[serde(default)]
    pub widget_pos: Option<(i32, i32)>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            work_duration_secs: 20 * 60,
            break_duration_secs: 20,
            break_style: "card".to_string(),
            sound_enabled: true,
            strict_mode: false,
            show_floating_widget: false,
            idle_detection_enabled: true,
            idle_threshold_secs: 300,
            defer_on_fullscreen: true,
            launch_at_login: false,
            eye_style: default_eye_style(),
            show_tray_timer: false,
            widget_pos: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SettingsPatch {
    pub work_duration_secs: Option<u64>,
    pub break_duration_secs: Option<u64>,
    pub break_style: Option<String>,
    pub sound_enabled: Option<bool>,
    pub strict_mode: Option<bool>,
    pub show_floating_widget: Option<bool>,
    pub idle_detection_enabled: Option<bool>,
    pub idle_threshold_secs: Option<u64>,
    pub defer_on_fullscreen: Option<bool>,
    pub launch_at_login: Option<bool>,
    pub eye_style: Option<String>,
    pub show_tray_timer: Option<bool>,
}

pub fn sanitize_settings(s: &mut AppSettings) {
    if s.work_duration_secs < 60 {
        s.work_duration_secs = 20 * 60;
    } else {
        s.work_duration_secs = s.work_duration_secs.min(7200);
    }
    s.break_duration_secs = s.break_duration_secs.clamp(5, 600);
    s.idle_threshold_secs = s.idle_threshold_secs.clamp(30, 3600);
    if s.break_style != "overlay" {
        s.break_style = "card".to_string();
    }
    if !matches!(
        s.eye_style.as_str(),
        "classic" | "googly" | "cat" | "anime" | "dot"
    ) {
        s.eye_style = default_eye_style();
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
    pub is_demo: bool,
    pub settings_version: u64,
    pub platform: String,
    pub settings: AppSettings,
    pub stats: DailyStats,
}

pub struct TrayUiCache {
    pub last_bucket: i32,
    pub last_style: String,
    pub last_status: String,
    pub last_pause: String,
    pub last_widget: String,
    pub last_reset: String,
    pub last_title: String,
    pub last_tooltip: String,
}

impl Default for TrayUiCache {
    fn default() -> Self {
        Self {
            last_bucket: i32::MIN,
            last_style: String::new(),
            last_status: String::new(),
            last_pause: String::new(),
            last_widget: String::new(),
            last_reset: String::new(),
            last_title: String::from("\u{0}"),
            last_tooltip: String::new(),
        }
    }
}

#[derive(Default)]
pub struct TrayDiff {
    pub status: Option<String>,
    pub pause: Option<String>,
    pub widget: Option<String>,
    pub reset: Option<String>,
    pub title: Option<String>,
    pub tooltip: Option<String>,
    pub eye_style: Option<String>,
    pub icon: Option<(String, f32, bool, bool)>,
}

pub struct InnerState {
    pub phase: TimerPhase,
    pub elapsed_secs: u64,
    pub total_secs: u64,
    pub is_idle_paused: bool,
    pub idle_paused_secs: u64,
    pub is_demo: bool,
    pub break_gen: u64,
    pub settings_version: u64,
    pub fullscreen_snoozed: bool,
    pub dirty_sync: bool,
    pub settings: AppSettings,
    pub stats: DailyStats,
    pub config_dir: PathBuf,
    pub tray_cache: TrayUiCache,
}

pub struct SharedAppState(pub Mutex<InnerState>);

pub fn lock_state(shared: &SharedAppState) -> MutexGuard<'_, InnerState> {
    shared.0.lock().unwrap_or_else(|e| e.into_inner())
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

impl InnerState {
    pub fn active_work_secs(&self) -> u64 {
        if self.is_demo {
            20
        } else {
            self.settings.work_duration_secs
        }
    }

    pub fn reset_to_work(&mut self) {
        self.phase = TimerPhase::Working;
        self.elapsed_secs = 0;
        self.total_secs = self.active_work_secs();
        self.is_idle_paused = false;
        self.idle_paused_secs = 0;
        self.fullscreen_snoozed = false;
        self.dirty_sync = true;
    }

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
            is_demo: self.is_demo,
            settings_version: self.settings_version,
            platform: current_platform().to_string(),
            settings: self.settings.clone(),
            stats: self.stats.clone(),
        }
    }

    pub fn ensure_today_stats(&mut self) -> Option<DailyStats> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        if self.stats.date != today {
            self.stats = DailyStats {
                date: today,
                breaks_completed: 0,
                breaks_skipped: 0,
            };
            self.dirty_sync = true;
            return Some(self.stats.clone());
        }
        None
    }
}

fn atomic_write_json<T: Serialize>(dir: &Path, filename: &str, data: &T) {
    let _ = fs::create_dir_all(dir);
    let Ok(json) = serde_json::to_string_pretty(data) else {
        return;
    };
    let path = dir.join(filename);
    let tmp = dir.join(format!("{}.tmp", filename));
    if fs::write(&tmp, &json).is_ok() {
        if fs::rename(&tmp, &path).is_err() {
            let _ = fs::write(&path, &json);
            let _ = fs::remove_file(&tmp);
        }
    } else {
        let _ = fs::write(&path, &json);
    }
}

pub fn save_settings_if_latest(config_dir: &Path, settings: &AppSettings, version: u64) {
    let _guard = SETTINGS_IO_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if version < SAVED_SETTINGS_VER.load(Ordering::SeqCst) {
        return;
    }
    atomic_write_json(config_dir, "settings.json", settings);
    SAVED_SETTINGS_VER.store(version, Ordering::SeqCst);
}

pub fn save_stats_disk(config_dir: &Path, stats: &DailyStats) {
    let _guard = STATS_IO_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    atomic_write_json(config_dir, "stats.json", stats);
}

pub fn load_persisted(config_dir: &Path) -> (AppSettings, DailyStats, bool) {
    let settings_path = config_dir.join("settings.json");
    let is_first_run = !settings_path.exists();

    let mut settings = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default();
    sanitize_settings(&mut settings);

    let today = Local::now().format("%Y-%m-%d").to_string();
    let stats = fs::read_to_string(config_dir.join("stats.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<DailyStats>(&s).ok())
        .filter(|st| st.date == today)
        .unwrap_or_default();

    (settings, stats, is_first_run)
}

fn format_mm_ss(secs: u64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    format!("{:02}:{:02}", m, s)
}

pub fn prepare_sync(state: &mut InnerState) -> (TimerSnapshot, TrayDiff) {
    let snap = state.snapshot();
    let mut diff = TrayDiff::default();
    let cache = &mut state.tray_cache;

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
    if cache.last_status != status_label {
        cache.last_status = status_label.clone();
        diff.status = Some(status_label.clone());
    }

    let pause_label = if snap.phase == TimerPhase::Paused {
        "Resume timer"
    } else {
        "Pause timer"
    };
    if cache.last_pause != pause_label {
        cache.last_pause = pause_label.to_string();
        diff.pause = Some(pause_label.to_string());
    }

    let widget_label = if snap.settings.show_floating_widget {
        "Hide Floating Eyes"
    } else {
        "Show Floating Eyes"
    };
    if cache.last_widget != widget_label {
        cache.last_widget = widget_label.to_string();
        diff.widget = Some(widget_label.to_string());
    }

    let reset_label = if snap.is_demo {
        "Reset demo timer".to_string()
    } else {
        format!("Reset {}-min timer", (snap.settings.work_duration_secs / 60).max(1))
    };
    if cache.last_reset != reset_label {
        cache.last_reset = reset_label.clone();
        diff.reset = Some(reset_label);
    }

    if cache.last_style != snap.settings.eye_style {
        cache.last_style = snap.settings.eye_style.clone();
        diff.eye_style = Some(snap.settings.eye_style.clone());
    }

    let bar_title = if snap.settings.show_tray_timer {
        match snap.phase {
            TimerPhase::Break => format!(" {}s", snap.remaining_secs),
            TimerPhase::Paused => " ⏸".to_string(),
            TimerPhase::Working => {
                if snap.is_idle_paused {
                    " ⏸".to_string()
                } else {
                    format!(" {}", format_mm_ss(snap.remaining_secs))
                }
            }
        }
    } else {
        String::new()
    };
    if cache.last_title != bar_title {
        cache.last_title = bar_title.clone();
        diff.title = Some(bar_title);
    }

    let tooltip = format!(
        "twnty — {} · Today: {} rest{}",
        status_label,
        snap.stats.breaks_completed,
        if snap.stats.breaks_completed == 1 { "" } else { "s" }
    );
    if cache.last_tooltip != tooltip {
        cache.last_tooltip = tooltip.clone();
        diff.tooltip = Some(tooltip);
    }

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

    if bucket != cache.last_bucket || diff.eye_style.is_some() {
        cache.last_bucket = bucket;
        diff.icon = Some((
            snap.settings.eye_style.clone(),
            snap.progress,
            snap.phase == TimerPhase::Break,
            snap.phase == TimerPhase::Paused || snap.is_idle_paused,
        ));
    }

    (snap, diff)
}

pub fn emit_to_open_windows<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: &S) {
    for label in ["settings", "widget", "break"] {
        if app.get_webview_window(label).is_some() {
            let _ = app.emit_to(label, event, payload.clone());
        }
    }
}

pub fn apply_sync(app: &AppHandle, snap: &TimerSnapshot, diff: TrayDiff) {
    if let Some(handles) = app.try_state::<TrayHandles>() {
        if let Some(ref s) = diff.status {
            let _ = handles.status_item.set_text(s);
        }
        if let Some(ref p) = diff.pause {
            let _ = handles.pause_item.set_text(p);
        }
        if let Some(ref w) = diff.widget {
            let _ = handles.widget_item.set_text(w);
        }
        if let Some(ref r) = diff.reset {
            let _ = handles.reset_item.set_text(r);
        }
        if let Some(ref style) = diff.eye_style {
            for (style_id, item) in &handles.style_items {
                let _ = item.set_checked(style_id == style);
            }
        }
        if let Some(ref title) = diff.title {
            let _ = handles.tray.set_title(Some(title));
        }
        if let Some(ref tip) = diff.tooltip {
            let _ = handles.tray.set_tooltip(Some(tip));
        }
        if let Some((style, progress, is_break, is_paused)) = diff.icon {
            let icon = render_tray_icon_rgba(&style, progress, is_break, is_paused);
            let _ = handles.tray.set_icon(Some(icon));
        }
    }

    emit_to_open_windows(app, "timer-tick", snap);
}

pub fn show_settings_window(app: &AppHandle) {
    let _win_lock = WINDOW_OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    if let Ok(win) = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("twnty")
        .inner_size(480.0, 800.0)
        .min_inner_size(420.0, 560.0)
        .resizable(true)
        .center()
        .build()
    {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn find_monitor_for_point(
    monitors: &[tauri::Monitor],
    point: ScreenPoint,
) -> Option<&tauri::Monitor> {
    match point {
        ScreenPoint::Physical(cx, cy) => monitors.iter().find(|m| {
            let pos = m.position();
            let size = m.size();
            cx >= pos.x
                && cx < pos.x + size.width as i32
                && cy >= pos.y
                && cy < pos.y + size.height as i32
        }),
        ScreenPoint::Logical(cx, cy) => monitors.iter().find(|m| {
            let scale = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            let lx = pos.x as f64 / scale;
            let ly = pos.y as f64 / scale;
            let lw = size.width as f64 / scale;
            let lh = size.height as f64 / scale;
            cx >= lx && cx < lx + lw && cy >= ly && cy < ly + lh
        }),
    }
}

pub fn sync_widget_window(app: &AppHandle, show: bool, saved_pos: Option<(i32, i32)>) {
    let _win_lock = WINDOW_OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !show {
        if let Some(win) = app.get_webview_window("widget") {
            let _ = win.destroy();
        }
        return;
    }

    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.show();
        return;
    }

    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let primary_scale = primary.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);

    let saved_match = saved_pos.and_then(|(sx, sy)| {
        monitors
            .iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                sx >= pos.x - 100
                    && sx < pos.x + size.width as i32 - 40
                    && sy >= pos.y - 40
                    && sy < pos.y + size.height as i32 - 40
            })
            .map(|m| (sx, sy, m.scale_factor()))
    });

    let (target_x, target_y, mon_scale) = if let Some((sx, sy, scale)) = saved_match {
        (sx, sy, scale)
    } else if let Some(ref mon) = primary.as_ref().or_else(|| monitors.first()) {
        let pos = mon.position();
        let size = mon.size();
        let scale = mon.scale_factor();
        let widget_w = (196.0 * scale) as i32;
        let margin = (20.0 * scale) as i32;
        let top = (36.0 * scale) as i32;
        let x = pos.x + (size.width as i32 - widget_w - margin).max(margin);
        let y = pos.y + top;
        (x, y, scale)
    } else {
        (100, 100, primary_scale)
    };

    let target_w = (196.0 * mon_scale) as u32;
    let target_h = (136.0 * mon_scale) as u32;

    if let Ok(win) = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("widget.html".into()))
        .title("twnty Eyes")
        .position(target_x as f64 / primary_scale, target_y as f64 / primary_scale)
        .inner_size(196.0, 136.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
    {
        #[cfg(target_os = "macos")]
        let _ = win.set_visible_on_all_workspaces(true);

        let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
        let _ = win.set_size(PhysicalSize::new(target_w, target_h));
        let _ = win.show();
    }
}

pub fn present_break_window(app: &AppHandle, break_style: &str) {
    let _win_lock = WINDOW_OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let primary_scale = primary.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let cursor = idle::get_cursor_screen_pos();
    let active_mon = cursor
        .and_then(|pt| find_monitor_for_point(&monitors, pt).cloned())
        .or_else(|| primary.clone())
        .or_else(|| monitors.first().cloned());

    let (target_x, target_y, target_w, target_h, init_w, init_h) = if break_style == "overlay" {
        if let Some(ref mon) = active_mon {
            let pos = mon.position();
            let size = mon.size();
            let scale = mon.scale_factor();
            (
                pos.x,
                pos.y,
                size.width,
                size.height,
                size.width as f64 / scale,
                size.height as f64 / scale,
            )
        } else {
            (0, 0, 1280, 800, 1280.0, 800.0)
        }
    } else if let Some(ref mon) = active_mon {
        let scale = mon.scale_factor();
        let w = (440.0 * scale) as u32;
        let h = (420.0 * scale) as u32;
        let pos = mon.position();
        let size = mon.size();
        let x = pos.x + (size.width as i32 - w as i32) / 2;
        let y = pos.y + (size.height as i32 - h as i32) / 2;
        (x, y, w, h, 440.0, 420.0)
    } else {
        (200, 200, 440, 420, 440.0, 420.0)
    };

    let win = if let Some(existing) = app.get_webview_window("break") {
        existing
    } else if let Ok(created) =
        WebviewWindowBuilder::new(app, "break", WebviewUrl::App("break.html".into()))
            .title("20-20-20 Break")
            .position(target_x as f64 / primary_scale, target_y as f64 / primary_scale)
            .inner_size(init_w, init_h)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
    {
        #[cfg(target_os = "macos")]
        let _ = created.set_visible_on_all_workspaces(true);
        created
    } else {
        return;
    };

    let _ = win.set_resizable(true);
    let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
    let _ = win.set_size(PhysicalSize::new(target_w, target_h));
    let _ = win.show();
    let _ = win.set_focus();

    std::thread::sleep(Duration::from_millis(40));
    let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
    let _ = win.set_size(PhysicalSize::new(target_w, target_h));
    let _ = win.set_resizable(false);
}

pub fn close_break_window(app: &AppHandle) {
    let _win_lock = WINDOW_OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(win) = app.get_webview_window("break") {
        let _ = win.destroy();
    }
}

pub fn start_break_now_impl(app: &AppHandle) {
    let (snap, diff, break_style, break_dur) = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        guard.ensure_today_stats();
        guard.break_gen = guard.break_gen.wrapping_add(1);
        guard.phase = TimerPhase::Break;
        guard.elapsed_secs = 0;
        guard.total_secs = guard.settings.break_duration_secs;
        guard.is_idle_paused = false;
        guard.idle_paused_secs = 0;
        guard.fullscreen_snoozed = false;
        let style = guard.settings.break_style.clone();
        let dur = guard.settings.break_duration_secs;
        let (snap, diff) = prepare_sync(&mut guard);
        (snap, diff, style, dur)
    };

    apply_sync(app, &snap, diff);
    present_break_window(app, &break_style);
    idle::send_native_notification(
        "Time for an eye rest",
        &format!("Look at something 20 feet away for {} seconds.", break_dur),
    );
}

pub fn handle_break_window_closed(app: &AppHandle) {
    let sync_and_stats = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        if guard.phase == TimerPhase::Break && !guard.settings.strict_mode {
            guard.stats.breaks_skipped += 1;
            let stats = guard.stats.clone();
            let cfg = guard.config_dir.clone();
            guard.reset_to_work();
            let (snap, diff) = prepare_sync(&mut guard);
            Some((snap, diff, cfg, stats))
        } else {
            None
        }
    };

    if let Some((snap, diff, cfg, stats)) = sync_and_stats {
        save_stats_disk(&cfg, &stats);
        apply_sync(app, &snap, diff);
    }
}

pub fn trigger_break_from_app(app: &AppHandle) {
    start_break_now_impl(app);
}

pub fn toggle_pause_from_app(app: &AppHandle) {
    let result = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        if guard.phase == TimerPhase::Break && guard.settings.strict_mode {
            None
        } else {
            let mut should_close_break = false;
            match guard.phase {
                TimerPhase::Working => {
                    if guard.is_idle_paused {
                        guard.is_idle_paused = false;
                        guard.idle_paused_secs = 0;
                    } else {
                        guard.phase = TimerPhase::Paused;
                    }
                }
                TimerPhase::Paused => {
                    guard.phase = TimerPhase::Working;
                    guard.is_idle_paused = false;
                    guard.idle_paused_secs = 0;
                }
                TimerPhase::Break => {
                    should_close_break = true;
                    guard.break_gen = guard.break_gen.wrapping_add(1);
                    guard.phase = TimerPhase::Paused;
                    guard.elapsed_secs = 0;
                    guard.total_secs = guard.active_work_secs();
                }
            }
            let (snap, diff) = prepare_sync(&mut guard);
            Some((snap, diff, should_close_break))
        }
    };

    if let Some((snap, diff, should_close_break)) = result {
        if should_close_break {
            close_break_window(app);
        }
        apply_sync(app, &snap, diff);
    }
}

pub fn reset_timer_from_app(app: &AppHandle) {
    let result = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        if guard.phase == TimerPhase::Break && guard.settings.strict_mode {
            None
        } else {
            let should_close_break = guard.phase == TimerPhase::Break;
            if should_close_break {
                guard.break_gen = guard.break_gen.wrapping_add(1);
            }
            guard.reset_to_work();
            let (snap, diff) = prepare_sync(&mut guard);
            Some((snap, diff, should_close_break))
        }
    };

    if let Some((snap, diff, should_close_break)) = result {
        if should_close_break {
            close_break_window(app);
        }
        apply_sync(app, &snap, diff);
    }
}

pub fn toggle_floating_widget_from_app(app: &AppHandle) {
    let (snap, diff, show, saved_pos, cfg, settings, ver) = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        guard.settings.show_floating_widget = !guard.settings.show_floating_widget;
        guard.settings_version += 1;
        let show = guard.settings.show_floating_widget;
        let saved_pos = guard.settings.widget_pos;
        let cfg = guard.config_dir.clone();
        let settings = guard.settings.clone();
        let ver = guard.settings_version;
        let (snap, diff) = prepare_sync(&mut guard);
        (snap, diff, show, saved_pos, cfg, settings, ver)
    };

    save_settings_if_latest(&cfg, &settings, ver);
    sync_widget_window(app, show, saved_pos);
    apply_sync(app, &snap, diff);
}

pub fn set_eye_style_from_app(app: &AppHandle, style_id: &str) {
    let (snap, diff, cfg, settings, ver) = {
        let shared = app.state::<SharedAppState>();
        let mut guard = lock_state(&shared);
        guard.settings.eye_style = style_id.to_string();
        sanitize_settings(&mut guard.settings);
        guard.settings_version += 1;
        let cfg = guard.config_dir.clone();
        let settings = guard.settings.clone();
        let ver = guard.settings_version;
        let (snap, diff) = prepare_sync(&mut guard);
        (snap, diff, cfg, settings, ver)
    };

    save_settings_if_latest(&cfg, &settings, ver);
    apply_sync(app, &snap, diff);
}

pub fn spawn_background_loops(app: AppHandle) {
    // 1. Main 1-second state machine, sleep/wake, lock, and idle detection loop
    let app_tick = app.clone();
    std::thread::spawn(move || {
        let mut last_wall = SystemTime::now();
        let mut last_mono = Instant::now();
        let mut next_tick = Instant::now() + Duration::from_secs(1);

        loop {
            let now = Instant::now();
            if next_tick > now {
                std::thread::sleep(next_tick - now);
            }
            next_tick += Duration::from_secs(1);
            let after_sleep = Instant::now();
            if after_sleep > next_tick + Duration::from_secs(2) {
                next_tick = after_sleep + Duration::from_secs(1);
            }

            let wall_now = SystemTime::now();
            let wall_delta = wall_now.duration_since(last_wall).unwrap_or_default().as_secs();
            let mono_delta = after_sleep.duration_since(last_mono).as_secs();
            last_wall = wall_now;
            last_mono = after_sleep;

            // Read OS idle & screen lock status BEFORE acquiring SharedAppState
            let idle_secs = idle::get_system_idle_secs();
            let locked = idle::is_screen_locked();

            let mut stats_to_save: Option<(PathBuf, DailyStats)> = None;
            let mut sync_payload: Option<(TimerSnapshot, TrayDiff)> = None;
            let mut check_fullscreen = false;
            let mut should_close_break = false;
            let mut direct_break: Option<(String, u64)> = None;
            let mut completed_info: Option<(TimerSnapshot, u64)> = None;

            if let Some(shared) = app_tick.try_state::<SharedAppState>() {
                {
                    let mut guard = lock_state(&shared);
                    if let Some(st) = guard.ensure_today_stats() {
                        stats_to_save = Some((guard.config_dir.clone(), st));
                    }

                    // Detect system sleep / suspend
                    if wall_delta > mono_delta.saturating_add(5)
                        && wall_delta >= guard.settings.idle_threshold_secs
                    {
                        if guard.phase == TimerPhase::Break {
                            guard.break_gen = guard.break_gen.wrapping_add(1);
                            should_close_break = true;
                        }
                        if guard.phase != TimerPhase::Paused {
                            guard.reset_to_work();
                            sync_payload = Some(prepare_sync(&mut guard));
                        }
                    } else {
                        match guard.phase {
                            TimerPhase::Working => {
                                if guard.settings.idle_detection_enabled
                                    && (locked || idle_secs >= guard.settings.idle_threshold_secs)
                                {
                                    guard.idle_paused_secs =
                                        guard.idle_paused_secs.saturating_add(mono_delta.max(1));
                                    let was_idle = guard.is_idle_paused;
                                    let prev_elapsed = guard.elapsed_secs;
                                    guard.is_idle_paused = true;
                                    if idle_secs >= guard.settings.idle_threshold_secs * 2
                                        || (locked
                                            && guard.idle_paused_secs
                                                >= guard.settings.idle_threshold_secs)
                                    {
                                        guard.elapsed_secs = 0;
                                        guard.fullscreen_snoozed = false;
                                    }
                                    if !was_idle || prev_elapsed != guard.elapsed_secs {
                                        sync_payload = Some(prepare_sync(&mut guard));
                                    }
                                } else {
                                    guard.is_idle_paused = false;
                                    guard.idle_paused_secs = 0;
                                    guard.elapsed_secs = guard.elapsed_secs.saturating_add(1);

                                    if guard.elapsed_secs >= guard.total_secs {
                                        if guard.settings.defer_on_fullscreen {
                                            check_fullscreen = true;
                                        } else {
                                            guard.break_gen = guard.break_gen.wrapping_add(1);
                                            guard.phase = TimerPhase::Break;
                                            guard.elapsed_secs = 0;
                                            guard.total_secs = guard.settings.break_duration_secs;
                                            guard.fullscreen_snoozed = false;
                                            direct_break = Some((
                                                guard.settings.break_style.clone(),
                                                guard.settings.break_duration_secs,
                                            ));
                                            sync_payload = Some(prepare_sync(&mut guard));
                                        }
                                    } else {
                                        sync_payload = Some(prepare_sync(&mut guard));
                                    }
                                }
                            }
                            TimerPhase::Break => {
                                guard.elapsed_secs = guard.elapsed_secs.saturating_add(1);
                                if guard.elapsed_secs >= guard.total_secs {
                                    guard.stats.breaks_completed += 1;
                                    stats_to_save =
                                        Some((guard.config_dir.clone(), guard.stats.clone()));
                                    guard.reset_to_work();
                                    let gen = guard.break_gen;
                                    let snap_diff = prepare_sync(&mut guard);
                                    completed_info = Some((snap_diff.0.clone(), gen));
                                    sync_payload = Some(snap_diff);
                                } else {
                                    sync_payload = Some(prepare_sync(&mut guard));
                                }
                            }
                            TimerPhase::Paused => {
                                if guard.dirty_sync {
                                    guard.dirty_sync = false;
                                    sync_payload = Some(prepare_sync(&mut guard));
                                }
                            }
                        }
                    }
                }

                // Check fullscreen outside SharedAppState lock if work timer just reached 0
                if check_fullscreen {
                    let is_fs = idle::is_foreground_fullscreen();
                    let mut notify_fs: Option<u64> = None;
                    {
                        let mut guard = lock_state(&shared);
                        if guard.phase == TimerPhase::Working
                            && guard.elapsed_secs >= guard.total_secs
                        {
                            if is_fs {
                                let snooze = if guard.total_secs <= 120 {
                                    (guard.total_secs / 2).max(5)
                                } else {
                                    120
                                };
                                guard.elapsed_secs = guard.total_secs.saturating_sub(snooze);
                                if !guard.fullscreen_snoozed {
                                    guard.fullscreen_snoozed = true;
                                    notify_fs = Some(guard.settings.break_duration_secs);
                                }
                                sync_payload = Some(prepare_sync(&mut guard));
                            } else {
                                guard.break_gen = guard.break_gen.wrapping_add(1);
                                guard.phase = TimerPhase::Break;
                                guard.elapsed_secs = 0;
                                guard.total_secs = guard.settings.break_duration_secs;
                                guard.fullscreen_snoozed = false;
                                direct_break = Some((
                                    guard.settings.break_style.clone(),
                                    guard.settings.break_duration_secs,
                                ));
                                sync_payload = Some(prepare_sync(&mut guard));
                            }
                        }
                    }

                    if let Some(break_dur) = notify_fs {
                        idle::send_native_notification(
                            "20-20-20 Eye Break (Quiet Mode)",
                            &format!(
                                "Look 20 feet away for {} seconds when you have a moment.",
                                break_dur
                            ),
                        );
                    }
                }
            }

            if let Some((cfg, st)) = stats_to_save {
                save_stats_disk(&cfg, &st);
            }
            if should_close_break {
                close_break_window(&app_tick);
            }
            if let Some((snap, diff)) = sync_payload {
                apply_sync(&app_tick, &snap, diff);
            }
            if let Some((break_style, break_dur)) = direct_break {
                present_break_window(&app_tick, &break_style);
                idle::send_native_notification(
                    "Time for an eye rest",
                    &format!("Look at something 20 feet away for {} seconds.", break_dur),
                );
            }
            if let Some((comp_snap, expected_gen)) = completed_info {
                emit_to_open_windows(&app_tick, "break-completed", &comp_snap);
                let app_hide = app_tick.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1250));
                    let should_close = app_hide
                        .try_state::<SharedAppState>()
                        .map(|shared| {
                            let guard = lock_state(&shared);
                            guard.phase != TimerPhase::Break && guard.break_gen == expected_gen
                        })
                        .unwrap_or(false);
                    if should_close {
                        close_break_window(&app_hide);
                    }
                });
            }
        }
    });

    // 2. Global cursor tracking loop (only active when widget window exists and user is working)
    let app_cursor = app;
    std::thread::spawn(move || {
        let mut last_cursor: Option<(i32, i32)> = None;

        loop {
            let should_track = app_cursor
                .try_state::<SharedAppState>()
                .map(|shared| {
                    let guard = lock_state(&shared);
                    guard.settings.show_floating_widget
                        && guard.phase == TimerPhase::Working
                        && !guard.is_idle_paused
                })
                .unwrap_or(false);

            if !should_track {
                last_cursor = None;
                std::thread::sleep(Duration::from_millis(400));
                continue;
            }

            std::thread::sleep(Duration::from_millis(90));

            if let (Some(pt), Some(win)) = (
                idle::get_cursor_screen_pos(),
                app_cursor.get_webview_window("widget"),
            ) {
                if let (Ok(wpos), Ok(wsize)) = (win.outer_position(), win.outer_size()) {
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let (cx, cy, center_x, center_y, key) = match pt {
                        ScreenPoint::Physical(x, y) => (
                            x as f32,
                            y as f32,
                            wpos.x as f32 + wsize.width as f32 * 0.5,
                            wpos.y as f32 + wsize.height as f32 * 0.5,
                            (x, y),
                        ),
                        ScreenPoint::Logical(x, y) => {
                            let lx = wpos.x as f64 / scale;
                            let ly = wpos.y as f64 / scale;
                            let lw = wsize.width as f64 / scale;
                            let lh = wsize.height as f64 / scale;
                            (
                                x as f32,
                                y as f32,
                                (lx + lw * 0.5) as f32,
                                (ly + lh * 0.5) as f32,
                                (x.round() as i32, y.round() as i32),
                            )
                        }
                    };

                    if last_cursor == Some(key) {
                        continue;
                    }
                    last_cursor = Some(key);

                    let (div_x, div_y) = match pt {
                        ScreenPoint::Physical(_, _) => (480.0 * scale as f32, 360.0 * scale as f32),
                        ScreenPoint::Logical(_, _) => (480.0, 360.0),
                    };
                    let dx = (cx - center_x) / div_x;
                    let dy = (cy - center_y) / div_y;
                    let dist = (dx * dx + dy * dy).sqrt();
                    let s = if dist > 1.0 { 1.0 / dist } else { 1.0 };
                    let nx = (dx * s).clamp(-1.0, 1.0);
                    let ny = (dy * s).clamp(-1.0, 1.0);

                    let _ = app_cursor.emit_to(
                        "widget",
                        "cursor-move",
                        serde_json::json!({ "x": nx, "y": ny }),
                    );
                }
            }
        }
    });
}
