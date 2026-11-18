use std::fs;

use serde::{Deserialize, Serialize};

use crate::data_dir;

pub const DEFAULT_ACCENT: &str = "#6366f1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeConfig {
    /// "dark", "light" or "system"
    pub mode: String,
    /// Accent colour as `#rrggbb`
    pub accent: String,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            mode: "dark".to_string(),
            accent: DEFAULT_ACCENT.to_string(),
        }
    }
}

fn theme_path() -> std::path::PathBuf {
    data_dir().join("theme.json")
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Validate and normalise a theme (lower-case accent).
pub fn validate(theme: &ThemeConfig) -> Result<ThemeConfig, String> {
    if !matches!(theme.mode.as_str(), "dark" | "light" | "system") {
        return Err(format!("Unknown theme mode: {}", theme.mode));
    }
    let accent = theme.accent.trim().to_lowercase();
    if !is_hex_color(&accent) {
        return Err("Accent must be a hex color like #6366f1".to_string());
    }
    Ok(ThemeConfig {
        mode: theme.mode.clone(),
        accent,
    })
}

pub fn load() -> ThemeConfig {
    fs::read_to_string(theme_path())
        .ok()
        .and_then(|s| serde_json::from_str::<ThemeConfig>(&s).ok())
        .and_then(|t| validate(&t).ok())
        .unwrap_or_default()
}

pub fn save(theme: &ThemeConfig) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    fs::write(theme_path(), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(mode: &str, accent: &str) -> ThemeConfig {
        ThemeConfig {
            mode: mode.to_string(),
            accent: accent.to_string(),
        }
    }

    #[test]
    fn default_is_dark_indigo() {
        let d = ThemeConfig::default();
        assert_eq!(d.mode, "dark");
        assert_eq!(d.accent, "#6366f1");
    }

    #[test]
    fn accepts_valid_themes_and_lowercases() {
        assert_eq!(validate(&t("light", "#AABBCC")).unwrap().accent, "#aabbcc");
        assert!(validate(&t("system", "#123456")).is_ok());
    }

    #[test]
    fn rejects_bad_mode_or_accent() {
        assert!(validate(&t("blue", "#123456")).is_err());
        assert!(validate(&t("dark", "123456")).is_err());
        assert!(validate(&t("dark", "#12345")).is_err());
        assert!(validate(&t("dark", "#12345g")).is_err());
        assert!(validate(&t("dark", "red")).is_err());
    }
}
