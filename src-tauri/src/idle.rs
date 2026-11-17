/// Cross-platform idle time, cursor position, fullscreen detection, native notifications, and autostart.

#[cfg(target_os = "windows")]
mod win {
    #[repr(C)]
    struct LASTINPUTINFO {
        cb_size: u32,
        dw_time: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MONITORINFO {
        cb_size: u32,
        rc_monitor: RECT,
        rc_work: RECT,
        dw_flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LASTINPUTINFO) -> i32;
        fn GetCursorPos(lp_point: *mut POINT) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetDesktopWindow() -> isize;
        fn GetShellWindow() -> isize;
        fn GetWindowRect(hwnd: isize, lp_rect: *mut RECT) -> i32;
        fn MonitorFromWindow(hwnd: isize, dw_flags: u32) -> isize;
        fn GetMonitorInfoW(hmonitor: isize, lpmi: *mut MONITORINFO) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    pub fn idle_secs() -> u64 {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cb_size: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dw_time: 0,
            };
            if GetLastInputInfo(&mut lii) != 0 {
                let now = GetTickCount();
                let elapsed_ms = now.wrapping_sub(lii.dw_time);
                (elapsed_ms / 1000) as u64
            } else {
                0
            }
        }
    }

    pub fn cursor_pos() -> Option<(i32, i32)> {
        unsafe {
            let mut pt = POINT::default();
            if GetCursorPos(&mut pt) != 0 {
                Some((pt.x, pt.y))
            } else {
                None
            }
        }
    }

    pub fn is_fullscreen() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 || hwnd == GetDesktopWindow() || hwnd == GetShellWindow() {
                return false;
            }
            let mut win_rect = RECT::default();
            if GetWindowRect(hwnd, &mut win_rect) == 0 {
                return false;
            }
            let hmon = MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
            if hmon == 0 {
                return false;
            }
            let mut mi = MONITORINFO {
                cb_size: std::mem::size_of::<MONITORINFO>() as u32,
                rc_monitor: RECT::default(),
                rc_work: RECT::default(),
                dw_flags: 0,
            };
            if GetMonitorInfoW(hmon, &mut mi) == 0 {
                return false;
            }
            let mon = mi.rc_monitor;
            let w_width = win_rect.right - win_rect.left;
            let w_height = win_rect.bottom - win_rect.top;
            let m_width = mon.right - mon.left;
            let m_height = mon.bottom - mon.top;

            w_width >= m_width
                && w_height >= m_height
                && win_rect.left <= mon.left
                && win_rect.top <= mon.top
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    use std::fs;
    use std::path::PathBuf;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *const c_void) -> CGPoint;
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    pub fn idle_secs() -> u64 {
        unsafe {
            // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0 (u32::MAX)
            let secs = CGEventSourceSecondsSinceLastEventType(0, u32::MAX);
            if secs.is_finite() && secs >= 0.0 {
                secs as u64
            } else {
                0
            }
        }
    }

    pub fn cursor_pos() -> Option<(i32, i32)> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return None;
            }
            let pt = CGEventGetLocation(event);
            CFRelease(event);
            Some((pt.x as i32, pt.y as i32))
        }
    }

    pub fn launch_agent_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("LaunchAgents")
                .join("com.twnty.app.plist")
        })
    }

    pub fn set_autostart(enable: bool) -> bool {
        let Some(plist_path) = launch_agent_path() else {
            return false;
        };
        if enable {
            let Ok(exe) = std::env::current_exe() else {
                return false;
            };
            if let Some(parent) = plist_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.twnty.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
                exe.display()
            );
            fs::write(plist_path, plist).is_ok()
        } else {
            let _ = fs::remove_file(plist_path);
            true
        }
    }

    pub fn is_autostart() -> bool {
        launch_agent_path().map(|p| p.exists()).unwrap_or(false)
    }
}

pub fn get_system_idle_secs() -> u64 {
    #[cfg(target_os = "windows")]
    {
        return win::idle_secs();
    }
    #[cfg(target_os = "macos")]
    {
        return mac::idle_secs();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        0
    }
}

pub fn get_cursor_screen_pos() -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        return win::cursor_pos();
    }
    #[cfg(target_os = "macos")]
    {
        return mac::cursor_pos();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

pub fn is_foreground_fullscreen() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win::is_fullscreen();
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn send_native_notification(title: &str, body: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = tauri_winrt_notification::Toast::new(
            tauri_winrt_notification::Toast::POWERSHELL_APP_ID,
        )
        .title(title)
        .text1(body)
        .show();
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("display notification {:?} with title {:?}", body, title);
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn();
    }
}

pub fn set_autostart_enabled(enable: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) =
            hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        {
            // Clean up legacy registry key name if present
            let _ = key.delete_value("twntytwntytwnty");
            if enable {
                if let Ok(exe) = std::env::current_exe() {
                    // Prefer the standalone release binary over target/debug (which requires localhost:1420)
                    let target_exe = if cfg!(debug_assertions) {
                        exe.parent()
                            .and_then(|p| p.parent())
                            .map(|target_dir| target_dir.join("release").join("twnty.exe"))
                            .filter(|rel| rel.exists())
                            .unwrap_or(exe)
                    } else {
                        exe
                    };
                    let path_str = format!("\"{}\"", target_exe.display());
                    return key.set_value("twnty", &path_str).is_ok();
                }
            } else {
                let _ = key.delete_value("twnty");
                return true;
            }
        }
        false
    }
    #[cfg(target_os = "macos")]
    {
        return mac::set_autostart(enable);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = enable;
        true
    }
}

pub fn is_autostart_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ,
        ) {
            let val: Result<String, _> = key.get_value("twnty");
            return val.is_ok();
        }
        false
    }
    #[cfg(target_os = "macos")]
    {
        return mac::is_autostart();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}
