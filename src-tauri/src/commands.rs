use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};

/// Customizable keyword/prefix mappings for the built-in commands.
///
/// Stored on disk at `~/.keystrike/commands.json`. Keys are stable command
/// ids (e.g. "google", "close"); values are the user-facing keyword/prefix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsConfig {
    pub web_search: HashMap<String, String>,
    pub system: HashMap<String, String>,
}

/// The default keyword for every command, paired with its id.
/// Order here is the canonical command order used everywhere.
const WEB_SEARCH_DEFAULTS: &[(&str, &str)] = &[
    ("google", "g"),
    ("youtube", "yt"),
    ("wikipedia", "wiki"),
    ("reddit", "r"),
    ("github", "gh"),
    ("stackoverflow", "so"),
    ("duckduckgo", "ddg"),
];

const SYSTEM_DEFAULTS: &[(&str, &str)] = &[("close", "/close")];

impl CommandsConfig {
    pub fn defaults() -> Self {
        CommandsConfig {
            web_search: WEB_SEARCH_DEFAULTS
                .iter()
                .map(|(id, kw)| (id.to_string(), kw.to_string()))
                .collect(),
            system: SYSTEM_DEFAULTS
                .iter()
                .map(|(id, kw)| (id.to_string(), kw.to_string()))
                .collect(),
        }
    }

    /// Fill in any command ids missing from a loaded config with their
    /// defaults, so a partial/old config file never drops a command.
    fn fill_missing(&mut self) {
        for (id, kw) in WEB_SEARCH_DEFAULTS {
            self.web_search
                .entry(id.to_string())
                .or_insert_with(|| kw.to_string());
        }
        for (id, kw) in SYSTEM_DEFAULTS {
            self.system
                .entry(id.to_string())
                .or_insert_with(|| kw.to_string());
        }
    }

    /// Iterate over every (group, id, keyword) entry.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.web_search
            .iter()
            .chain(self.system.iter())
            .map(|(id, kw)| (id.as_str(), kw.as_str()))
    }

    /// Look up the group + mutable slot for a command id, if it exists.
    fn slot_mut(&mut self, command_id: &str) -> Option<&mut String> {
        if self.web_search.contains_key(command_id) {
            self.web_search.get_mut(command_id)
        } else if self.system.contains_key(command_id) {
            self.system.get_mut(command_id)
        } else {
            None
        }
    }

    pub fn contains(&self, command_id: &str) -> bool {
        self.web_search.contains_key(command_id) || self.system.contains_key(command_id)
    }
}

/// Normalize a keyword for duplicate comparison: lowercased with a single
/// leading slash stripped, so "gh" and "/gh" (or "close"/"/close") collide.
pub fn normalize(keyword: &str) -> String {
    keyword.trim_start_matches('/').to_lowercase()
}

fn config_path() -> std::path::PathBuf {
    crate::data_dir().join("commands.json")
}

/// Load the saved config, falling back to defaults. Missing command ids are
/// backfilled with their defaults.
pub fn load() -> CommandsConfig {
    match fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str::<CommandsConfig>(&s).ok())
    {
        Some(mut cfg) => {
            cfg.fill_missing();
            cfg
        }
        None => CommandsConfig::defaults(),
    }
}

pub fn save(cfg: &CommandsConfig) -> Result<(), String> {
    let dir = crate::data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())
}

pub fn delete_file() {
    let _ = fs::remove_file(config_path());
}

/// Validate a proposed keyword for `command_id` against the current config.
/// Returns `Ok(trimmed_keyword)` or an error string.
pub fn validate(cfg: &CommandsConfig, command_id: &str, new_keyword: &str) -> Result<String, String> {
    let kw = new_keyword.trim();

    if !cfg.contains(command_id) {
        return Err(format!("Unknown command: {}", command_id));
    }
    if kw.is_empty() {
        return Err("Keyword cannot be empty".to_string());
    }
    if kw.chars().any(|c| c.is_whitespace()) {
        return Err("Keyword cannot contain spaces".to_string());
    }

    let target = normalize(kw);
    for (id, existing) in cfg.iter() {
        if id == command_id {
            continue;
        }
        if normalize(existing) == target {
            return Err(format!("Keyword '{}' is already in use", kw));
        }
    }

    Ok(kw.to_string())
}

/// Apply a validated keyword change to the in-memory config.
pub fn apply(cfg: &mut CommandsConfig, command_id: &str, keyword: String) {
    if let Some(slot) = cfg.slot_mut(command_id) {
        *slot = keyword;
    }
}
