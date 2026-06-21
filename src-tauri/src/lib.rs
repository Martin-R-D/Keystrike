mod indexer;
mod searcher;

use std::sync::Mutex;

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
fn launch_app(
    id: u64,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
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

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }

    Ok(())
}

#[tauri::command]
fn reindex_apps(state: State<'_, AppState>) -> usize {
    let new_apps = indexer::index_apps();
    let count = new_apps.len();
    *state.apps.lock().unwrap() = new_apps;
    count
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
            reindex_apps
        ])
        .setup(|app| {
            let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.global_shortcut().register(alt_space)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
