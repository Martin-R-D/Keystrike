use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEntry {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub launch_path: String,
    pub use_count: u64,
    pub is_link: bool,
}

pub fn index_apps() -> Vec<AppEntry> {
    let mut apps = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut next_id: u64 = 0;

    for dir in scan_directories() {
        if !dir.exists() {
            continue;
        }
        for entry in WalkDir::new(&dir)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let ext = match path.extension() {
                Some(e) => e.to_string_lossy().to_lowercase(),
                None => continue,
            };

            let app = match ext.as_str() {
                "lnk" => process_lnk(path, &mut next_id),
                "exe" => process_exe(path, &mut next_id),
                _ => None,
            };

            if let Some(app) = app {
                let key = app.name.to_lowercase();
                if seen.insert(key) {
                    apps.push(app);
                }
            }
        }
    }

    eprintln!("[keystrike] Indexed {} apps", apps.len());
    apps
}

fn scan_directories() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from(r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs"),
        PathBuf::from(r"C:\Users\Public\Desktop"),
    ];

    if let Ok(appdata) = env::var("APPDATA") {
        dirs.push(PathBuf::from(&appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }

    if let Ok(local) = env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(&local).join("Programs"));
        dirs.push(PathBuf::from(&local).join(r"Microsoft\WindowsApps"));
    }

    if let Ok(profile) = env::var("USERPROFILE") {
        dirs.push(PathBuf::from(&profile).join("Desktop"));
    }

    dirs
}

fn process_lnk(path: &Path, next_id: &mut u64) -> Option<AppEntry> {
    let name = path.file_stem()?.to_string_lossy().to_string();

    let lower = name.to_lowercase();
    if lower.contains("uninstall") || lower.contains("readme") || lower.contains("help") {
        return None;
    }

    let clean_launch = dunce::simplified(path).to_string_lossy().to_string();

    let path_owned = path.to_path_buf();
    let resolved_target = std::panic::catch_unwind(|| {
        lnk::ShellLink::open(&path_owned, encoding_rs::WINDOWS_1252)
    })
    .ok()
    .and_then(|r| r.ok())
    .and_then(|link| {
        link.link_info()
            .as_ref()
            .and_then(|info| info.local_base_path())
            .map(|s| s.to_string())
    });

    let display_path = resolved_target.unwrap_or_else(|| clean_launch.clone());
    let clean_display = dunce::simplified(Path::new(&display_path))
        .to_string_lossy()
        .to_string();

    let id = *next_id;
    *next_id += 1;

    Some(AppEntry {
        id,
        name,
        path: clean_display,
        launch_path: clean_launch,
        use_count: 0,
        is_link: true,
    })
}

fn process_exe(path: &Path, next_id: &mut u64) -> Option<AppEntry> {
    let name = path.file_stem()?.to_string_lossy().to_string();
    let clean = dunce::simplified(path).to_string_lossy().to_string();

    let id = *next_id;
    *next_id += 1;

    Some(AppEntry {
        id,
        name,
        path: clean.clone(),
        launch_path: clean,
        use_count: 0,
        is_link: false,
    })
}
