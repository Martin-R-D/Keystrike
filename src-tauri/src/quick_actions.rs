use serde::Serialize;

/// A system action that can be triggered from the search bar.
#[derive(Debug, Clone, Serialize)]
pub struct QuickAction {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    /// Destructive actions ask for a second confirmation in the UI.
    pub confirm: bool,
    #[serde(skip)]
    keywords: &'static [&'static str],
}

const ACTIONS: &[QuickAction] = &[
    QuickAction {
        id: "lock",
        label: "Lock",
        description: "Lock your computer",
        icon: "\u{1F512}",
        confirm: false,
        keywords: &["lock", "lock screen"],
    },
    QuickAction {
        id: "sleep",
        label: "Sleep",
        description: "Put your computer to sleep",
        icon: "\u{1F319}",
        confirm: false,
        keywords: &["sleep", "suspend"],
    },
    QuickAction {
        id: "signout",
        label: "Sign out",
        description: "Sign out of Windows",
        icon: "\u{1F6AA}",
        confirm: true,
        keywords: &["sign out", "signout", "log off", "logoff", "logout"],
    },
    QuickAction {
        id: "restart",
        label: "Restart",
        description: "Restart your computer",
        icon: "\u{1F504}",
        confirm: true,
        keywords: &["restart", "reboot"],
    },
    QuickAction {
        id: "shutdown",
        label: "Shut down",
        description: "Shut down your computer",
        icon: "\u{23FB}",
        confirm: true,
        keywords: &["shut down", "shutdown", "power off", "poweroff"],
    },
    QuickAction {
        id: "recycle",
        label: "Empty Recycle Bin",
        description: "Permanently delete everything in the Recycle Bin",
        icon: "\u{1F5D1}\u{FE0F}",
        confirm: true,
        keywords: &["empty recycle bin", "recycle bin", "empty trash", "trash"],
    },
];

/// Actions whose keywords start with the query. Needs at least two characters
/// so single keystrokes do not flood the results.
pub fn search(query: &str) -> Vec<QuickAction> {
    let q = query.trim().to_lowercase();
    if q.chars().count() < 2 {
        return vec![];
    }
    ACTIONS
        .iter()
        .filter(|a| a.keywords.iter().any(|k| k.starts_with(&q)))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(q: &str) -> Vec<&'static str> {
        search(q).into_iter().map(|a| a.id).collect()
    }

    #[test]
    fn single_character_returns_nothing() {
        assert!(ids("l").is_empty());
        assert!(ids(" ").is_empty());
    }

    #[test]
    fn matches_keyword_prefix() {
        assert_eq!(ids("lo"), vec!["lock", "signout"]);
    }

    #[test]
    fn matches_multi_word_keywords() {
        assert_eq!(ids("shut"), vec!["shutdown"]);
        assert_eq!(ids("empty rec"), vec!["recycle"]);
        assert_eq!(ids("log off"), vec!["signout"]);
    }

    #[test]
    fn is_case_insensitive_and_trims() {
        assert_eq!(ids("  REBOOT "), vec!["restart"]);
    }

    #[test]
    fn unrelated_query_returns_nothing() {
        assert!(ids("chrome").is_empty());
    }

    #[test]
    fn destructive_actions_require_confirmation() {
        for id in ["signout", "restart", "shutdown", "recycle"] {
            assert!(search(id).iter().any(|a| a.id == id && a.confirm), "{id}");
        }
        assert!(!search("lock")[0].confirm);
        assert!(!search("sleep")[0].confirm);
    }
}

/// Run an action by id.
#[cfg(windows)]
pub fn run(id: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const NO_WINDOW: u32 = 0x08000000;

    let mut cmd = match id {
        "lock" => {
            let mut c = Command::new("rundll32.exe");
            c.args(["user32.dll,LockWorkStation"]);
            c
        }
        "sleep" => {
            let mut c = Command::new("rundll32.exe");
            c.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
            c
        }
        "signout" => {
            let mut c = Command::new("shutdown");
            c.args(["/l"]);
            c
        }
        "restart" => {
            let mut c = Command::new("shutdown");
            c.args(["/r", "/t", "0"]);
            c
        }
        "shutdown" => {
            let mut c = Command::new("shutdown");
            c.args(["/s", "/t", "0"]);
            c
        }
        "recycle" => {
            let mut c = Command::new("powershell");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Clear-RecycleBin -Force -ErrorAction SilentlyContinue",
            ]);
            c
        }
        other => return Err(format!("Unknown action: {}", other)),
    };

    cmd.creation_flags(NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to run action: {}", e))
}

#[cfg(not(windows))]
pub fn run(id: &str) -> Result<(), String> {
    Err(format!("Quick action '{}' is only supported on Windows", id))
}
