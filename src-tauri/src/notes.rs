use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::data_dir;

#[derive(Debug, Clone, Serialize)]
pub struct NoteEntry {
    pub text: String,
    pub timestamp: String,
}

fn notes_path() -> std::path::PathBuf {
    data_dir().join("notes.txt")
}

/// Format a unix timestamp (seconds) as "YYYY-MM-DD HH:MM".
/// Uses manual arithmetic to avoid pulling in chrono.
fn format_timestamp(secs: u64) -> String {
    // Days since unix epoch
    let mut days = secs / 86400;
    let time_of_day = secs % 86400;
    let hh = time_of_day / 3600;
    let mm = (time_of_day % 3600) / 60;

    // Gregorian calendar from day count
    let mut year = 1970u32;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let month_days: &[u64] = if is_leap(year) {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u32;
    for &d in month_days {
        if days < d {
            break;
        }
        days -= d;
        month += 1;
    }
    let day = days + 1;
    format!("{:04}-{:02}-{:02} {:02}:{:02}", year, month, day, hh, mm)
}

fn is_leap(year: u32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn save(text: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Note is empty".to_string());
    }

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let ts = format_timestamp(secs);
    let line = format!("{} | {}\n", ts, text);

    let path = notes_path();
    let _ = fs::create_dir_all(data_dir());

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let new_content = format!("{}{}", line, existing);
    fs::write(&path, new_content).map_err(|e| e.to_string())
}

pub fn list() -> Vec<NoteEntry> {
    let path = notes_path();
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(30)
        .filter_map(|line| {
            if let Some(idx) = line.find(" | ") {
                let ts = line[..idx].to_string();
                let text = line[idx + 3..].to_string();
                Some(NoteEntry { text, timestamp: ts })
            } else {
                Some(NoteEntry {
                    text: line.to_string(),
                    timestamp: String::new(),
                })
            }
        })
        .collect()
}
