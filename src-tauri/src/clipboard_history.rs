use std::collections::VecDeque;
use std::fs;

use serde::{Deserialize, Serialize};

use crate::data_dir;

/// Maximum number of entries kept in memory.
pub const MAX_ENTRIES: usize = 50;
/// Entries longer than this are ignored (huge pastes are rarely worth keeping).
pub const MAX_LEN: usize = 10_000;

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub id: u64,
    pub text: String,
    /// Unix timestamp (seconds) of when the text was copied.
    pub copied_at: u64,
}

/// In-memory clipboard history. Nothing here is ever written to disk, because
/// clipboards regularly contain passwords and other secrets.
#[derive(Debug, Default)]
pub struct History {
    entries: VecDeque<Entry>,
    next_id: u64,
    /// Text that must not be recorded (e.g. a snippet Keystrike copied itself).
    ignore: Option<String>,
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    /// Skip this exact text the next time it shows up on the clipboard.
    pub fn ignore_text(&mut self, text: &str) {
        self.ignore = Some(text.to_string());
    }

    /// Record newly copied text. Returns true if it was stored.
    pub fn record(&mut self, text: &str, now: u64) -> bool {
        if self.ignore.as_deref() == Some(text) {
            return false;
        }
        // Something else was copied, so the ignore only applied to the old text.
        self.ignore = None;

        if text.trim().is_empty() || text.len() > MAX_LEN {
            return false;
        }
        self.entries.retain(|e| e.text != text);
        self.entries.push_front(Entry {
            id: self.next_id,
            text: text.to_string(),
            copied_at: now,
        });
        self.next_id += 1;
        self.entries.truncate(MAX_ENTRIES);
        true
    }

    /// Newest-first entries containing `query` (case-insensitive). An empty
    /// query returns everything.
    pub fn search(&self, query: &str) -> Vec<Entry> {
        let q = query.trim().to_lowercase();
        self.entries
            .iter()
            .filter(|e| q.is_empty() || e.text.to_lowercase().contains(&q))
            .cloned()
            .collect()
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() != before
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Settings {
    enabled: bool,
}

fn settings_path() -> std::path::PathBuf {
    data_dir().join("clipboard.json")
}

/// Whether history recording is enabled (default: yes).
pub fn load_enabled() -> bool {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .map(|s| s.enabled)
        .unwrap_or(true)
}

pub fn save_enabled(enabled: bool) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&Settings { enabled }).map_err(|e| e.to_string())?;
    fs::write(settings_path(), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_newest_first_and_dedupes() {
        let mut h = History::new();
        assert!(h.record("one", 1));
        assert!(h.record("two", 2));
        assert!(h.record("one", 3));
        let texts: Vec<_> = h.search("").into_iter().map(|e| e.text).collect();
        assert_eq!(texts, vec!["one", "two"]);
        assert_eq!(h.search("")[0].copied_at, 3);
    }

    #[test]
    fn skips_blank_and_oversized_text() {
        let mut h = History::new();
        assert!(!h.record("", 1));
        assert!(!h.record("  \n\t ", 1));
        assert!(!h.record(&"x".repeat(MAX_LEN + 1), 1));
        assert!(h.search("").is_empty());
        assert!(h.record(&"x".repeat(MAX_LEN), 1));
    }

    #[test]
    fn caps_the_number_of_entries() {
        let mut h = History::new();
        for i in 0..(MAX_ENTRIES + 10) {
            h.record(&format!("item {}", i), i as u64);
        }
        let all = h.search("");
        assert_eq!(all.len(), MAX_ENTRIES);
        assert_eq!(all[0].text, format!("item {}", MAX_ENTRIES + 9));
    }

    #[test]
    fn search_is_case_insensitive_substring() {
        let mut h = History::new();
        h.record("Invoice #42", 1);
        h.record("hello world", 2);
        let hits = h.search("INVOICE");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text, "Invoice #42");
        assert!(h.search("zzz").is_empty());
    }

    #[test]
    fn ignored_text_is_not_recorded_until_something_else_is_copied() {
        let mut h = History::new();
        h.ignore_text("secret");
        assert!(!h.record("secret", 1));
        assert!(!h.record("secret", 2));
        assert!(h.record("other", 3));
        // The ignore was lifted, so a later copy of the same text is recorded.
        assert!(h.record("secret", 4));
    }

    #[test]
    fn remove_and_clear() {
        let mut h = History::new();
        h.record("a", 1);
        h.record("b", 2);
        let id = h.search("a")[0].id;
        assert!(h.remove(id));
        assert!(!h.remove(id));
        assert_eq!(h.search("").len(), 1);
        h.clear();
        assert!(h.search("").is_empty());
    }
}
