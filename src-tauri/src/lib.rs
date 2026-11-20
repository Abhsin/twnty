pub mod idle;
pub mod timer;
pub mod tray;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};

use timer::{
    close_break_window, handle_break_window_closed, load_persisted, lock_state, prepare_sync,
    apply_sync, reset_timer_from_app, sanitize_settings, save_settings_if_latest, save_stats_disk,
    set_eye_style_from_app, show_settings_window, spawn_background_loops, start_break_now_impl,
    sync_widget_window, toggle_pause_from_app, InnerState, SettingsPatch, SharedAppState,
    TimerPhase, TimerSnapshot, TrayUiCache,
};

#[tauri::command]
fn get_timer_snapshot(state: State<'_, SharedAppState>) -> TimerSnapshot {
    let guard = lock_state(&state);
    guard.snapshot()
}

#[tauri::command]
fn start_break_now(app: AppHandle) {
    start_break_now_impl(&app);
}

#[tauri::command]
fn skip_break(app: AppHandle, state: State<'_, SharedAppState>) {
    let result = {
        let mut guard = lock_state(&state);
        if guard.settings.strict_mode {
            None
        } else {
            let stats_save = if guard.phase == TimerPhase::Break {
                guard.stats.breaks_skipped += 1;
                Some((guard.config_dir.clone(), guard.stats.clone()))
            } else {
                None
            };
            let should_close = guard.phase == TimerPhase::Break;
            if should_close {
                guard.break_gen = guard.break_gen.wrapping_add(1);
            }
            guard.reset_to_work();
            let (snap, diff) = prepare_sync(&mut guard);
            Some((snap, diff, stats_save, should_close))
        }
    };

    if let Some((snap, diff, stats_save, should_close)) = result {
        if let Some((cfg, stats)) = stats_save {
            save_stats_disk(&cfg, &stats);
        }
        if should_close {
            close_break_window(&app);
        }
        apply_sync(&app, &snap, diff);
    }
}

#[tauri::command]
fn extend_break(app: AppHandle, state: State<'_, SharedAppState>, extra_secs: u64) {
    let result = {
        let mut guard = lock_state(&state);
        if guard.phase == TimerPhase::Break {
            guard.total_secs = guard.total_secs.saturating_add(extra_secs.min(300));
            Some(prepare_sync(&mut guard))
        } else {
            None
        }
    };

    if let Some((snap, diff)) = result {
        apply_sync(&app, &snap, diff);
    }
}

#[tauri::command]
fn toggle_pause(app: AppHandle) {
    toggle_pause_from_app(&app);
}

#[tauri::command]
fn reset_timer(app: AppHandle) {
    reset_timer_from_app(&app);
}

#[tauri::command]
fn patch_settings(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    patch: SettingsPatch,
) -> TimerSnapshot {
    let mut autostart_update: Option<bool> = None;

    let (snap, diff, widget_sync, cfg, settings, ver) = {
        let mut guard = lock_state(&state);
        let prev_work = guard.settings.work_duration_secs;
        let prev_widget = guard.settings.show_floating_widget;
        let prev_autostart = guard.settings.launch_at_login;

        if let Some(v) = patch.work_duration_secs {
            guard.settings.work_duration_secs = v;
        }
        if let Some(v) = patch.break_duration_secs {
            guard.settings.break_duration_secs = v;
        }
        if let Some(v) = patch.break_style {
            guard.settings.break_style = v;
        }
        if let Some(v) = patch.sound_enabled {
            guard.settings.sound_enabled = v;
        }
        if let Some(v) = patch.strict_mode {
            guard.settings.strict_mode = v;
        }
        if let Some(v) = patch.show_floating_widget {
            guard.settings.show_floating_widget = v;
        }
        if let Some(v) = patch.idle_detection_enabled {
            guard.settings.idle_detection_enabled = v;
        }
        if let Some(v) = patch.idle_threshold_secs {
            guard.settings.idle_threshold_secs = v;
        }
        if let Some(v) = patch.defer_on_fullscreen {
            guard.settings.defer_on_fullscreen = v;
        }
        if let Some(v) = patch.launch_at_login {
            guard.settings.launch_at_login = v;
        }
        if let Some(v) = patch.eye_style {
            guard.settings.eye_style = v;
        }
        if let Some(v) = patch.show_tray_timer {
            guard.settings.show_tray_timer = v;
        }

        sanitize_settings(&mut guard.settings);

        if patch.work_duration_secs.is_some()
            && guard.settings.work_duration_secs != prev_work
            && !guard.is_demo
            && guard.phase == TimerPhase::Working
        {
            guard.total_secs = guard.settings.work_duration_secs;
            if guard.elapsed_secs >= guard.total_secs {
                guard.elapsed_secs = 0;
            }
        }

        if guard.settings.launch_at_login != prev_autostart {
            autostart_update = Some(guard.settings.launch_at_login);
        }

        let widget_sync = if guard.settings.show_floating_widget != prev_widget {
            Some((
                guard.settings.show_floating_widget,
                guard.settings.widget_pos,
            ))
        } else {
            None
        };

        guard.settings_version += 1;
        let cfg = guard.config_dir.clone();
        let settings = guard.settings.clone();
        let ver = guard.settings_version;
        let (snap, diff) = prepare_sync(&mut guard);
        (snap, diff, widget_sync, cfg, settings, ver)
    };

    if let Some(enable) = autostart_update {
        let _ = idle::set_autostart_enabled(enable);
    }
    save_settings_if_latest(&cfg, &settings, ver);
    if let Some((show, pos)) = widget_sync {
        sync_widget_window(&app, show, pos);
    }
    apply_sync(&app, &snap, diff);
    snap
}

#[tauri::command]
fn toggle_demo_mode(app: AppHandle, state: State<'_, SharedAppState>) -> TimerSnapshot {
    let result = {
        let mut guard = lock_state(&state);
        if guard.phase == TimerPhase::Break && guard.settings.strict_mode {
            return guard.snapshot();
        }
        let should_close = guard.phase == TimerPhase::Break;
        if should_close {
            guard.break_gen = guard.break_gen.wrapping_add(1);
        }
        guard.is_demo = !guard.is_demo;
        guard.reset_to_work();
        let (snap, diff) = prepare_sync(&mut guard);
        (snap, diff, should_close)
    };

    if result.2 {
        close_break_window(&app);
    }
    apply_sync(&app, &result.0, result.1);
    result.0
}

#[tauri::command]
fn set_eye_style(app: AppHandle, style_id: String) {
    set_eye_style_from_app(&app, &style_id);
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !idle::acquire_single_instance_lock() {
        return;
    }

    idle::migrate_legacy_autostart();

    let app = tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("twnty"));

            let (mut settings, stats, is_first_run) = load_persisted(&config_dir);
            settings.launch_at_login = idle::is_autostart_enabled();

            let show_widget = settings.show_floating_widget;
            let saved_pos = settings.widget_pos;
            let work_secs = settings.work_duration_secs;

            let tray_handles = tray::create_system_tray(
                app.handle(),
                show_widget,
                &settings.eye_style,
                work_secs,
            )?;
            app.manage(tray_handles);

            let mut inner = InnerState {
                phase: TimerPhase::Working,
                elapsed_secs: 0,
                total_secs: work_secs,
                is_idle_paused: false,
                idle_paused_secs: 0,
                is_demo: false,
                break_gen: 0,
                settings_version: 0,
                fullscreen_snoozed: false,
                dirty_sync: false,
                settings: settings.clone(),
                stats,
                config_dir: config_dir.clone(),
                tray_cache: TrayUiCache::default(),
            };
            let (snap, diff) = prepare_sync(&mut inner);

            app.manage(SharedAppState(Mutex::new(inner)));
            apply_sync(app.handle(), &snap, diff);

            if is_first_run {
                save_settings_if_latest(&config_dir, &settings, 0);
                show_settings_window(app.handle());
            }

            if show_widget {
                sync_widget_window(app.handle(), true, saved_pos);
            }

            spawn_background_loops(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(pos) => {
                if window.label() == "widget" {
                    if let Some(shared) = window.app_handle().try_state::<SharedAppState>() {
                        let mut guard = lock_state(&shared);
                        guard.settings.widget_pos = Some((pos.x, pos.y));
                    }
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "break" {
                    let app = window.app_handle();
                    let strict_active = app
                        .try_state::<SharedAppState>()
                        .map(|shared| {
                            let guard = lock_state(&shared);
                            guard.phase == TimerPhase::Break && guard.settings.strict_mode
                        })
                        .unwrap_or(false);
                    if strict_active {
                        api.prevent_close();
                    } else {
                        handle_break_window_closed(app);
                    }
                }
            }
            WindowEvent::Destroyed => {
                if window.label() == "widget" {
                    if let Some(shared) = window.app_handle().try_state::<SharedAppState>() {
                        let (cfg, settings, ver) = {
                            let mut guard = lock_state(&shared);
                            guard.settings_version += 1;
                            (
                                guard.config_dir.clone(),
                                guard.settings.clone(),
                                guard.settings_version,
                            )
                        };
                        save_settings_if_latest(&cfg, &settings, ver);
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_timer_snapshot,
            start_break_now,
            skip_break,
            extend_break,
            toggle_pause,
            reset_timer,
            patch_settings,
            toggle_demo_mode,
            set_eye_style,
            open_settings_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building twnty application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            // Keep app running in tray when last window closes; exit normally on app.exit(0)
            if code.is_none() {
                api.prevent_exit();
            }
        } else if let RunEvent::Exit = event {
            if let Some(shared) = app_handle.try_state::<SharedAppState>() {
                let (cfg, settings, ver) = {
                    let mut guard = lock_state(&shared);
                    guard.settings_version += 1;
                    (
                        guard.config_dir.clone(),
                        guard.settings.clone(),
                        guard.settings_version,
                    )
                };
                save_settings_if_latest(&cfg, &settings, ver);
            }
        }
    });
}
