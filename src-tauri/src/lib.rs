pub mod idle;
pub mod timer;
pub mod tray;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WindowEvent};

use timer::{
    hide_break_window, load_persisted, position_widget_top_right, show_settings_from_app,
    spawn_background_loops, start_break_internal, sync_tray_and_emit, sync_widget_visibility,
    AppSettings, InnerState, SharedAppState, TimerPhase, TimerSnapshot,
};

#[tauri::command]
fn get_timer_snapshot(state: State<'_, SharedAppState>) -> TimerSnapshot {
    let guard = state.0.lock().unwrap();
    guard.snapshot()
}

#[tauri::command]
fn start_break_now(app: AppHandle, state: State<'_, SharedAppState>) {
    let mut guard = state.0.lock().unwrap();
    start_break_internal(&app, &mut guard, true);
}

#[tauri::command]
fn skip_break(app: AppHandle, state: State<'_, SharedAppState>) {
    let mut guard = state.0.lock().unwrap();
    if guard.settings.strict_mode {
        return;
    }
    if guard.phase == TimerPhase::Break {
        guard.stats.breaks_skipped += 1;
        guard.save_stats();
    }
    hide_break_window(&app);
    guard.phase = TimerPhase::Working;
    guard.elapsed_secs = 0;
    guard.total_secs = guard.settings.work_duration_secs;
    sync_tray_and_emit(&app, &mut guard);
}

#[tauri::command]
fn extend_break(app: AppHandle, state: State<'_, SharedAppState>, extra_secs: u64) {
    let mut guard = state.0.lock().unwrap();
    if guard.phase == TimerPhase::Break {
        guard.total_secs = guard.total_secs.saturating_add(extra_secs);
        sync_tray_and_emit(&app, &mut guard);
    }
}

#[tauri::command]
fn toggle_pause(app: AppHandle, state: State<'_, SharedAppState>) {
    let mut guard = state.0.lock().unwrap();
    match guard.phase {
        TimerPhase::Working => guard.phase = TimerPhase::Paused,
        TimerPhase::Paused => guard.phase = TimerPhase::Working,
        TimerPhase::Break => {
            hide_break_window(&app);
            guard.phase = TimerPhase::Paused;
            guard.elapsed_secs = 0;
            guard.total_secs = guard.settings.work_duration_secs;
        }
    }
    sync_tray_and_emit(&app, &mut guard);
}

#[tauri::command]
fn reset_timer(app: AppHandle, state: State<'_, SharedAppState>) {
    let mut guard = state.0.lock().unwrap();
    hide_break_window(&app);
    guard.phase = TimerPhase::Working;
    guard.elapsed_secs = 0;
    guard.total_secs = guard.settings.work_duration_secs;
    guard.is_idle_paused = false;
    sync_tray_and_emit(&app, &mut guard);
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<'_, SharedAppState>, new_settings: AppSettings) {
    let mut guard = state.0.lock().unwrap();
    let work_changed = guard.settings.work_duration_secs != new_settings.work_duration_secs;
    let widget_changed = guard.settings.show_floating_widget != new_settings.show_floating_widget;
    let style_changed = guard.settings.eye_style != new_settings.eye_style;

    guard.settings = new_settings;
    guard.save_settings();

    if style_changed {
        guard.last_tray_bucket = -99;
    }

    if work_changed && guard.phase == TimerPhase::Working {
        guard.total_secs = guard.settings.work_duration_secs;
        if guard.elapsed_secs >= guard.total_secs {
            guard.elapsed_secs = 0;
        }
    }

    if widget_changed {
        sync_widget_visibility(&app, guard.settings.show_floating_widget);
    }

    let _ = idle::set_autostart_enabled(guard.settings.launch_at_login);

    sync_tray_and_emit(&app, &mut guard);
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_from_app(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                for label in ["widget", "break"] {
                    if let Some(win) = app.get_webview_window(label) {
                        let _ = win.set_visible_on_all_workspaces(true);
                    }
                }
            }

            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("twnty"));

            let (settings, stats) = load_persisted(&config_dir);
            let show_widget = settings.show_floating_widget;
            let work_secs = settings.work_duration_secs;
            if settings.launch_at_login {
                let _ = idle::set_autostart_enabled(true);
            }

            let tray_handles =
                tray::create_system_tray(app.handle(), show_widget, &settings.eye_style)?;

            let inner = InnerState {
                phase: TimerPhase::Working,
                elapsed_secs: 0,
                total_secs: work_secs,
                is_idle_paused: false,
                last_tray_bucket: 0,
                cursor_norm_x: 0.0,
                cursor_norm_y: 0.0,
                settings,
                stats,
                config_dir,
                tray_handles: Some(tray_handles),
            };

            app.manage(SharedAppState(Mutex::new(inner)));

            position_widget_top_right(app.handle());
            if show_widget {
                sync_widget_visibility(app.handle(), true);
            }

            spawn_background_loops(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep app running in system tray when Settings or Break window is closed
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_timer_snapshot,
            start_break_now,
            skip_break,
            extend_break,
            toggle_pause,
            reset_timer,
            update_settings,
            open_settings_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running twnty application");
}

