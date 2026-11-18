use std::fs;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::Shortcut;

use crate::data_dir;

pub const DEFAULT_HOTKEY: &str = "Alt+Space";

#[derive(Debug, Serialize, Deserialize)]
struct HotkeyConfig {
    hotkey: String,
}

fn hotkey_path() -> std::path::PathBuf {
    data_dir().join("hotkey.json")
}

/// Parse a hotkey string such as "Alt+Space" or "Ctrl+Shift+K".
pub fn parse(hotkey: &str) -> Result<Shortcut, String> {
    let trimmed = hotkey.trim();
    if trimmed.is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    // A shortcut needs at least one modifier, otherwise it would steal a
    // plain key (e.g. "A") from every other application.
    if !trimmed.contains('+') {
        return Err("Hotkey needs at least one modifier (Ctrl, Alt, Shift or Win)".to_string());
    }
    Shortcut::from_str(trimmed).map_err(|e| format!("Invalid hotkey: {}", e))
}

/// Load the saved hotkey, falling back to the default if the file is missing
/// or no longer parses.
pub fn load() -> String {
    fs::read_to_string(hotkey_path())
        .ok()
        .and_then(|s| serde_json::from_str::<HotkeyConfig>(&s).ok())
        .map(|c| c.hotkey)
        .filter(|h| parse(h).is_ok())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

pub fn save(hotkey: &str) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&HotkeyConfig {
        hotkey: hotkey.to_string(),
    })
    .map_err(|e| e.to_string())?;
    fs::write(hotkey_path(), json).map_err(|e| e.to_string())
}

/// Human friendly label for menus, e.g. "Alt+Space".
pub fn display(hotkey: &str) -> String {
    hotkey.trim().to_string()
}
