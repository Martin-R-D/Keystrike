use std::fs;

use serde::{Deserialize, Serialize};

use crate::data_dir;

/// A short user-chosen name that jumps straight to an app, e.g. `ff` -> Firefox.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Alias {
    pub alias: String,
    pub name: String,
    pub launch_path: String,
}

fn aliases_path() -> std::path::PathBuf {
    data_dir().join("aliases.json")
}

pub fn load() -> Vec<Alias> {
    fs::read_to_string(aliases_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(aliases: &[Alias]) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(aliases).map_err(|e| e.to_string())?;
    fs::write(aliases_path(), json).map_err(|e| e.to_string())
}

fn normalize(alias: &str) -> String {
    alias.trim().to_lowercase()
}

/// Find the alias matching the whole query (case-insensitive).
pub fn find<'a>(aliases: &'a [Alias], query: &str) -> Option<&'a Alias> {
    let q = normalize(query);
    if q.is_empty() {
        return None;
    }
    aliases.iter().find(|a| a.alias == q)
}

/// Add an alias, replacing any existing alias with the same text.
pub fn set(
    aliases: &mut Vec<Alias>,
    alias: &str,
    name: &str,
    launch_path: &str,
) -> Result<(), String> {
    let alias = normalize(alias);
    if alias.is_empty() {
        return Err("Alias cannot be empty".to_string());
    }
    if alias.chars().any(|c| c.is_whitespace()) {
        return Err("Alias cannot contain spaces".to_string());
    }
    aliases.retain(|a| a.alias != alias);
    aliases.push(Alias {
        alias,
        name: name.to_string(),
        launch_path: launch_path.to_string(),
    });
    Ok(())
}

/// Remove an alias. Returns true if it existed.
pub fn remove(aliases: &mut Vec<Alias>, alias: &str) -> bool {
    let alias = normalize(alias);
    let before = aliases.len();
    aliases.retain(|a| a.alias != alias);
    aliases.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_find_case_insensitive() {
        let mut list = vec![];
        set(&mut list, "FF", "Firefox", "C:\\ff.lnk").unwrap();
        assert_eq!(find(&list, "ff").unwrap().name, "Firefox");
        assert_eq!(find(&list, " Ff ").unwrap().name, "Firefox");
        assert!(find(&list, "f").is_none());
        assert!(find(&list, "").is_none());
    }

    #[test]
    fn set_replaces_existing_alias() {
        let mut list = vec![];
        set(&mut list, "b", "Brave", "brave").unwrap();
        set(&mut list, "B", "Chrome", "chrome").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Chrome");
    }

    #[test]
    fn rejects_empty_and_spaced_aliases() {
        let mut list = vec![];
        assert!(set(&mut list, "  ", "x", "x").is_err());
        assert!(set(&mut list, "a b", "x", "x").is_err());
        assert!(list.is_empty());
    }

    #[test]
    fn remove_reports_existence() {
        let mut list = vec![];
        set(&mut list, "ff", "Firefox", "ff").unwrap();
        assert!(remove(&mut list, "FF"));
        assert!(!remove(&mut list, "ff"));
        assert!(list.is_empty());
    }
}
