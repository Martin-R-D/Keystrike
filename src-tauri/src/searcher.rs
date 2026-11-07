use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Serialize;

use crate::indexer::AppEntry;
use crate::pins::{self, Pin};

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub score: f64,
    pub is_pinned: bool,
}

pub struct Searcher {
    matcher: SkimMatcherV2,
}

impl Searcher {
    pub fn new() -> Self {
        Self {
            matcher: SkimMatcherV2::default(),
        }
    }

    pub fn search(&self, query: &str, apps: &[AppEntry], max_results: usize, pin_list: &[Pin]) -> Vec<SearchResult> {
        let mut scored: Vec<SearchResult> = apps
            .iter()
            .filter_map(|app| {
                let fuzzy_score = self.matcher.fuzzy_match(&app.name, query)? as f64;
                let pinned = pins::is_pinned(pin_list, &app.launch_path);
                let combined = fuzzy_score * 0.7 + app.use_count as f64 * 0.3;
                Some(SearchResult {
                    id: app.id,
                    name: app.name.clone(),
                    path: app.path.clone(),
                    score: combined,
                    is_pinned: pinned,
                })
            })
            .collect();

        // Stable sort: pinned items first, then by score within each group.
        scored.sort_by(|a, b| {
            b.is_pinned.cmp(&a.is_pinned)
                .then(b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
        });
        scored.truncate(max_results);
        scored
    }
}

pub fn most_used(apps: &[AppEntry], max_results: usize, pin_list: &[Pin]) -> Vec<SearchResult> {
    let mut sorted: Vec<&AppEntry> = apps.iter().collect();

    // Pinned apps first (preserving pin order), then by use_count.
    sorted.sort_by(|a, b| {
        let a_pin = pins::is_pinned(pin_list, &a.launch_path);
        let b_pin = pins::is_pinned(pin_list, &b.launch_path);
        b_pin.cmp(&a_pin).then(b.use_count.cmp(&a.use_count))
    });
    sorted.truncate(max_results);

    sorted
        .into_iter()
        .map(|app| SearchResult {
            id: app.id,
            name: app.name.clone(),
            path: app.path.clone(),
            score: app.use_count as f64,
            is_pinned: pins::is_pinned(pin_list, &app.launch_path),
        })
        .collect()
}
