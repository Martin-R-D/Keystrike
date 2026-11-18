use std::collections::HashMap;
use std::fs;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::data_dir;

/// Exchange rates are refreshed when the cache is older than this.
pub const MAX_AGE_SECS: u64 = 12 * 60 * 60;

const RATES_URL: &str = "https://api.frankfurter.dev/v1/latest?base=USD";

/// Rates relative to USD (`rates["USD"] == 1.0`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rates {
    pub fetched_at: u64,
    pub rates: HashMap<String, f64>,
}

#[derive(Debug, Clone)]
pub struct CurrencyConversion {
    pub amount: f64,
    pub from: String,
    pub to: String,
    pub result: f64,
    pub display: String,
}

fn cache_path() -> std::path::PathBuf {
    data_dir().join("rates.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load_cached() -> Option<Rates> {
    fs::read_to_string(cache_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Rates>(&s).ok())
        .filter(|r| !r.rates.is_empty())
}

fn save_cache(rates: &Rates) {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string(rates) {
        let _ = fs::write(cache_path(), json);
    }
}

pub fn is_stale(rates: &Option<Rates>) -> bool {
    match rates {
        None => true,
        Some(r) => now_secs().saturating_sub(r.fetched_at) > MAX_AGE_SECS,
    }
}

#[derive(Deserialize)]
struct ApiResponse {
    rates: HashMap<String, f64>,
}

/// Download fresh rates and cache them on disk.
pub fn fetch() -> Result<Rates, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build();
    let resp: ApiResponse = agent
        .get(RATES_URL)
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    let mut rates: HashMap<String, f64> = resp
        .rates
        .into_iter()
        .filter(|(_, v)| v.is_finite() && *v > 0.0)
        .map(|(k, v)| (k.to_uppercase(), v))
        .collect();
    if rates.is_empty() {
        return Err("Rate provider returned no rates".to_string());
    }
    rates.insert("USD".to_string(), 1.0);

    let fresh = Rates {
        fetched_at: now_secs(),
        rates,
    };
    save_cache(&fresh);
    Ok(fresh)
}

/// Parse queries such as `100 usd to eur`, `usd in gbp` or `1,250.50 eur to jpy`.
fn parse(query: &str) -> Option<(f64, String, String)> {
    let re = Regex::new(
        r"(?i)^(?:(\d[\d,]*(?:\.\d+)?|\.\d+)\s*)?([a-z]{3})\s+(?:to|in)\s+([a-z]{3})$",
    )
    .ok()?;
    let caps = re.captures(query.trim())?;
    let amount = match caps.get(1) {
        Some(m) => m.as_str().replace(',', "").parse::<f64>().ok()?,
        None => 1.0,
    };
    Some((
        amount,
        caps.get(2)?.as_str().to_uppercase(),
        caps.get(3)?.as_str().to_uppercase(),
    ))
}

fn format_amount(val: f64) -> String {
    let s = if val.abs() >= 1.0 {
        format!("{:.2}", val)
    } else {
        format!("{:.4}", val)
    };
    // Group thousands in the integer part.
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (s.clone(), None),
    };
    let negative = int_part.starts_with('-');
    let digits: Vec<char> = int_part.trim_start_matches('-').chars().collect();
    let mut grouped = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(*c);
    }
    let mut out = if negative { format!("-{}", grouped) } else { grouped };
    if let Some(f) = frac_part {
        out.push('.');
        out.push_str(&f);
    }
    out
}

/// Convert a query using the given rates. Returns `None` when the query is not
/// a currency conversion or either code is unknown.
pub fn convert(query: &str, rates: &Rates) -> Option<CurrencyConversion> {
    let (amount, from, to) = parse(query)?;
    let from_rate = *rates.rates.get(&from)?;
    let to_rate = *rates.rates.get(&to)?;
    let result = amount / from_rate * to_rate;
    if !result.is_finite() {
        return None;
    }
    Some(CurrencyConversion {
        display: format!("{} {} = {} {}", format_amount(amount), from, format_amount(result), to),
        amount,
        from,
        to,
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rates() -> Rates {
        let mut m = HashMap::new();
        m.insert("USD".to_string(), 1.0);
        m.insert("EUR".to_string(), 0.5);
        m.insert("JPY".to_string(), 150.0);
        Rates {
            fetched_at: now_secs(),
            rates: m,
        }
    }

    #[test]
    fn converts_between_currencies() {
        let c = convert("100 usd to eur", &rates()).unwrap();
        assert!((c.result - 50.0).abs() < 1e-9);
        assert_eq!(c.display, "100.00 USD = 50.00 EUR");
        let c = convert("10 eur in jpy", &rates()).unwrap();
        assert!((c.result - 3000.0).abs() < 1e-9);
        assert_eq!(c.display, "10.00 EUR = 3,000.00 JPY");
    }

    #[test]
    fn defaults_amount_to_one() {
        let c = convert("eur to usd", &rates()).unwrap();
        assert!((c.result - 2.0).abs() < 1e-9);
    }

    #[test]
    fn accepts_thousands_separators_and_decimals() {
        let c = convert("1,250.50 USD to EUR", &rates()).unwrap();
        assert!((c.result - 625.25).abs() < 1e-9);
    }

    #[test]
    fn unknown_codes_and_units_are_ignored() {
        assert!(convert("100 usd to xyz", &rates()).is_none());
        // Unit conversions must keep going to the unit converter.
        assert!(convert("100 kg to lbs", &rates()).is_none());
        assert!(convert("5 ft in cm", &rates()).is_none());
        assert!(convert("hello world", &rates()).is_none());
    }

    #[test]
    fn small_results_keep_precision() {
        let c = convert("1 jpy to usd", &rates()).unwrap();
        assert_eq!(c.display, "1.00 JPY = 0.0067 USD");
    }

    #[test]
    fn stale_detection() {
        assert!(is_stale(&None));
        assert!(!is_stale(&Some(rates())));
        let old = Rates {
            fetched_at: now_secs() - MAX_AGE_SECS - 10,
            rates: rates().rates,
        };
        assert!(is_stale(&Some(old)));
    }
}
