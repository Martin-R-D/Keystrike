mod calculator;
mod converter;
mod indexer;
mod searcher;
mod web_search;

use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use indexer::AppEntry;
use searcher::SearchResult;

struct AppState {
    apps: Mutex<Vec<AppEntry>>,
    searcher: searcher::Searcher,
    ready: Mutex<bool>,
}

fn data_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".keystrike")
}

fn load_usage() -> HashMap<String, u64> {
    let path = data_dir().join("app_usage.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_usage(apps: &[AppEntry]) {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    let map: HashMap<String, u64> = apps
        .iter()
        .filter(|a| a.use_count > 0)
        .map(|a| (a.launch_path.clone(), a.use_count))
        .collect();
    if let Ok(json) = serde_json::to_string_pretty(&map) {
        let _ = fs::write(dir.join("app_usage.json"), json);
    }
}

fn apply_usage(apps: &mut [AppEntry], usage: &HashMap<String, u64>) {
    for app in apps.iter_mut() {
        if let Some(&count) = usage.get(&app.launch_path) {
            app.use_count = count;
        }
    }
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct WindowPosition {
    x: f64,
    y: f64,
}

fn load_window_position() -> Option<WindowPosition> {
    let path = data_dir().join("window_position.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn save_window_position(pos: &WindowPosition) {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string(pos) {
        let _ = fs::write(dir.join("window_position.json"), json);
    }
}

#[derive(Debug, Clone, Serialize)]
struct EvalResult {
    result_type: String,
    expression: String,
    result: f64,
    display: String,
    input_unit: Option<String>,
    output_unit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct IndexStatus {
    ready: bool,
    count: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ProcessInfo {
    name: String,
    exe: String,
}

#[tauri::command]
fn get_index_status(state: State<'_, AppState>) -> IndexStatus {
    let ready = *state.ready.lock().unwrap();
    let count = state.apps.lock().unwrap().len();
    IndexStatus { ready, count }
}

#[tauri::command]
fn search_apps(query: String, state: State<'_, AppState>) -> Vec<SearchResult> {
    let apps = state.apps.lock().unwrap();
    if query.is_empty() {
        searcher::most_used(&apps, 8)
    } else {
        state.searcher.search(&query, &apps, 8)
    }
}

#[tauri::command]
fn launch_app(id: u64, state: State<'_, AppState>) -> Result<String, String> {
    let mut apps = state.apps.lock().unwrap();
    let entry = apps
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("App not found")?;

    let launch_path = entry.launch_path.clone();
    let name = entry.name.clone();
    entry.use_count += 1;

    save_usage(&apps);
    drop(apps);

    eprintln!("[keystrike] Launching: {}", launch_path);

    std::process::Command::new("explorer")
        .arg(&launch_path)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", name, e))?;

    Ok(name)
}

#[tauri::command]
fn reindex_apps(state: State<'_, AppState>) -> usize {
    let usage = load_usage();
    let mut new_apps = indexer::index_apps();
    apply_usage(&mut new_apps, &usage);
    let count = new_apps.len();
    *state.apps.lock().unwrap() = new_apps;
    count
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

#[tauri::command]
fn check_web_search(query: String) -> Option<web_search::WebSearchResult> {
    web_search::check(&query)
}

#[tauri::command]
fn get_google_fallback(query: String) -> web_search::WebSearchResult {
    web_search::google_fallback(&query)
}

#[tauri::command]
fn match_search_providers(query: String) -> Vec<web_search::WebSearchResult> {
    web_search::match_providers(&query)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_position(x: f64, y: f64) {
    save_window_position(&WindowPosition { x, y });
}

#[tauri::command]
fn load_position() -> Option<WindowPosition> {
    load_window_position()
}

#[tauri::command]
fn evaluate_input(query: String) -> Option<EvalResult> {
    if let Some(calc) = calculator::evaluate(&query) {
        return Some(EvalResult {
            result_type: "calculator".to_string(),
            expression: calc.expression,
            result: calc.result,
            display: calc.display,
            input_unit: None,
            output_unit: None,
        });
    }

    if let Some(conv) = converter::convert(&query) {
        return Some(EvalResult {
            result_type: "converter".to_string(),
            expression: conv.display.clone(),
            result: conv.output_value,
            display: conv.display,
            input_unit: Some(conv.input_unit),
            output_unit: Some(conv.output_unit),
        });
    }

    None
}

#[tauri::command]
fn is_first_launch() -> bool {
    !data_dir().join("config.json").exists()
}

#[tauri::command]
fn mark_first_launch_done() {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join("config.json"), r#"{"first_launch_done":true}"#);
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        apps: Mutex::new(Vec::new()),
        searcher: searcher::Searcher::new(),
        ready: Mutex::new(false),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                    if event.state == ShortcutState::Pressed && *shortcut == alt_space {
                        toggle_window(app);
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
            evaluate_input,
            check_web_search,
            get_google_fallback,
            match_search_providers,
            open_url,
            get_index_status,
            save_position,
            load_position,
            is_first_launch,
            mark_first_launch_done,
        ])
        .setup(|app| {
            // Register hotkey
            let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.global_shortcut().register(alt_space)?;

            // Build tray menu
            let show_item = MenuItem::with_id(
                app, "show", "Show Keystrike   (Alt+Space)", true, None::<&str>,
            )?;
            let reindex_item = MenuItem::with_id(
                app, "reindex", "Reindex Apps", true, None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;

            let mgr = app.autolaunch();
            if !mgr.is_enabled().unwrap_or(false) {
                let _ = mgr.enable();
            }
            let autostart_item = CheckMenuItem::with_id(
                app, "autostart", "Start with Windows", true, true, None::<&str>,
            )?;
            let autostart_ref = autostart_item.clone();

            let quit_item = MenuItem::with_id(
                app, "quit", "Quit Keystrike", true, None::<&str>,
            )?;

            let menu = Menu::with_items(
                app,
                &[&show_item, &reindex_item, &sep, &autostart_item, &quit_item],
            )?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("no default icon set in tauri.conf.json");

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Keystrike")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            show_window(app);
                        }
                        "reindex" => {
                            let handle = app.clone();
                            std::thread::spawn(move || {
                                let usage = load_usage();
                                let mut new_apps = indexer::index_apps();
                                apply_usage(&mut new_apps, &usage);
                                let count = new_apps.len();
                                let state = handle.state::<AppState>();
                                *state.apps.lock().unwrap() = new_apps;
                                eprintln!("[keystrike] Reindexed: {} apps", count);
                            });
                        }
                        "autostart" => {
                            let mgr = app.autolaunch();
                            let currently = mgr.is_enabled().unwrap_or(false);
                            if currently {
                                let _ = mgr.disable();
                                let _ = autostart_ref.set_checked(false);
                            } else {
                                let _ = mgr.enable();
                                let _ = autostart_ref.set_checked(true);
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Background indexing
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let usage = load_usage();
                let mut apps = indexer::index_apps();
                apply_usage(&mut apps, &usage);

                let state = handle.state::<AppState>();
                *state.apps.lock().unwrap() = apps;
                *state.ready.lock().unwrap() = true;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
