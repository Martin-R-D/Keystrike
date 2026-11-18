use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;

/// A top-level window the user could switch to.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WindowInfo {
    pub hwnd: i64,
    pub title: String,
}

/// Windows that belong to Keystrike itself are never offered.
const OWN_TITLES: &[&str] = &["Keystrike", "Keystrike Settings"];

fn is_own_window(title: &str) -> bool {
    OWN_TITLES.contains(&title)
}

/// Filter windows by a fuzzy match on the title. With an empty query the
/// windows are returned in their original (z-order) order.
pub fn filter(windows: Vec<WindowInfo>, query: &str, limit: usize) -> Vec<WindowInfo> {
    let q = query.trim();
    let mut candidates: Vec<WindowInfo> =
        windows.into_iter().filter(|w| !is_own_window(&w.title)).collect();

    if q.is_empty() {
        candidates.truncate(limit);
        return candidates;
    }

    let matcher = SkimMatcherV2::default();
    let mut scored: Vec<(i64, WindowInfo)> = candidates
        .into_iter()
        .filter_map(|w| matcher.fuzzy_match(&w.title, q).map(|score| (score, w)))
        .collect();
    // Stable sort: equal scores keep z-order (most recently used first).
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(limit);
    scored.into_iter().map(|(_, w)| w).collect()
}

#[cfg(windows)]
mod win {
    use super::WindowInfo;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW, IsIconic,
        IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow, GWL_EXSTYLE, GW_OWNER,
        SW_RESTORE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    unsafe fn title_of(hwnd: HWND) -> String {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        String::from_utf16_lossy(&buf[..copied.max(0) as usize])
    }

    /// True for windows that show up in Alt+Tab (roughly).
    unsafe fn is_switchable(hwnd: HWND) -> bool {
        if IsWindowVisible(hwnd) == 0 {
            return false;
        }
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex_style & WS_EX_TOOLWINDOW != 0 {
            return false;
        }
        // Owned windows (dialogs) are skipped unless they ask for a taskbar button.
        let has_owner = !GetWindow(hwnd, GW_OWNER).is_null();
        if has_owner && ex_style & WS_EX_APPWINDOW == 0 {
            return false;
        }
        // Hidden UWP shells and windows on other virtual desktops are "cloaked".
        let mut cloaked: u32 = 0;
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        !(hr == 0 && cloaked != 0)
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam as *mut Vec<WindowInfo>);
        if is_switchable(hwnd) {
            let title = title_of(hwnd);
            if !title.trim().is_empty() {
                out.push(WindowInfo {
                    hwnd: hwnd as i64,
                    title,
                });
            }
        }
        1
    }

    pub fn list() -> Vec<WindowInfo> {
        let mut out: Vec<WindowInfo> = Vec::new();
        unsafe {
            EnumWindows(Some(enum_proc), &mut out as *mut Vec<WindowInfo> as LPARAM);
        }
        out
    }

    pub fn focus(hwnd: i64) -> Result<(), String> {
        let hwnd = hwnd as HWND;
        unsafe {
            if IsWindow(hwnd) == 0 {
                return Err("That window no longer exists".to_string());
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            if SetForegroundWindow(hwnd) == 0 {
                return Err("Windows would not bring that window to the front".to_string());
            }
        }
        Ok(())
    }
}

/// Visible top-level windows, topmost first.
#[cfg(windows)]
pub fn list() -> Vec<WindowInfo> {
    win::list()
}

#[cfg(not(windows))]
pub fn list() -> Vec<WindowInfo> {
    Vec::new()
}

/// Bring a window to the foreground (restoring it if minimised).
#[cfg(windows)]
pub fn focus(hwnd: i64) -> Result<(), String> {
    win::focus(hwnd)
}

#[cfg(not(windows))]
pub fn focus(_hwnd: i64) -> Result<(), String> {
    Err("Window switching is only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(hwnd: i64, title: &str) -> WindowInfo {
        WindowInfo {
            hwnd,
            title: title.to_string(),
        }
    }

    fn sample() -> Vec<WindowInfo> {
        vec![
            w(1, "main.rs - Keystrike - Visual Studio Code"),
            w(2, "Inbox - Mail - Mozilla Firefox"),
            w(3, "Keystrike"),
            w(4, "Keystrike Settings"),
            w(5, "Downloads"),
        ]
    }

    #[test]
    fn empty_query_keeps_z_order_and_hides_own_windows() {
        let hwnds: Vec<_> = filter(sample(), "", 10).into_iter().map(|x| x.hwnd).collect();
        assert_eq!(hwnds, vec![1, 2, 5]);
    }

    #[test]
    fn limit_is_applied() {
        assert_eq!(filter(sample(), "", 2).len(), 2);
    }

    #[test]
    fn fuzzy_matches_titles() {
        let hwnds: Vec<_> = filter(sample(), "firefox", 10).into_iter().map(|x| x.hwnd).collect();
        assert_eq!(hwnds, vec![2]);
        let hwnds: Vec<_> = filter(sample(), "vscode", 10).into_iter().map(|x| x.hwnd).collect();
        assert_eq!(hwnds, vec![1]);
    }

    #[test]
    fn no_match_returns_nothing() {
        assert!(filter(sample(), "zzzzqq", 10).is_empty());
    }

    #[test]
    fn matching_own_title_still_excludes_own_windows() {
        let hwnds: Vec<_> = filter(sample(), "keystrike", 10).into_iter().map(|x| x.hwnd).collect();
        assert_eq!(hwnds, vec![1]);
    }
}
