use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Runtime,
};

use crate::timer;

pub struct TrayHandles<R: Runtime> {
    pub tray: TrayIcon<R>,
    pub status_item: MenuItem<R>,
    pub pause_item: MenuItem<R>,
    pub widget_item: MenuItem<R>,
    pub style_items: Vec<(String, CheckMenuItem<R>)>,
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

/// Renders a crisp high-DPI RGBA tray/status-bar icon for the chosen eye style and redness stage.
/// On macOS, uses a 60x44 (@2x Retina 30x22pt) wide canvas tailored for NSStatusBar;
/// on Windows/Linux, uses a 48x48 square canvas.
/// Includes a subtle white sticker halo so the eyes remain legible on both dark and light menu bars.
pub fn render_tray_icon_rgba(
    style: &str,
    progress: f32,
    is_break: bool,
    is_paused: bool,
) -> Image<'static> {
    let (width, height): (u32, u32) = if cfg!(target_os = "macos") {
        (60, 44)
    } else {
        (48, 48)
    };
    let mut buf = vec![0u8; (width * height * 4) as usize];

    let cx_left = width as f32 * 0.295;
    let cx_right = width as f32 * 0.705;
    let cy = height as f32 * 0.50;
    let rx = width as f32 * 0.195;
    let ry = if style == "cat" {
        height as f32 * 0.30
    } else if style == "googly" {
        rx * 1.02
    } else {
        height as f32 * 0.38
    };

    let p = if is_break { 0.0 } else { progress.clamp(0.0, 1.0) };

    let (sclera_r, sclera_g, sclera_b) = if style == "cat" {
        (
            lerp(196.0, 244.0, p.powf(1.15)),
            lerp(222.0, 146.0, p.powf(1.15)),
            lerp(112.0, 98.0, p.powf(1.15)),
        )
    } else {
        (
            255.0,
            lerp(255.0, 165.0, p.powf(1.15)),
            lerp(255.0, 165.0, p.powf(1.15)),
        )
    };

    let lid_drop = if is_break {
        1.15
    } else if is_paused {
        0.55
    } else if p > 0.38 {
        ((p - 0.38) / 0.62) * 0.46
    } else {
        0.0
    };

    for y in 0..height {
        for x in 0..width {
            let mut r = 0u8;
            let mut g = 0u8;
            let mut b = 0u8;
            let mut a = 0u8;

            for cx in [cx_left, cx_right] {
                if style == "dot" {
                    let dot_rx = width as f32 * 0.115;
                    let dot_ry = height as f32 * 0.23 * (1.0 - lid_drop * 0.55).max(0.2);
                    let nx = (x as f32 + 0.5 - cx) / dot_rx;
                    let ny = (y as f32 + 0.5 - (cy - 1.5)) / dot_ry;
                    let dist = (nx * nx + ny * ny).sqrt();
                    if dist <= 1.24 {
                        if dist > 0.86 {
                            // White sticker halo for dark macOS menu bars
                            let halo_a = ((1.24 - dist) / 0.38).clamp(0.0, 1.0);
                            r = 255;
                            g = 255;
                            b = 255;
                            a = (halo_a * 245.0) as u8;
                        } else {
                            let hl = ((nx + 0.28).powi(2) + (ny + 0.32).powi(2)).sqrt();
                            if hl < 0.32 && !is_break {
                                r = 255;
                                g = 255;
                                b = 255;
                            } else {
                                r = 28;
                                g = 28;
                                b = 26;
                            }
                            a = 255;
                        }
                    }
                    let bx = (x as f32 + 0.5 - cx) / (width as f32 * 0.13);
                    let by = (y as f32 + 0.5 - (cy + height as f32 * 0.22)) / 3.2;
                    let bdist = (bx * bx + by * by).sqrt();
                    if bdist <= 1.0 && p > 0.15 {
                        let ba = ((p - 0.15) / 0.85 * (1.0 - bdist)).clamp(0.0, 1.0);
                        r = 229;
                        g = 72;
                        b = 77;
                        a = (ba * 235.0) as u8;
                    }
                    continue;
                }

                let nx = (x as f32 + 0.5 - cx) / rx;
                let ny = (y as f32 + 0.5 - cy) / ry;
                let dist = (nx * nx + ny * ny).sqrt();

                if dist <= 1.18 {
                    if dist > 0.98 {
                        // Outer white sticker halo so dark eye rim pops on dark macOS status bar
                        let halo_alpha = ((1.18 - dist) / 0.20).clamp(0.0, 1.0);
                        if halo_alpha * 235.0 > a as f32 {
                            r = 255;
                            g = 255;
                            b = 255;
                            a = (halo_alpha * 235.0) as u8;
                        }
                    } else if dist > 0.82 {
                        // Crisp dark ink outline (#1c1c1a)
                        r = 28;
                        g = 28;
                        b = 26;
                        a = 255;
                    } else {
                        let lid_line = -0.82 + lid_drop * 1.4;
                        if ny < lid_line {
                            r = 28;
                            g = 28;
                            b = 26;
                            a = 255;
                        } else {
                            let mut sr = sclera_r;
                            let mut sg = sclera_g;
                            let mut sb = sclera_b;

                            if style != "cat" && p > 0.15 && dist > 0.48 {
                                let vein_strength = ((p - 0.15) / 0.85)
                                    * ((dist - 0.48) / 0.34)
                                    * (0.55 + 0.45 * (nx * 9.0 + ny * 7.0).sin().abs());
                                sr = lerp(sr, 229.0, vein_strength);
                                sg = lerp(sg, 72.0, vein_strength);
                                sb = lerp(sb, 77.0, vein_strength);
                            }

                            r = sr as u8;
                            g = sg as u8;
                            b = sb as u8;

                            if style == "cat" {
                                let slit_rx = 0.16 + p * 0.22;
                                let sdist = ((nx / slit_rx).powi(2) + (ny / 0.72).powi(2)).sqrt();
                                if sdist < 1.0 {
                                    r = 28;
                                    g = 28;
                                    b = 26;
                                }
                            } else {
                                let py_off = if style == "googly" { 0.22 } else { lid_drop * 0.15 };
                                let p_radius = if style == "anime" {
                                    0.60
                                } else if style == "googly" {
                                    0.54
                                } else {
                                    0.46
                                };
                                let p_dist =
                                    ((nx * 1.05).powi(2) + ((ny - py_off) * 1.2).powi(2)).sqrt();
                                if p_dist < p_radius {
                                    r = 28;
                                    g = 28;
                                    b = 26;
                                    if style != "googly" {
                                        let hl_dist =
                                            ((nx + 0.14).powi(2) + (ny + 0.16).powi(2)).sqrt();
                                        let hl_r = if style == "anime" { 0.20 } else { 0.13 };
                                        if hl_dist < hl_r {
                                            r = 255;
                                            g = 255;
                                            b = 255;
                                        }
                                    }
                                }
                            }
                            a = 255;
                        }
                    }
                }
            }

            let idx = ((y * width + x) * 4) as usize;
            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = a;
        }
    }

    Image::new_owned(buf, width, height)
}

pub fn create_system_tray<R: Runtime>(
    app: &AppHandle<R>,
    show_widget_initially: bool,
    initial_style: &str,
) -> tauri::Result<TrayHandles<R>> {
    let status_item = MenuItem::with_id(
        app,
        "status",
        "Next break in 20:00",
        false,
        None::<&str>,
    )?;
    let break_now_item = MenuItem::with_id(
        app,
        "break_now",
        "Take a break now",
        true,
        None::<&str>,
    )?;
    let pause_item = MenuItem::with_id(app, "pause", "Pause timer", true, None::<&str>)?;
    let reset_item = MenuItem::with_id(app, "reset", "Reset 20-min timer", true, None::<&str>)?;
    let widget_label = if show_widget_initially {
        "Hide Floating Eyes"
    } else {
        "Show Floating Eyes"
    };
    let widget_item = MenuItem::with_id(app, "toggle_widget", widget_label, true, None::<&str>)?;

    // Eye Style Submenu in the status bar / tray menu
    let styles = [
        ("classic", "Classic"),
        ("googly", "Googly"),
        ("cat", "Cat"),
        ("anime", "Sparkle"),
        ("dot", "Dot"),
    ];
    let mut style_items = Vec::new();
    let style_submenu = Submenu::with_id(app, "eye_styles", "Eye Style", true)?;
    for (id, label) in styles {
        let item = CheckMenuItem::with_id(
            app,
            format!("style_{}", id),
            label,
            true,
            initial_style == id,
            None::<&str>,
        )?;
        style_submenu.append(&item)?;
        style_items.push((id.to_string(), item));
    }

    let settings_item = MenuItem::with_id(app, "settings", "Settings & Stats...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit twnty", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &break_now_item,
            &pause_item,
            &reset_item,
            &sep2,
            &widget_item,
            &style_submenu,
            &settings_item,
            &sep3,
            &quit_item,
        ],
    )?;

    let initial_icon = render_tray_icon_rgba(initial_style, 0.0, false, false);

    // On macOS, clicking a status bar item opens its menu natively;
    // on Windows, left-clicking opens Settings directly while right-clicking opens the menu.
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(initial_icon)
        .icon_as_template(false)
        .tooltip("twnty — 20:00 until next eye break")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(style_id) = id.strip_prefix("style_") {
                timer::set_eye_style_from_app(app, style_id);
                return;
            }
            match id {
                "break_now" => {
                    timer::trigger_break_from_app(app);
                }
                "pause" => {
                    timer::toggle_pause_from_app(app);
                }
                "reset" => {
                    timer::reset_timer_from_app(app);
                }
                "toggle_widget" => {
                    timer::toggle_floating_widget_from_app(app);
                }
                "settings" => {
                    timer::show_settings_from_app(app);
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            #[cfg(not(target_os = "macos"))]
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                timer::show_settings_from_app(tray.app_handle());
            }
            #[cfg(target_os = "macos")]
            let _ = (tray, event);
        })
        .build(app)?;

    Ok(TrayHandles {
        tray,
        status_item,
        pause_item,
        widget_item,
        style_items,
    })
}
