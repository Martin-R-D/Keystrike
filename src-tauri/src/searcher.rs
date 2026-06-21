use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;

use crate::indexer::AppEntry;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub score: f64,
}

pub fn search(query: &str, apps: &[AppEntry], max_results: usize) -> Vec<SearchResult> {
    let matcher = SkimMatcherV2::default();

    let mut scored: Vec<SearchResult> = apps
        .iter()
        .filter_map(|app| {
            let fuzzy_score = matcher.fuzzy_match(&app.name, query)? as f64;
            let combined = fuzzy_score * 0.7 + app.use_count as f64 * 0.3;
            Some(SearchResult {
                id: app.id,
                name: app.name.clone(),
                path: app.path.clone(),
                score: combined,
            })
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(max_results);
    scored
}

pub fn most_used(apps: &[AppEntry], max_results: usize) -> Vec<SearchResult> {
    let mut sorted: Vec<&AppEntry> = apps.iter().collect();
    sorted.sort_by(|a, b| b.use_count.cmp(&a.use_count));
    sorted.truncate(max_results);

    sorted
        .into_iter()
        .map(|app| SearchResult {
            id: app.id,
            name: app.name.clone(),
            path: app.path.clone(),
            score: app.use_count as f64,
        })
        .collect()
}
