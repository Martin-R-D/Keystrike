use serde::Serialize;

struct Provider {
    prefix: &'static str,
    name: &'static str,
    url_template: &'static str,
    icon: &'static str,
}

const PROVIDERS: &[Provider] = &[
    Provider { prefix: "g", name: "Google", url_template: "https://www.google.com/search?q={query}", icon: "\u{1F50D}" },
    Provider { prefix: "yt", name: "YouTube", url_template: "https://www.youtube.com/results?search_query={query}", icon: "\u{25B6}\u{FE0F}" },
    Provider { prefix: "wiki", name: "Wikipedia", url_template: "https://en.wikipedia.org/wiki/Special:Search?search={query}", icon: "\u{1F4D6}" },
    Provider { prefix: "r", name: "Reddit", url_template: "https://www.reddit.com/search/?q={query}", icon: "\u{1F4AC}" },
    Provider { prefix: "gh", name: "GitHub", url_template: "https://github.com/search?q={query}", icon: "\u{1F419}" },
    Provider { prefix: "so", name: "Stack Overflow", url_template: "https://stackoverflow.com/search?q={query}", icon: "\u{1F4DA}" },
    Provider { prefix: "ddg", name: "DuckDuckGo", url_template: "https://duckduckgo.com/?q={query}", icon: "\u{1F986}" },
];

#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResult {
    pub provider_name: String,
    pub search_query: String,
    pub full_url: String,
    pub icon: String,
}

pub fn check(query: &str) -> Option<WebSearchResult> {
    let trimmed = query.trim();

    for provider in PROVIDERS {
        let with_space = format!("{} ", provider.prefix);
        if !trimmed.to_lowercase().starts_with(&with_space) {
            continue;
        }

        let search_query = trimmed[with_space.len()..].trim().to_string();
        let encoded = url_encode(&search_query);
        let full_url = provider.url_template.replace("{query}", &encoded);

        return Some(WebSearchResult {
            provider_name: provider.name.to_string(),
            search_query,
            full_url,
            icon: provider.icon.to_string(),
        });
    }

    None
}

pub fn google_fallback(query: &str) -> WebSearchResult {
    let encoded = url_encode(query.trim());
    WebSearchResult {
        provider_name: "Google".to_string(),
        search_query: query.trim().to_string(),
        full_url: format!("https://www.google.com/search?q={}", encoded),
        icon: "\u{1F50D}".to_string(),
    }
}

pub fn match_providers(query: &str) -> Vec<WebSearchResult> {
    let lower = query.trim().to_lowercase();
    if lower.is_empty() {
        return vec![];
    }

    PROVIDERS
        .iter()
        .filter(|p| p.prefix.starts_with(&lower))
        .map(|p| WebSearchResult {
            provider_name: p.name.to_string(),
            search_query: String::new(),
            full_url: format!("{} ", p.prefix),
            icon: p.icon.to_string(),
        })
        .collect()
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0x0F) as usize]));
            }
        }
    }
    out
}
