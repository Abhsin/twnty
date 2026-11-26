/// Cross-platform OS primitives: single-instance lock, idle time, screen lock,
/// cursor position, fullscreen detection, native notifications, and autostart.

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub enum ScreenPoint {
    Physical(i32, i32),
    Logical(f64, f64),
}

#[cfg(target_os = "windows")]
mod win {
    use super::ScreenPoint;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    static INSTANCE_MUTEX: OnceLock<isize> = OnceLock::new();

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
        fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
        fn GetClassNameW(hwnd: isize, lp_class_name: *mut u16, n_max_count: i32) -> i32;
        fn OpenInputDesktop(dw_flags: u32, f_inherit: i32, dw_desired_access: u32) -> isize;
        fn CloseDesktop(h_desktop: isize) -> i32;
        fn GetUserObjectInformationW(
            h_obj: isize,
            n_index: i32,
            pv_info: *mut u16,
            n_length: u32,
            lpn_length_needed: *mut u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
        fn CreateMutexW(
            lp_mutex_attributes: *const c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> isize;
        fn GetLastError() -> u32;
        fn CloseHandle(h_object: isize) -> i32;
    }

    pub fn acquire_single_instance() -> bool {
        const ERROR_ALREADY_EXISTS: u32 = 183;
        let name: Vec<u16> = "Local\\twnty_single_instance_v1\0"
            .encode_utf16()
            .collect();
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            if handle == 0 {
                return true;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return false;
            }
            let _ = INSTANCE_MUTEX.set(handle);
            true
        }
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

    pub fn is_screen_locked() -> bool {
        const DESKTOP_READOBJECTS: u32 = 0x0001;
        const UOI_NAME: i32 = 2;
        unsafe {
            let hdesk = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
            if hdesk != 0 {
                let mut buf = [0u16; 64];
                let mut needed: u32 = 0;
                let ok = GetUserObjectInformationW(
                    hdesk,
                    UOI_NAME,
                    buf.as_mut_ptr(),
                    (buf.len() * 2) as u32,
                    &mut needed,
                );
                CloseDesktop(hdesk);
                if ok != 0 && needed >= 2 {
                    let chars = ((needed as usize) / 2).saturating_sub(1).min(buf.len());
                    let name = String::from_utf16_lossy(&buf[..chars]).to_lowercase();
                    return matches!(name.as_str(), "winlogon" | "screen-saver");
                }
                false
            } else {
                GetLastError() == 5 && GetForegroundWindow() == 0
            }
        }
    }

    pub fn cursor_pos() -> Option<ScreenPoint> {
        unsafe {
            let mut pt = POINT::default();
            if GetCursorPos(&mut pt) != 0 {
                Some(ScreenPoint::Physical(pt.x, pt.y))
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

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == std::process::id() {
                return false;
            }

            let mut cls_buf = [0u16; 64];
            let len = GetClassNameW(hwnd, cls_buf.as_mut_ptr(), cls_buf.len() as i32);
            if len > 0 {
                let cls = String::from_utf16_lossy(&cls_buf[..len as usize]);
                if matches!(
                    cls.as_str(),
                    "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
                ) {
                    return false;
                }
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

    pub fn resolve_autostart_exe() -> Option<String> {
        let exe = std::env::current_exe().ok()?;
        let target_exe = if cfg!(debug_assertions) {
            exe.parent()
                .and_then(|p| p.parent())
                .map(|target_dir| target_dir.join("release").join("twnty.exe"))
                .filter(|rel| rel.exists())
                .unwrap_or(exe)
        } else {
            exe
        };
        Some(format!("\"{}\"", target_exe.display()))
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::ScreenPoint;
    use std::ffi::{c_char, c_void};
    use std::fs::{self, File, OpenOptions};
    use std::os::unix::io::AsRawFd;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    static INSTANCE_LOCK_FILE: OnceLock<File> = OnceLock::new();

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *const c_void) -> CGPoint;
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
        fn CGSessionCopyCurrentDictionary() -> *const c_void;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> *const c_void;
        fn CGRectMakeWithDictionaryRepresentation(dict: *const c_void, rect: *mut CGRect) -> u8;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFDictionaryGetValue(the_dict: *const c_void, key: *const c_void) -> *const c_void;
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFBooleanGetValue(boolean: *const c_void) -> u8;
        fn CFNumberGetTypeID() -> usize;
        fn CFNumberGetValue(number: *const c_void, the_type: isize, value_ptr: *mut c_void) -> u8;
        fn CFArrayGetCount(the_array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(the_array: *const c_void, idx: isize) -> *const c_void;
    }

    extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }

    pub fn acquire_single_instance() -> bool {
        const LOCK_EX_NB: i32 = 2 | 4;
        let path = std::env::temp_dir().join("twnty.instance.lock");
        let Ok(file) = OpenOptions::new().create(true).write(true).open(path) else {
            return true;
        };
        let rc = unsafe { flock(file.as_raw_fd(), LOCK_EX_NB) };
        if rc != 0 {
            return false;
        }
        let _ = INSTANCE_LOCK_FILE.set(file);
        true
    }

    pub fn idle_secs() -> u64 {
        unsafe {
            let secs = CGEventSourceSecondsSinceLastEventType(0, u32::MAX);
            if secs.is_finite() && secs >= 0.0 {
                secs as u64
            } else {
                0
            }
        }
    }

    pub fn is_screen_locked() -> bool {
        const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
        unsafe {
            let dict = CGSessionCopyCurrentDictionary();
            if dict.is_null() {
                return false;
            }
            let key = CFStringCreateWithCString(
                std::ptr::null(),
                b"CGSSessionScreenIsLocked\0".as_ptr() as *const c_char,
                K_CF_STRING_ENCODING_UTF8,
            );
            let mut locked = false;
            if !key.is_null() {
                let val = CFDictionaryGetValue(dict, key);
                if !val.is_null() && CFGetTypeID(val) == CFBooleanGetTypeID() {
                    locked = CFBooleanGetValue(val) != 0;
                }
                CFRelease(key);
            }
            CFRelease(dict);
            locked
        }
    }

    pub fn cursor_pos() -> Option<ScreenPoint> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return None;
            }
            let pt = CGEventGetLocation(event);
            CFRelease(event);
            Some(ScreenPoint::Logical(pt.x, pt.y))
        }
    }

    pub fn is_fullscreen() -> bool {
        const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
        const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
        const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
        const K_CF_NUMBER_SINT64_TYPE: isize = 4;

        unsafe {
            let disp = CGDisplayBounds(CGMainDisplayID());
            if disp.size.width <= 0.0 || disp.size.height <= 0.0 {
                return false;
            }
            let list = CGWindowListCopyWindowInfo(
                K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
                0,
            );
            if list.is_null() {
                return false;
            }

            let k_layer = CFStringCreateWithCString(
                std::ptr::null(),
                b"kCGWindowLayer\0".as_ptr() as *const c_char,
                K_CF_STRING_ENCODING_UTF8,
            );
            let k_pid = CFStringCreateWithCString(
                std::ptr::null(),
                b"kCGWindowOwnerPID\0".as_ptr() as *const c_char,
                K_CF_STRING_ENCODING_UTF8,
            );
            let k_bounds = CFStringCreateWithCString(
                std::ptr::null(),
                b"kCGWindowBounds\0".as_ptr() as *const c_char,
                K_CF_STRING_ENCODING_UTF8,
            );

            let mut found = false;
            if !k_layer.is_null() && !k_pid.is_null() && !k_bounds.is_null() {
                let count = CFArrayGetCount(list);
                let self_pid = std::process::id() as i64;
                for i in 0..count {
                    let entry = CFArrayGetValueAtIndex(list, i);
                    if entry.is_null() {
                        continue;
                    }

                    let layer_val = CFDictionaryGetValue(entry, k_layer);
                    let mut layer: i64 = -1;
                    if layer_val.is_null()
                        || CFGetTypeID(layer_val) != CFNumberGetTypeID()
                        || CFNumberGetValue(
                            layer_val,
                            K_CF_NUMBER_SINT64_TYPE,
                            (&mut layer as *mut i64).cast::<c_void>(),
                        ) == 0
                        || layer != 0
                    {
                        continue;
                    }

                    let pid_val = CFDictionaryGetValue(entry, k_pid);
                    let mut pid: i64 = 0;
                    if !pid_val.is_null()
                        && CFGetTypeID(pid_val) == CFNumberGetTypeID()
                        && CFNumberGetValue(
                            pid_val,
                            K_CF_NUMBER_SINT64_TYPE,
                            (&mut pid as *mut i64).cast::<c_void>(),
                        ) != 0
                        && pid == self_pid
                    {
                        continue;
                    }

                    let bounds_dict = CFDictionaryGetValue(entry, k_bounds);
                    if bounds_dict.is_null() {
                        continue;
                    }
                    let mut rect = CGRect {
                        origin: CGPoint { x: 0.0, y: 0.0 },
                        size: CGSize {
                            width: 0.0,
                            height: 0.0,
                        },
                    };
                    if CGRectMakeWithDictionaryRepresentation(bounds_dict, &mut rect) != 0
                        && rect.size.width >= disp.size.width - 1.0
                        && rect.size.height >= disp.size.height - 1.0
                        && rect.origin.x <= disp.origin.x + 1.0
                        && rect.origin.y <= disp.origin.y + 1.0
                    {
                        found = true;
                        break;
                    }
                }
            }

            if !k_layer.is_null() {
                CFRelease(k_layer);
            }
            if !k_pid.is_null() {
                CFRelease(k_pid);
            }
            if !k_bounds.is_null() {
                CFRelease(k_bounds);
            }
            CFRelease(list);
            found
        }
    }

    pub fn xml_escape(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for ch in input.chars() {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&apos;"),
                _ => out.push(ch),
            }
        }
        out
    }

    pub fn launch_agent_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("LaunchAgents")
                .join("com.twnty.app.plist")
        })
    }

    pub fn legacy_launch_agent_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("LaunchAgents")
                .join("com.twntytwntytwnty.app.plist")
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
            let escaped_exe = xml_escape(&exe.display().to_string());
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
                escaped_exe
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

    pub fn migrate_legacy_autostart() {
        if let Some(legacy) = legacy_launch_agent_path() {
            if legacy.exists() {
                let _ = fs::remove_file(legacy);
                if !is_autostart() {
                    let _ = set_autostart(true);
                }
            }
        }
    }
}

pub fn acquire_single_instance_lock() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win::acquire_single_instance();
    }
    #[cfg(target_os = "macos")]
    {
        return mac::acquire_single_instance();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        true
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

pub fn is_screen_locked() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win::is_screen_locked();
    }
    #[cfg(target_os = "macos")]
    {
        return mac::is_screen_locked();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

pub fn get_cursor_screen_pos() -> Option<ScreenPoint> {
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
    #[cfg(target_os = "macos")]
    {
        return mac::is_fullscreen();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

pub fn send_native_notification(title: &str, body: &str) {
    let title = title.to_string();
    let body = body.to_string();

    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            let _ = tauri_winrt_notification::Toast::new(
                tauri_winrt_notification::Toast::POWERSHELL_APP_ID,
            )
            .title(&title)
            .text1(&body)
            .show();
        });
    }
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(move || {
            let script = format!("display notification {:?} with title {:?}", body, title);
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .status();
        });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (title, body);
    }
}

pub fn migrate_legacy_autostart() {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ | KEY_WRITE,
        ) {
            let legacy: Result<String, _> = key.get_value("twntytwntytwnty");
            if legacy.is_ok() {
                let _ = key.delete_value("twntytwntytwnty");
                let current: Result<String, _> = key.get_value("twnty");
                if current.is_err() {
                    if let Some(path_str) = win::resolve_autostart_exe() {
                        let _ = key.set_value("twnty", &path_str);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        mac::migrate_legacy_autostart();
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
            let _ = key.delete_value("twntytwntytwnty");
            if enable {
                if let Some(path_str) = win::resolve_autostart_exe() {
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
