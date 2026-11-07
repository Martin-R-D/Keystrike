use std::fs;

use serde::{Deserialize, Serialize};

use crate::data_dir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pin {
    pub name: String,
    pub launch_path: String,
}

fn pins_path() -> std::path::PathBuf {
    data_dir().join("pins.json")
}

pub fn load() -> Vec<Pin> {
    fs::read_to_string(pins_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(pins: &[Pin]) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(pins).map_err(|e| e.to_string())?;
    fs::write(pins_path(), json).map_err(|e| e.to_string())
}

pub fn is_pinned(pins: &[Pin], launch_path: &str) -> bool {
    pins.iter().any(|p| p.launch_path == launch_path)
}

/// Add if not present, remove if present. Returns true if now pinned.
pub fn toggle(pins: &mut Vec<Pin>, name: &str, launch_path: &str) -> bool {
    if let Some(pos) = pins.iter().position(|p| p.launch_path == launch_path) {
        pins.remove(pos);
        false
    } else {
        pins.push(Pin {
            name: name.to_string(),
            launch_path: launch_path.to_string(),
        });
        true
    }
}
