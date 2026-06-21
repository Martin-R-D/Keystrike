mod indexer;
mod searcher;

use std::collections::HashSet;
use std::sync::Mutex;

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use indexer::AppEntry;
use searcher::SearchResult;

struct AppState {
    apps: Mutex<Vec<AppEntry>>,
}

#[tauri::command]
fn search_apps(query: String, state: State<'_, AppState>) -> Vec<SearchResult> {
    let apps = state.apps.lock().unwrap();
    if query.is_empty() {
        searcher::most_used(&apps, 8)
    } else {
        searcher::search(&query, &apps, 8)
    }
}

#[tauri::command]
fn launch_app(id: u64, state: State<'_, AppState>) -> Result<(), String> {
    let mut apps = state.apps.lock().unwrap();
    let entry = apps
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("App not found")?;

    let launch_path = entry.launch_path.clone();
    entry.use_count += 1;

    drop(apps);

    eprintln!("[keystrike] Launching: {}", launch_path);

    std::process::Command::new("explorer")
        .arg(&launch_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn reindex_apps(state: State<'_, AppState>) -> usize {
    let new_apps = indexer::index_apps();
    let count = new_apps.len();
    *state.apps.lock().unwrap() = new_apps;
    count
}

#[derive(Debug, Clone, Serialize)]
struct ProcessInfo {
    name: String,
    exe: String,
}

#[tauri::command]
fn search_running_apps(query: String) -> Vec<ProcessInfo> {
    use std::os::windows::process::CommandExt;

    let output = match std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let matcher = SkimMatcherV2::default();

    let skip: HashSet<&str> = [
        "system idle process", "system", "svchost", "csrss", "wininit",
        "services", "lsass", "smss", "conhost", "dwm", "fontdrvhost",
        "winlogon", "sihost", "taskhostw", "ctfmon", "runtimebroker",
        "registry", "searchhost", "startmenuexperiencehost",
        "textinputhost", "shellexperiencehost", "dllhost",
        "backgroundtaskhost", "securityhealthsystray", "applicationframehost",
        "wmiprvse", "spoolsv", "audiodg", "msdtc", "searchindexer",
        "sgrmbroker", "securityhealthservice", "comppkgsrv", "dashost",
        "unsecapp", "msiexec", "explorer", "rundll32", "cmd",
    ]
    .into_iter()
    .collect();

    let mut seen = HashSet::new();
    let mut results: Vec<(i64, ProcessInfo)> = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.len() < 5 || !trimmed.starts_with('"') {
            continue;
        }
        let inner = &trimmed[1..trimmed.len() - 1];
        let fields: Vec<&str> = inner.split("\",\"").collect();
        if fields.len() < 2 {
            continue;
        }

        let exe = fields[0].to_string();
        let display = exe
            .strip_suffix(".exe")
            .or_else(|| exe.strip_suffix(".EXE"))
            .unwrap_or(&exe)
            .to_string();
        let lower = display.to_lowercase();

        if skip.contains(lower.as_str()) || !seen.insert(lower) {
            continue;
        }

        if query.is_empty() {
            results.push((0, ProcessInfo { name: display, exe }));
        } else if let Some(score) = matcher.fuzzy_match(&display, &query) {
            results.push((score, ProcessInfo { name: display, exe }));
        }
    }

    results.sort_by(|a, b| b.0.cmp(&a.0));
    results.truncate(8);
    results.into_iter().map(|(_, p)| p).collect()
}

#[tauri::command]
fn close_process(name: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    eprintln!("[keystrike] Closing: {}", name);

    std::process::Command::new("taskkill")
        .args(["/IM", &name, "/F"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        apps: Mutex::new(indexer::index_apps()),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                    if event.state == ShortcutState::Pressed && *shortcut == alt_space {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            search_apps,
            launch_app,
            reindex_apps,
            search_running_apps,
            close_process,
        ])
        .setup(|app| {
            let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.global_shortcut().register(alt_space)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
