use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::data_dir;

/// A script run is cancelled after this long.
const TIMEOUT: Duration = Duration::from_secs(3);
/// At most this many result rows are returned.
const MAX_RESULTS: usize = 8;
/// Output beyond this many bytes is ignored.
const MAX_OUTPUT: u64 = 64 * 1024;
const MAX_TITLE: usize = 200;

const EXTENSIONS: &[&str] = &["ps1", "bat", "cmd", "py", "exe"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Script {
    /// What the user types to run it (the file name without extension).
    pub keyword: String,
    pub file_name: String,
    #[serde(skip)]
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ScriptResult {
    pub title: String,
    pub subtitle: String,
    /// Text copied when the result is chosen.
    pub copy: String,
    /// Opened in the browser when set (takes priority over `copy`).
    pub url: Option<String>,
}

pub fn scripts_dir() -> PathBuf {
    data_dir().join("scripts")
}

/// Create the scripts folder (with a small example the first time) and return it.
pub fn ensure_dir() -> Result<PathBuf, String> {
    let dir = scripts_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let example = "\
# Keystrike script example. Type: hello <your name>
# Every line printed becomes a result. Plain lines are copied when chosen;
# a line starting with http:// or https:// is opened in your browser. For
# more control print JSON lines like {\"title\": \"...\", \"subtitle\": \"...\", \"copy\": \"...\", \"url\": \"...\"}.
$name = if ($args.Count -gt 0) { $args -join ' ' } else { 'world' }
\"Hello, $name!\"
Get-Date -Format 'yyyy-MM-dd HH:mm'
";
        let _ = fs::write(dir.join("hello.ps1"), example);
    }
    Ok(dir)
}

/// Scripts found in `dir`, sorted by keyword. Files with other extensions or
/// names containing whitespace are ignored.
pub fn discover(dir: &Path) -> Vec<Script> {
    let mut found: Vec<Script> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| {
            let path = e.path();
            if !path.is_file() {
                return None;
            }
            let ext = path.extension()?.to_string_lossy().to_lowercase();
            if !EXTENSIONS.contains(&ext.as_str()) {
                return None;
            }
            let stem = path.file_stem()?.to_string_lossy().to_string();
            if stem.is_empty() || stem.chars().any(|c| c.is_whitespace()) {
                return None;
            }
            Some(Script {
                keyword: stem.to_lowercase(),
                file_name: path.file_name()?.to_string_lossy().to_string(),
                path,
            })
        })
        .collect();
    found.sort_by(|a, b| a.keyword.cmp(&b.keyword));
    found.dedup_by(|a, b| a.keyword == b.keyword);
    found
}

#[derive(Deserialize)]
struct JsonLine {
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    copy: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

fn is_http_url(s: &str) -> bool {
    s.starts_with("https://") || s.starts_with("http://")
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Turn script stdout into result rows. Each non-empty line is a result: JSON
/// objects (`{"title": ...}`) give full control, anything else is plain text.
pub fn parse_output(stdout: &str) -> Vec<ScriptResult> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            if line.starts_with('{') {
                if let Ok(j) = serde_json::from_str::<JsonLine>(line) {
                    // Only web links may be opened from a script result.
                    let url = j.url.filter(|u| is_http_url(u));
                    let copy = j.copy.unwrap_or_else(|| j.title.clone());
                    return Some(ScriptResult {
                        title: truncate(&j.title, MAX_TITLE),
                        subtitle: truncate(&j.subtitle, MAX_TITLE),
                        copy,
                        url,
                    });
                }
            }
            Some(ScriptResult {
                title: truncate(line, MAX_TITLE),
                subtitle: String::new(),
                copy: line.to_string(),
                url: if is_http_url(line) { Some(line.to_string()) } else { None },
            })
        })
        .take(MAX_RESULTS)
        .collect()
}

fn build_command(path: &Path, args: &[String]) -> Command {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut cmd = match ext.as_str() {
        "ps1" => {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
            c.arg(path);
            c
        }
        "py" => {
            let mut c = Command::new("python");
            c.arg(path);
            c
        }
        // .bat, .cmd and .exe run directly; arguments are passed as separate
        // argv entries, never through a shell command line.
        _ => Command::new(path),
    };
    cmd.args(args);
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    cmd
}

/// Run a script with the given arguments and parse its output. The script is
/// killed if it takes longer than a few seconds.
pub fn run(script: &Script, args: &[String]) -> Result<Vec<ScriptResult>, String> {
    let mut cmd = build_command(&script.path, args);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start {}: {}", script.file_name, e))?;
    let stdout = child.stdout.take().ok_or("No output stream")?;

    // Read output on a thread so a chatty or hung script cannot block us.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.take(MAX_OUTPUT).read_to_end(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(TIMEOUT) {
        Ok(buf) => {
            let _ = child.wait();
            Ok(parse_output(&String::from_utf8_lossy(&buf)))
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("{} timed out after {}s", script.file_name, TIMEOUT.as_secs()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("keystrike-scripts-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_plain_lines_and_urls() {
        let out = parse_output("hello\n\n  https://example.com/x  \nbye\n");
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].title, "hello");
        assert_eq!(out[0].copy, "hello");
        assert_eq!(out[0].url, None);
        assert_eq!(out[1].url.as_deref(), Some("https://example.com/x"));
    }

    #[test]
    fn parses_json_lines_with_defaults() {
        let out = parse_output(
            "{\"title\":\"A\",\"subtitle\":\"sub\",\"copy\":\"copied\",\"url\":\"https://a.dev\"}\n{\"title\":\"B\"}",
        );
        assert_eq!(out[0].subtitle, "sub");
        assert_eq!(out[0].copy, "copied");
        assert_eq!(out[0].url.as_deref(), Some("https://a.dev"));
        assert_eq!(out[1].copy, "B");
        assert_eq!(out[1].url, None);
    }

    #[test]
    fn only_web_urls_can_be_opened() {
        let out = parse_output("{\"title\":\"x\",\"url\":\"file:///C:/Windows/system32/calc.exe\"}\nC:\\Windows\\notepad.exe");
        assert_eq!(out[0].url, None);
        assert_eq!(out[1].url, None);
    }

    #[test]
    fn malformed_json_falls_back_to_plain_text() {
        let out = parse_output("{not json");
        assert_eq!(out[0].title, "{not json");
    }

    #[test]
    fn limits_rows_and_title_length() {
        let many: String = (0..20).map(|i| format!("line {}\n", i)).collect();
        assert_eq!(parse_output(&many).len(), MAX_RESULTS);
        let long = "x".repeat(1000);
        assert_eq!(parse_output(&long)[0].title.chars().count(), MAX_TITLE);
    }

    #[test]
    fn discover_filters_by_extension_and_whitespace() {
        let dir = temp_dir("discover");
        for f in ["b.ps1", "a.py", "run me.cmd", "notes.txt", "tool.EXE"] {
            fs::write(dir.join(f), "x").unwrap();
        }
        fs::create_dir(dir.join("sub.ps1")).unwrap();
        let keywords: Vec<_> = discover(&dir).into_iter().map(|s| s.keyword).collect();
        assert_eq!(keywords, vec!["a", "b", "tool"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_missing_dir_is_empty() {
        assert!(discover(Path::new("/definitely/not/here")).is_empty());
    }

    #[cfg(unix)]
    fn write_exec(dir: &Path, name: &str, body: &str) -> Script {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{}\n", body)).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        Script {
            keyword: name.trim_end_matches(".exe").to_string(),
            file_name: name.to_string(),
            path,
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_passes_args_and_parses_stdout() {
        let dir = temp_dir("run");
        let s = write_exec(&dir, "echoer.exe", "echo \"got: $1 $2\"; echo second");
        let out = run(&s, &["a b".to_string(), "c;d".to_string()]).unwrap();
        assert_eq!(out[0].title, "got: a b c;d");
        assert_eq!(out[1].title, "second");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn run_kills_scripts_that_hang() {
        let dir = temp_dir("hang");
        let s = write_exec(&dir, "slow.exe", "sleep 30");
        let started = std::time::Instant::now();
        let err = run(&s, &[]).unwrap_err();
        assert!(err.contains("timed out"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(10));
        let _ = fs::remove_dir_all(&dir);
    }
}
