use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

/// Upper bound on indexed entries so memory stays small on huge drives.
pub const MAX_ENTRIES: usize = 300_000;
const MAX_DEPTH: usize = 8;

/// Folder names that are never descended into.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "appdata", "$recycle.bin", "__pycache__", "venv",
];

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    lower: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileHit {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// The folders searched by default, relative to the user's profile.
pub fn default_roots() -> Vec<PathBuf> {
    let home = match std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        Ok(h) => PathBuf::from(h),
        Err(_) => return vec![],
    };
    ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"]
        .iter()
        .map(|d| home.join(d))
        .filter(|p| p.is_dir())
        .collect()
}

fn is_skipped(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_lowercase().as_str())
}

/// Walk the given folders and collect file and folder names.
pub fn build_index(roots: &[PathBuf]) -> Vec<FileEntry> {
    let mut out = Vec::new();
    for root in roots {
        let walker = WalkDir::new(root)
            .max_depth(MAX_DEPTH)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !is_skipped(&e.file_name().to_string_lossy()));
        for entry in walker.filter_map(Result::ok) {
            if entry.depth() == 0 {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            out.push(FileEntry {
                lower: name.to_lowercase(),
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir: entry.file_type().is_dir(),
            });
            if out.len() >= MAX_ENTRIES {
                return out;
            }
        }
    }
    out
}

/// 0 = exact name (ignoring extension), 1 = prefix, 2 = word start, 3 = contains.
fn rank(lower_name: &str, token: &str) -> Option<u8> {
    let stem = lower_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .filter(|s| !s.is_empty())
        .unwrap_or(lower_name);
    if stem == token || lower_name == token {
        return Some(0);
    }
    if lower_name.starts_with(token) {
        return Some(1);
    }
    let pos = lower_name.find(token)?;
    let prev = lower_name[..pos].chars().last();
    if matches!(prev, Some(' ' | '_' | '-' | '.')) {
        Some(2)
    } else {
        Some(3)
    }
}

/// Case-insensitive search over the index. Every whitespace-separated word
/// must appear in the file name; results are ordered by how well the first
/// word matches, then by shorter names.
pub fn search(index: &[FileEntry], query: &str, limit: usize) -> Vec<FileHit> {
    let tokens: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    if tokens.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(u8, usize, &FileEntry)> = index
        .iter()
        .filter_map(|e| {
            let first = rank(&e.lower, &tokens[0])?;
            if tokens[1..].iter().all(|t| e.lower.contains(t.as_str())) {
                Some((first, e.name.len(), e))
            } else {
                None
            }
        })
        .collect();
    scored.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    scored.truncate(limit);
    scored
        .into_iter()
        .map(|(_, _, e)| FileHit {
            name: e.name.clone(),
            path: e.path.clone(),
            is_dir: e.is_dir,
        })
        .collect()
}

/// A path is only opened if it still exists on disk.
pub fn ensure_exists(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.exists() {
        Ok(p)
    } else {
        Err("That file no longer exists".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn entry(name: &str, is_dir: bool) -> FileEntry {
        FileEntry {
            name: name.to_string(),
            lower: name.to_lowercase(),
            path: format!("C:\\Users\\me\\{}", name),
            is_dir,
        }
    }

    fn names(hits: Vec<FileHit>) -> Vec<String> {
        hits.into_iter().map(|h| h.name).collect()
    }

    #[test]
    fn ranks_exact_then_prefix_then_word_then_contains() {
        let index = vec![
            entry("my-report-final.docx", false),
            entry("xreportx.txt", false),
            entry("report.pdf", false),
            entry("reports", true),
        ];
        assert_eq!(
            names(search(&index, "report", 10)),
            vec!["report.pdf", "reports", "my-report-final.docx", "xreportx.txt"]
        );
    }

    #[test]
    fn multiple_words_must_all_match() {
        let index = vec![
            entry("Tax Return 2024.pdf", false),
            entry("Tax Notes.txt", false),
            entry("Return Policy.pdf", false),
        ];
        assert_eq!(names(search(&index, "tax 2024", 10)), vec!["Tax Return 2024.pdf"]);
    }

    #[test]
    fn empty_query_and_no_match_return_nothing() {
        let index = vec![entry("a.txt", false)];
        assert!(search(&index, "   ", 10).is_empty());
        assert!(search(&index, "zzz", 10).is_empty());
    }

    #[test]
    fn respects_limit() {
        let index: Vec<_> = (0..20).map(|i| entry(&format!("note{}.txt", i), false)).collect();
        assert_eq!(search(&index, "note", 5).len(), 5);
    }

    #[test]
    fn build_index_skips_hidden_and_ignored_folders() {
        let root = std::env::temp_dir().join(format!("keystrike-fs-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("docs/plan.md"), "x").unwrap();
        fs::write(root.join("node_modules/pkg/skip.js"), "x").unwrap();
        fs::write(root.join(".git/config"), "x").unwrap();
        fs::write(root.join(".hidden"), "x").unwrap();

        let index = build_index(&[root.clone()]);
        let found: Vec<_> = index.iter().map(|e| e.name.as_str()).collect();
        assert!(found.contains(&"plan.md"));
        assert!(found.contains(&"docs"));
        assert!(!found.contains(&"skip.js"));
        assert!(!found.contains(&"config"));
        assert!(!found.contains(&".hidden"));
        assert!(index.iter().any(|e| e.name == "docs" && e.is_dir));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_exists_checks_the_disk() {
        assert!(ensure_exists("/definitely/not/here").is_err());
        assert!(ensure_exists(".").is_ok());
    }
}
