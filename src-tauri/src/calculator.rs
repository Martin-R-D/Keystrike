use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CalculatorResult {
    pub expression: String,
    pub result: f64,
    pub display: String,
}

pub fn evaluate(query: &str) -> Option<CalculatorResult> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(r) = try_percentage_of(trimmed) {
        return Some(r);
    }

    let expr = normalize(trimmed);

    if !looks_like_math(&expr) {
        return None;
    }

    match meval::eval_str(&expr) {
        Ok(val) if val.is_finite() => Some(CalculatorResult {
            expression: trimmed.to_string(),
            result: val,
            display: format_number(val),
        }),
        _ => None,
    }
}

fn normalize(input: &str) -> String {
    input
        .replace(" plus ", " + ")
        .replace(" minus ", " - ")
        .replace(" times ", " * ")
        .replace(" divided by ", " / ")
        .replace(" to the power of ", "^")
        .replace(" mod ", " % ")
        .replace('%', " % ")
        .replace("x", "*")
        .replace("×", "*")
        .replace("÷", "/")
}

fn try_percentage_of(input: &str) -> Option<CalculatorResult> {
    let re = Regex::new(r"(?i)^(\d+(?:\.\d+)?)\s*%\s*of\s+(\d+(?:\.\d+)?)$").ok()?;
    let caps = re.captures(input)?;
    let pct: f64 = caps.get(1)?.as_str().parse().ok()?;
    let base: f64 = caps.get(2)?.as_str().parse().ok()?;
    let val = (pct / 100.0) * base;

    Some(CalculatorResult {
        expression: input.to_string(),
        result: val,
        display: format_number(val),
    })
}

fn looks_like_math(expr: &str) -> bool {
    let has_digit = expr.chars().any(|c| c.is_ascii_digit());
    if !has_digit {
        return false;
    }

    let has_operator = expr.chars().any(|c| matches!(c, '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')'));
    if has_operator {
        return true;
    }

    let funcs = ["sqrt", "sin", "cos", "tan", "log", "ln", "abs", "exp", "ceil", "floor"];
    let lower = expr.to_lowercase();
    if funcs.iter().any(|f| lower.contains(f)) {
        return true;
    }

    false
}

fn format_number(val: f64) -> String {
    if val.fract() == 0.0 && val.abs() < 1e15 {
        format!("{}", val as i64)
    } else {
        let s = format!("{:.10}", val);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        s.to_string()
    }
}
