use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResult {
    pub provider_name: String,
    pub search_query: String,
    pub full_url: String,
    pub icon: String,
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

pub(crate) fn url_encode(s: &str) -> String {
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
