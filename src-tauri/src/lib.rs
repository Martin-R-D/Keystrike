mod aliases;
mod calculator;
mod clipboard_history;
mod color;
mod commands;
mod converter;
mod currency;
mod file_search;
mod hotkey;
mod indexer;
mod notes;
mod pins;
mod quick_actions;
mod scripts;
mod searcher;
mod theme;
mod web_search;
mod window_switcher;

use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use commands::{AllCommandsConfig, CustomCommand, CustomCommandInput};

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use indexer::AppEntry;
use searcher::SearchResult;

/// The currently registered global hotkey (e.g. "Alt+Space").
struct CurrentHotkey(Mutex<String>);

/// Latest exchange rates (relative to USD), if any have been loaded.
struct CurrencyRates(Mutex<Option<currency::Rates>>);

/// Clipboard history plus the setting that switches recording on or off.
struct ClipboardState {
    history: Mutex<clipboard_history::History>,
    enabled: AtomicBool,
}

/// Index of file and folder names in the user's main folders.
struct FileIndex(Mutex<Vec<file_search::FileEntry>>);

/// The tray's "Show Keystrike" item, kept so its label can show the hotkey.
struct ShowMenuItem(MenuItem<tauri::Wry>);

struct AppState {
    apps: Mutex<Vec<AppEntry>>,
    searcher: searcher::Searcher,
    ready: Mutex<bool>,
    pins: Mutex<Vec<pins::Pin>>,
    aliases: Mutex<Vec<aliases::Alias>>,
}

pub(crate) fn data_dir() -> PathBuf {
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
    color_hex: Option<String>,
    color_rgb: Option<String>,
    color_hsl: Option<String>,
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
    let pin_list = state.pins.lock().unwrap();
    if query.is_empty() {
        return searcher::most_used(&apps, 8, &pin_list);
    }

    let mut results = state.searcher.search(&query, &apps, 8, &pin_list);

    // An exact alias match always wins the top slot.
    let alias_list = state.aliases.lock().unwrap();
    if let Some(alias) = aliases::find(&alias_list, &query) {
        if let Some(app) = apps.iter().find(|a| a.launch_path == alias.launch_path) {
            results.retain(|r| r.id != app.id);
            results.insert(
                0,
                SearchResult {
                    id: app.id,
                    name: app.name.clone(),
                    path: app.path.clone(),
                    score: f64::MAX,
                    is_pinned: pins::is_pinned(&pin_list, &app.launch_path),
                },
            );
            results.truncate(8);
        }
    }
    results
}

/// Look up an app, count the launch towards its ranking and return
/// (name, launch_path).
fn record_launch(id: u64, state: &AppState) -> Result<(String, String), String> {
    let mut apps = state.apps.lock().unwrap();
    let entry = apps
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("App not found")?;

    let launch_path = entry.launch_path.clone();
    let name = entry.name.clone();
    entry.use_count += 1;

    save_usage(&apps);
    Ok((name, launch_path))
}

#[tauri::command]
fn launch_app(id: u64, state: State<'_, AppState>) -> Result<String, String> {
    let (name, launch_path) = record_launch(id, &state)?;

    eprintln!("[keystrike] Launching: {}", launch_path);

    std::process::Command::new("explorer")
        .arg(&launch_path)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", name, e))?;

    Ok(name)
}

/// Launch an app elevated (Windows shows the UAC prompt). The path is passed
/// through an environment variable so it is never parsed as PowerShell code.
#[tauri::command]
fn launch_app_admin(id: u64, state: State<'_, AppState>) -> Result<String, String> {
    use std::os::windows::process::CommandExt;

    let (name, launch_path) = record_launch(id, &state)?;

    eprintln!("[keystrike] Launching as administrator: {}", launch_path);

    std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Process -FilePath $env:KEYSTRIKE_TARGET -Verb RunAs",
        ])
        .env("KEYSTRIKE_TARGET", &launch_path)
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Failed to launch {} as administrator: {}", name, e))?;

    Ok(name)
}

#[tauri::command]
fn reindex_apps(state: State<'_, AppState>, app: tauri::AppHandle) -> usize {
    rebuild_file_index(app);
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
fn get_google_fallback(query: String) -> web_search::WebSearchResult {
    web_search::google_fallback(&query)
}

#[tauri::command]
fn get_all_commands(commands: State<'_, Arc<Mutex<AllCommandsConfig>>>) -> AllCommandsConfig {
    commands.lock().unwrap().clone()
}

#[tauri::command]
fn search_snippets(
    query: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Vec<commands::CommandResult> {
    commands::search_snippets(&commands.lock().unwrap(), &query)
}

#[tauri::command]
fn check_command(
    query: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Option<commands::CommandResult> {
    let cfg = commands.lock().unwrap();
    commands::check_command(&cfg, &query)
}

#[tauri::command]
fn match_command_prefixes(
    query: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Vec<commands::PrefixHint> {
    let cfg = commands.lock().unwrap();
    commands::match_prefixes(&cfg, &query)
}

#[tauri::command]
fn update_command_keyword(
    command_id: String,
    new_keyword: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<(), String> {
    let mut cfg = commands.lock().unwrap();
    commands::update_builtin_keyword(&mut cfg, &command_id, &new_keyword)?;
    commands::save(&cfg)?;
    Ok(())
}

#[tauri::command]
fn reset_commands_to_defaults(
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> AllCommandsConfig {
    let mut cfg = commands.lock().unwrap();
    *cfg = commands::reset_builtin(&cfg);
    let _ = commands::save(&cfg);
    cfg.clone()
}

#[tauri::command]
fn create_custom_command(
    command: CustomCommandInput,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<CustomCommand, String> {
    let mut cfg = commands.lock().unwrap();
    let created = commands::create_custom(&mut cfg, command)?;
    commands::save(&cfg)?;
    Ok(created)
}

#[tauri::command]
fn update_custom_command(
    id: String,
    command: CustomCommandInput,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<CustomCommand, String> {
    let mut cfg = commands.lock().unwrap();
    let updated = commands::update_custom(&mut cfg, &id, command)?;
    commands::save(&cfg)?;
    Ok(updated)
}

#[tauri::command]
fn delete_custom_command(
    id: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<(), String> {
    let mut cfg = commands.lock().unwrap();
    commands::delete_custom(&mut cfg, &id);
    commands::save(&cfg)?;
    Ok(())
}

/// Copy a snippet to the clipboard and auto-clear it after 60 seconds, but
/// only if the clipboard still holds the same text (so we never clobber
/// something the user copied in the meantime).
#[tauri::command]
fn execute_snippet(content: String, clipboard_state: State<'_, ClipboardState>) -> Result<(), String> {
    use arboard::Clipboard;

    // Snippets often hold sensitive text; keep them out of the history.
    clipboard_state.history.lock().unwrap().ignore_text(&content);

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(content.clone()).map_err(|e| e.to_string())?;
    drop(clipboard);

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60));
        if let Ok(mut cb) = Clipboard::new() {
            if let Ok(current) = cb.get_text() {
                if current == content {
                    let _ = cb.clear();
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn search_clipboard_history(
    query: String,
    state: State<'_, ClipboardState>,
) -> Vec<clipboard_history::Entry> {
    state.history.lock().unwrap().search(&query)
}

#[tauri::command]
fn remove_clipboard_entry(id: u64, state: State<'_, ClipboardState>) -> bool {
    state.history.lock().unwrap().remove(id)
}

#[tauri::command]
fn clear_clipboard_history(state: State<'_, ClipboardState>) {
    state.history.lock().unwrap().clear();
}

#[tauri::command]
fn get_clipboard_enabled(state: State<'_, ClipboardState>) -> bool {
    state.enabled.load(Ordering::Relaxed)
}

/// Turn clipboard history on or off. Turning it off also wipes what was kept.
#[tauri::command]
fn set_clipboard_enabled(enabled: bool, state: State<'_, ClipboardState>) -> Result<(), String> {
    clipboard_history::save_enabled(enabled)?;
    state.enabled.store(enabled, Ordering::Relaxed);
    if !enabled {
        state.history.lock().unwrap().clear();
    }
    Ok(())
}

#[tauri::command]
fn search_windows(query: String) -> Vec<window_switcher::WindowInfo> {
    window_switcher::filter(window_switcher::list(), &query, 8)
}

#[tauri::command]
fn focus_window(hwnd: i64) -> Result<(), String> {
    window_switcher::focus(hwnd)
}

#[tauri::command]
fn search_files(query: String, index: State<'_, FileIndex>) -> Vec<file_search::FileHit> {
    file_search::search(&index.0.lock().unwrap(), &query, 8)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = file_search::ensure_exists(&path)?;
    open::that(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    file_search::ensure_exists(&path)?;
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Rescan the user folders in the background and swap in the new index.
fn rebuild_file_index(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let index = file_search::build_index(&file_search::default_roots());
        eprintln!("[keystrike] Indexed {} files and folders", index.len());
        *handle.state::<FileIndex>().0.lock().unwrap() = index;
    });
}

/// Scripts whose keyword does not clash with a built-in or custom command
/// (commands always win, so a clashing script could never be reached).
fn usable_scripts(cfg: &AllCommandsConfig) -> Vec<scripts::Script> {
    scripts::discover(&scripts::scripts_dir())
        .into_iter()
        .filter(|s| commands::validate_keyword(cfg, None, &s.keyword).is_ok())
        .collect()
}

#[tauri::command]
fn get_scripts(commands: State<'_, Arc<Mutex<AllCommandsConfig>>>) -> Vec<scripts::Script> {
    usable_scripts(&commands.lock().unwrap())
}

/// Run a script by keyword. Runs on a worker thread so a slow script never
/// freezes the window.
#[tauri::command]
async fn run_script(
    keyword: String,
    args: String,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<Vec<scripts::ScriptResult>, String> {
    let script = {
        let cfg = commands.lock().unwrap();
        usable_scripts(&cfg)
            .into_iter()
            .find(|s| s.keyword == keyword.to_lowercase())
            .ok_or("Script not found")?
    };
    let args: Vec<String> = args.split_whitespace().map(String::from).collect();
    tauri::async_runtime::spawn_blocking(move || scripts::run(&script, &args))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_data_folder() -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_scripts_folder() -> Result<(), String> {
    let dir = scripts::ensure_dir()?;
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_theme() -> theme::ThemeConfig {
    theme::load()
}

#[tauri::command]
fn set_theme(theme: theme::ThemeConfig) -> Result<theme::ThemeConfig, String> {
    let valid = theme::validate(&theme)?;
    theme::save(&valid)?;
    Ok(valid)
}

#[tauri::command]
fn get_aliases(state: State<'_, AppState>) -> Vec<aliases::Alias> {
    state.aliases.lock().unwrap().clone()
}

#[tauri::command]
fn set_alias(
    alias: String,
    app_id: u64,
    state: State<'_, AppState>,
    commands: State<'_, Arc<Mutex<AllCommandsConfig>>>,
) -> Result<aliases::Alias, String> {
    // Command keywords take precedence in the search bar, so an alias that
    // collides with one could never be reached.
    commands::validate_keyword(&commands.lock().unwrap(), None, &alias)
        .map_err(|e| format!("{} (as a command keyword)", e))?;

    let (name, launch_path) = {
        let apps = state.apps.lock().unwrap();
        let entry = apps.iter().find(|a| a.id == app_id).ok_or("App not found")?;
        (entry.name.clone(), entry.launch_path.clone())
    };

    let mut list = state.aliases.lock().unwrap();
    aliases::set(&mut list, &alias, &name, &launch_path)?;
    aliases::save(&list)?;
    Ok(list.iter().find(|a| a.launch_path == launch_path && a.alias == alias.trim().to_lowercase()).cloned().unwrap())
}

#[tauri::command]
fn remove_alias(alias: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut list = state.aliases.lock().unwrap();
    aliases::remove(&mut list, &alias);
    aliases::save(&list)
}

#[tauri::command]
fn search_quick_actions(query: String) -> Vec<quick_actions::QuickAction> {
    quick_actions::search(&query)
}

#[tauri::command]
fn run_quick_action(id: String) -> Result<(), String> {
    eprintln!("[keystrike] Quick action: {}", id);
    quick_actions::run(&id)
}

#[tauri::command]
fn get_hotkey(current: State<'_, CurrentHotkey>) -> String {
    current.0.lock().unwrap().clone()
}

/// Rebind the global hotkey. The new shortcut is registered before the old one
/// is released, so a failure (invalid, or taken by another app) leaves the
/// existing hotkey working.
#[tauri::command]
fn set_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    current: State<'_, CurrentHotkey>,
    show_item: State<'_, ShowMenuItem>,
) -> Result<String, String> {
    let new_shortcut = hotkey::parse(&hotkey)?;
    let mut cur = current.0.lock().unwrap();
    let old_shortcut = hotkey::parse(&cur).map_err(|e| e.to_string())?;

    if new_shortcut != old_shortcut {
        let gs = app.global_shortcut();
        gs.register(new_shortcut)
            .map_err(|e| format!("Could not register hotkey (it may be in use): {}", e))?;
        let _ = gs.unregister(old_shortcut);
    }

    hotkey::save(&hotkey)?;
    *cur = hotkey.trim().to_string();
    let _ = show_item
        .0
        .set_text(format!("Show Keystrike   ({})", hotkey::display(&cur)));
    Ok(cur.clone())
}

#[tauri::command]
fn reset_hotkey(
    app: tauri::AppHandle,
    current: State<'_, CurrentHotkey>,
    show_item: State<'_, ShowMenuItem>,
) -> Result<String, String> {
    set_hotkey(hotkey::DEFAULT_HOTKEY.to_string(), app, current, show_item)
}

#[tauri::command]
fn toggle_pin(id: u64, state: State<'_, AppState>) -> Result<bool, String> {
    let apps = state.apps.lock().unwrap();
    let entry = apps.iter().find(|a| a.id == id).ok_or("App not found")?;
    let name = entry.name.clone();
    let launch_path = entry.launch_path.clone();
    drop(apps);

    let mut pin_list = state.pins.lock().unwrap();
    let now_pinned = pins::toggle(&mut pin_list, &name, &launch_path);
    pins::save(&pin_list)?;
    Ok(now_pinned)
}

#[tauri::command]
fn get_pins(state: State<'_, AppState>) -> Vec<pins::Pin> {
    state.pins.lock().unwrap().clone()
}

#[tauri::command]
fn save_note(text: String) -> Result<(), String> {
    notes::save(&text)
}

#[tauri::command]
fn get_notes() -> Vec<notes::NoteEntry> {
    notes::list()
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
fn evaluate_input(query: String, rates: State<'_, CurrencyRates>) -> Option<EvalResult> {
    if let Some(col) = color::parse_color(&query) {
        return Some(EvalResult {
            result_type: "color".to_string(),
            expression: query.clone(),
            result: 0.0,
            display: col.hex.clone(),
            input_unit: None,
            output_unit: None,
            color_hex: Some(col.hex),
            color_rgb: Some(col.rgb),
            color_hsl: Some(col.hsl),
        });
    }

    if let Some(calc) = calculator::evaluate(&query) {
        return Some(EvalResult {
            result_type: "calculator".to_string(),
            expression: calc.expression,
            result: calc.result,
            display: calc.display,
            input_unit: None,
            output_unit: None,
            color_hex: None,
            color_rgb: None,
            color_hsl: None,
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
            color_hex: None,
            color_rgb: None,
            color_hsl: None,
        });
    }

    // Currency comes last so unit conversions keep their existing behaviour.
    if let Some(rates) = rates.0.lock().unwrap().as_ref() {
        if let Some(cur) = currency::convert(&query, rates) {
            return Some(EvalResult {
                result_type: "converter".to_string(),
                expression: cur.display.clone(),
                result: cur.result,
                display: cur.display,
                input_unit: Some(cur.from),
                output_unit: Some(cur.to),
                color_hex: None,
                color_rgb: None,
                color_hsl: None,
            });
        }
    }

    None
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    // If the settings window already exists, just focus it.
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Keystrike Settings")
    .inner_size(700.0, 500.0)
    .min_inner_size(600.0, 400.0)
    .resizable(true)
    .decorations(true)
    .center()
    .skip_taskbar(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
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
        pins: Mutex::new(pins::load()),
        aliases: Mutex::new(aliases::load()),
    };

    let commands_config = Arc::new(Mutex::new(commands::load()));
    let initial_hotkey = hotkey::load();

    tauri::Builder::default()
        .manage(app_state)
        .manage(commands_config)
        .manage(CurrentHotkey(Mutex::new(initial_hotkey)))
        .manage(FileIndex(Mutex::new(Vec::new())))
        .manage(CurrencyRates(Mutex::new(currency::load_cached())))
        .manage(ClipboardState {
            history: Mutex::new(clipboard_history::History::new()),
            enabled: AtomicBool::new(clipboard_history::load_enabled()),
        })
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Only the Keystrike hotkey is ever registered.
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            search_apps,
            launch_app,
            launch_app_admin,
            reindex_apps,
            search_running_apps,
            close_process,
            evaluate_input,
            get_google_fallback,
            open_url,
            get_index_status,
            save_position,
            load_position,
            is_first_launch,
            mark_first_launch_done,
            open_settings_window,
            get_all_commands,
            check_command,
            search_snippets,
            match_command_prefixes,
            update_command_keyword,
            reset_commands_to_defaults,
            create_custom_command,
            update_custom_command,
            delete_custom_command,
            execute_snippet,
            save_note,
            get_notes,
            toggle_pin,
            get_pins,
            search_clipboard_history,
            remove_clipboard_entry,
            clear_clipboard_history,
            get_clipboard_enabled,
            set_clipboard_enabled,
            search_windows,
            focus_window,
            search_files,
            open_path,
            reveal_path,
            get_scripts,
            run_script,
            open_scripts_folder,
            open_data_folder,
            get_theme,
            set_theme,
            get_aliases,
            set_alias,
            remove_alias,
            search_quick_actions,
            run_quick_action,
            get_hotkey,
            set_hotkey,
            reset_hotkey,
        ])
        .setup(|app| {
            // Register the saved hotkey; if it is unavailable (e.g. taken by
            // another app since it was saved) fall back to the default.
            let saved_hotkey = app.state::<CurrentHotkey>().0.lock().unwrap().clone();
            let registered = match hotkey::parse(&saved_hotkey)
                .and_then(|s| app.global_shortcut().register(s).map_err(|e| e.to_string()))
            {
                Ok(()) => saved_hotkey,
                Err(e) => {
                    eprintln!("[keystrike] Hotkey '{}' unavailable ({}), using default", saved_hotkey, e);
                    let default = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                    app.global_shortcut().register(default)?;
                    hotkey::DEFAULT_HOTKEY.to_string()
                }
            };
            *app.state::<CurrentHotkey>().0.lock().unwrap() = registered.clone();

            // Build tray menu
            let show_item = MenuItem::with_id(
                app,
                "show",
                format!("Show Keystrike   ({})", hotkey::display(&registered)),
                true,
                None::<&str>,
            )?;
            app.manage(ShowMenuItem(show_item.clone()));
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
                            rebuild_file_index(app.clone());
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

            // Keep exchange rates fresh in the background; failures just leave
            // the cached rates (or none) in place and are retried later.
            let rates_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let stale = currency::is_stale(&rates_handle.state::<CurrencyRates>().0.lock().unwrap());
                let mut wait = 60 * 60;
                if stale {
                    match currency::fetch() {
                        Ok(fresh) => {
                            *rates_handle.state::<CurrencyRates>().0.lock().unwrap() = Some(fresh);
                            eprintln!("[keystrike] Exchange rates updated");
                        }
                        Err(e) => {
                            eprintln!("[keystrike] Exchange rate update failed: {}", e);
                            wait = 10 * 60;
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(wait));
            });

            // Watch the clipboard and record text copies while history is on.
            let clip_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut clipboard = match arboard::Clipboard::new() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[keystrike] Clipboard history unavailable: {}", e);
                        return;
                    }
                };
                let mut last_seen: Option<String> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let state = clip_handle.state::<ClipboardState>();
                    if !state.enabled.load(Ordering::Relaxed) {
                        last_seen = None;
                        continue;
                    }
                    // Non-text clipboard content is simply skipped.
                    let Ok(text) = clipboard.get_text() else { continue };
                    if last_seen.as_deref() == Some(text.as_str()) {
                        continue;
                    }
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    state.history.lock().unwrap().record(&text, now);
                    last_seen = Some(text);
                }
            });

            rebuild_file_index(app.handle().clone());

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
