use std::collections::BTreeMap;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::web_search::url_encode;

/// A built-in command. The keyword can be edited; the command cannot be
/// deleted. URLs/labels/descriptions are fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltinCommand {
    pub keyword: String,
    #[serde(rename = "type")]
    pub cmd_type: String, // "url" | "system"
    pub label: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub fallback: Option<String>,
    pub description: String,
    pub editable_keyword: bool,
    pub deletable: bool,
}

/// A user-defined command. Fully editable and deletable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomCommand {
    pub id: String,
    pub keyword: String,
    #[serde(rename = "type")]
    pub cmd_type: String, // "url" | "snippet"
    pub label: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub fallback: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllCommandsConfig {
    pub builtin: BTreeMap<String, BuiltinCommand>,
    #[serde(default)]
    pub custom: Vec<CustomCommand>,
}

/// Fields sent from the UI when creating/updating a custom command.
#[derive(Debug, Clone, Deserialize)]
pub struct CustomCommandInput {
    pub keyword: String,
    #[serde(rename = "type")]
    pub cmd_type: String,
    pub label: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub fallback: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub description: String,
}

/// A resolved command match returned to the search bar.
#[derive(Debug, Clone, Serialize)]
pub struct CommandResult {
    pub id: String,
    pub kind: String, // "url" | "snippet"
    pub label: String,
    pub icon: String,
    pub query: String,
    pub url: Option<String>,
    pub content: Option<String>,
}

/// A partial-keyword hint shown while typing.
#[derive(Debug, Clone, Serialize)]
pub struct PrefixHint {
    pub keyword: String,
    pub label: String,
    pub icon: String,
    pub kind: String,
}

// (id, keyword, type, label, url-template, fallback, description)
const BUILTIN_DEFAULTS: &[(&str, &str, &str, &str, &str, &str, &str)] = &[
    ("google", "g", "url", "Google Search", "https://www.google.com/search?q={query}", "https://www.google.com", "Search Google in your browser"),
    ("youtube", "yt", "url", "YouTube Search", "https://www.youtube.com/results?search_query={query}", "https://www.youtube.com", "Search YouTube in your browser"),
    ("wikipedia", "wiki", "url", "Wikipedia Search", "https://en.wikipedia.org/wiki/Special:Search?search={query}", "https://en.wikipedia.org", "Search Wikipedia in your browser"),
    ("reddit", "r", "url", "Reddit Search", "https://www.reddit.com/search/?q={query}", "https://www.reddit.com", "Search Reddit in your browser"),
    ("github", "gh", "url", "GitHub Search", "https://github.com/search?q={query}", "https://github.com", "Search GitHub in your browser"),
    ("stackoverflow", "so", "url", "Stack Overflow Search", "https://stackoverflow.com/search?q={query}", "https://stackoverflow.com", "Search Stack Overflow in your browser"),
    ("duckduckgo", "ddg", "url", "DuckDuckGo Search", "https://duckduckgo.com/?q={query}", "https://duckduckgo.com", "Search DuckDuckGo in your browser"),
];

const CLOSE_DEFAULT_KEYWORD: &str = "/close";

/// Emoji icon for a built-in command id.
fn builtin_icon(id: &str) -> &'static str {
    match id {
        "google" => "\u{1F50D}",
        "youtube" => "\u{25B6}\u{FE0F}",
        "wikipedia" => "\u{1F4D6}",
        "reddit" => "\u{1F4AC}",
        "github" => "\u{1F419}",
        "stackoverflow" => "\u{1F4DA}",
        "duckduckgo" => "\u{1F986}",
        "close" => "\u{2715}",
        _ => "\u{1F517}",
    }
}

fn custom_icon(cmd_type: &str) -> &'static str {
    match cmd_type {
        "snippet" => "\u{1F4CB}", // clipboard
        _ => "\u{1F517}",          // link
    }
}

impl AllCommandsConfig {
    pub fn defaults() -> Self {
        let mut builtin = BTreeMap::new();
        for (id, kw, ty, label, url, fallback, desc) in BUILTIN_DEFAULTS {
            builtin.insert(
                id.to_string(),
                BuiltinCommand {
                    keyword: kw.to_string(),
                    cmd_type: ty.to_string(),
                    label: label.to_string(),
                    url: Some(url.to_string()),
                    fallback: Some(fallback.to_string()),
                    description: desc.to_string(),
                    editable_keyword: true,
                    deletable: false,
                },
            );
        }
        builtin.insert(
            "close".to_string(),
            BuiltinCommand {
                keyword: CLOSE_DEFAULT_KEYWORD.to_string(),
                cmd_type: "system".to_string(),
                label: "Close App".to_string(),
                url: None,
                fallback: None,
                description: "Force-closes a running application".to_string(),
                editable_keyword: true,
                deletable: false,
            },
        );
        AllCommandsConfig {
            builtin,
            custom: Vec::new(),
        }
    }

    /// Ensure every default built-in command exists (backfill after loading an
    /// older/partial config).
    fn fill_missing(&mut self) {
        let defaults = Self::defaults();
        for (id, cmd) in defaults.builtin {
            self.builtin.entry(id).or_insert(cmd);
        }
    }

    /// (id, keyword, label) for every command, built-in and custom.
    fn entries(&self) -> Vec<(String, String, String)> {
        let mut out = Vec::new();
        for (id, c) in &self.builtin {
            out.push((id.clone(), c.keyword.clone(), c.label.clone()));
        }
        for c in &self.custom {
            out.push((c.id.clone(), c.keyword.clone(), c.label.clone()));
        }
        out
    }
}

/// Normalize a keyword for duplicate comparison: lowercased with a single
/// leading slash stripped, so "gh"/"/gh" and "close"/"/close" collide.
pub fn normalize(keyword: &str) -> String {
    keyword.trim_start_matches('/').to_lowercase()
}

fn config_path() -> std::path::PathBuf {
    crate::data_dir().join("commands.json")
}

pub fn load() -> AllCommandsConfig {
    match fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str::<AllCommandsConfig>(&s).ok())
    {
        Some(mut cfg) => {
            cfg.fill_missing();
            cfg
        }
        None => AllCommandsConfig::defaults(),
    }
}

pub fn save(cfg: &AllCommandsConfig) -> Result<(), String> {
    let dir = crate::data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())
}

/// Generate a unique-ish id based on the current timestamp.
fn generate_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("cmd-{}", nanos)
}

/// Validate a keyword against every other command. Returns the trimmed keyword
/// or an error message (including which command already uses it).
pub fn validate_keyword(
    cfg: &AllCommandsConfig,
    exclude_id: Option<&str>,
    keyword: &str,
) -> Result<String, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Err("Keyword cannot be empty".to_string());
    }
    if kw.chars().any(|c| c.is_whitespace()) {
        return Err("Keyword cannot contain spaces".to_string());
    }

    let target = normalize(kw);
    for (id, existing, label) in cfg.entries() {
        if Some(id.as_str()) == exclude_id {
            continue;
        }
        if normalize(&existing) == target {
            return Err(format!("Already used by {}", label));
        }
    }
    Ok(kw.to_string())
}

/// Validate the type-specific required fields of a custom command input.
fn validate_input_fields(input: &CustomCommandInput) -> Result<(), String> {
    if input.label.trim().is_empty() {
        return Err("Label is required".to_string());
    }
    match input.cmd_type.as_str() {
        "url" => {
            if input.url.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return Err("URL is required".to_string());
            }
        }
        "snippet" => {
            if input.content.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return Err("Content is required".to_string());
            }
        }
        other => return Err(format!("Unknown command type: {}", other)),
    }
    Ok(())
}

pub fn create_custom(
    cfg: &mut AllCommandsConfig,
    input: CustomCommandInput,
) -> Result<CustomCommand, String> {
    let keyword = validate_keyword(cfg, None, &input.keyword)?;
    validate_input_fields(&input)?;

    let cmd = CustomCommand {
        id: generate_id(),
        keyword,
        cmd_type: input.cmd_type,
        label: input.label.trim().to_string(),
        url: input.url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        fallback: input.fallback.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        content: input.content,
        description: input.description,
    };
    cfg.custom.push(cmd.clone());
    Ok(cmd)
}

pub fn update_custom(
    cfg: &mut AllCommandsConfig,
    id: &str,
    input: CustomCommandInput,
) -> Result<CustomCommand, String> {
    if !cfg.custom.iter().any(|c| c.id == id) {
        return Err("Command not found".to_string());
    }
    let keyword = validate_keyword(cfg, Some(id), &input.keyword)?;
    validate_input_fields(&input)?;

    let slot = cfg.custom.iter_mut().find(|c| c.id == id).unwrap();
    slot.keyword = keyword;
    slot.cmd_type = input.cmd_type;
    slot.label = input.label.trim().to_string();
    slot.url = input.url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    slot.fallback = input.fallback.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    slot.content = input.content;
    slot.description = input.description;
    Ok(slot.clone())
}

pub fn delete_custom(cfg: &mut AllCommandsConfig, id: &str) {
    cfg.custom.retain(|c| c.id != id);
}

/// Edit a built-in command's keyword.
pub fn update_builtin_keyword(
    cfg: &mut AllCommandsConfig,
    command_id: &str,
    new_keyword: &str,
) -> Result<(), String> {
    match cfg.builtin.get(command_id) {
        Some(c) if !c.editable_keyword => {
            return Err("This command's keyword cannot be edited".to_string())
        }
        None => return Err(format!("Unknown command: {}", command_id)),
        _ => {}
    }
    let keyword = validate_keyword(cfg, Some(command_id), new_keyword)?;
    cfg.builtin.get_mut(command_id).unwrap().keyword = keyword;
    Ok(())
}

/// Revert built-in keywords (and built-in metadata) to defaults, keeping any
/// custom commands.
pub fn reset_builtin(cfg: &AllCommandsConfig) -> AllCommandsConfig {
    let mut fresh = AllCommandsConfig::defaults();
    fresh.custom = cfg.custom.clone();
    fresh
}

/// Resolve the best command match for a query (built-in url + custom commands,
/// excluding the system/close command which is handled separately).
pub fn check_command(cfg: &AllCommandsConfig, query: &str) -> Option<CommandResult> {
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    let ql = q.to_lowercase();

    // Built-in url commands first, then custom (order is irrelevant because
    // duplicate keywords are prevented).
    for (id, c) in &cfg.builtin {
        if c.cmd_type == "system" {
            continue;
        }
        if let Some(arg) = match_keyword(&ql, q, &c.keyword) {
            return Some(resolve_url(id, &c.label, builtin_icon(id), c.url.as_deref(), c.fallback.as_deref(), arg));
        }
    }
    for c in &cfg.custom {
        if let Some(arg) = match_keyword(&ql, q, &c.keyword) {
            return Some(match c.cmd_type.as_str() {
                "snippet" => CommandResult {
                    id: c.id.clone(),
                    kind: "snippet".to_string(),
                    label: c.label.clone(),
                    icon: custom_icon("snippet").to_string(),
                    query: arg.to_string(),
                    url: None,
                    content: Some(c.content.clone().unwrap_or_default()),
                },
                _ => resolve_url(&c.id, &c.label, custom_icon("url"), c.url.as_deref(), c.fallback.as_deref(), arg),
            });
        }
    }
    None
}

/// Returns the (trimmed) argument if `query` invokes `keyword` exactly or as a
/// `keyword <arg>` prefix; `None` otherwise.
fn match_keyword<'a>(query_lower: &str, query_raw: &'a str, keyword: &str) -> Option<&'a str> {
    let kw = keyword.to_lowercase();
    if query_lower == kw {
        Some("")
    } else if query_lower.starts_with(&format!("{} ", kw)) {
        Some(query_raw[keyword.len()..].trim())
    } else {
        None
    }
}

fn resolve_url(
    id: &str,
    label: &str,
    icon: &str,
    url: Option<&str>,
    fallback: Option<&str>,
    arg: &str,
) -> CommandResult {
    let template = url.unwrap_or("");
    let is_search = template.contains("{query}");
    let full = if is_search {
        if !arg.is_empty() {
            template.replace("{query}", &url_encode(arg))
        } else if let Some(fb) = fallback.filter(|s| !s.is_empty()) {
            fb.to_string()
        } else {
            template.replace("{query}", "")
        }
    } else {
        template.to_string()
    };
    CommandResult {
        id: id.to_string(),
        kind: "url".to_string(),
        label: label.to_string(),
        icon: icon.to_string(),
        // Only surface the typed query for search-style (templated) URLs.
        query: if is_search { arg.to_string() } else { String::new() },
        url: Some(full),
        content: None,
    }
}

/// Commands whose keyword begins with the typed text (for hints while typing).
pub fn match_prefixes(cfg: &AllCommandsConfig, query: &str) -> Vec<PrefixHint> {
    let lower = query.trim().to_lowercase();
    if lower.is_empty() {
        return vec![];
    }
    let mut hints = Vec::new();
    for (id, c) in &cfg.builtin {
        if c.cmd_type == "system" {
            continue;
        }
        if c.keyword.to_lowercase().starts_with(&lower) {
            hints.push(PrefixHint {
                keyword: c.keyword.clone(),
                label: c.label.clone(),
                icon: builtin_icon(id).to_string(),
                kind: c.cmd_type.clone(),
            });
        }
    }
    for c in &cfg.custom {
        if c.keyword.to_lowercase().starts_with(&lower) {
            hints.push(PrefixHint {
                keyword: c.keyword.clone(),
                label: c.label.clone(),
                icon: custom_icon(&c.cmd_type).to_string(),
                kind: c.cmd_type.clone(),
            });
        }
    }
    hints
}
