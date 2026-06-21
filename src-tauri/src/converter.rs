use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ConversionResult {
    pub input_value: f64,
    pub input_unit: String,
    pub output_value: f64,
    pub output_unit: String,
    pub display: String,
}

pub fn convert(query: &str) -> Option<ConversionResult> {
    let re = Regex::new(
        r"(?i)^(-?\d+(?:\.\d+)?)\s*°?\s*([a-z]+)\s+(?:to|in)\s+°?\s*([a-z]+)$",
    )
    .ok()?;

    let caps = re.captures(query.trim())?;
    let value: f64 = caps.get(1)?.as_str().parse().ok()?;
    let from = caps.get(2)?.as_str().to_lowercase();
    let to = caps.get(3)?.as_str().to_lowercase();

    let (result, from_label, to_label) = do_convert(value, &from, &to)?;

    Some(ConversionResult {
        input_value: value,
        input_unit: from_label.to_string(),
        output_value: result,
        output_unit: to_label.to_string(),
        display: format!("{}{} = {}{}", format_num(value), from_label, format_num(result), to_label),
    })
}

fn do_convert(val: f64, from: &str, to: &str) -> Option<(f64, &'static str, &'static str)> {
    match (from, to) {
        // Weight
        ("kg", "lbs" | "lb" | "pounds") => Some((val * 2.20462, " kg", " lbs")),
        ("lbs" | "lb" | "pounds", "kg") => Some((val / 2.20462, " lbs", " kg")),
        ("g" | "grams", "oz" | "ounces") => Some((val * 0.035274, " g", " oz")),
        ("oz" | "ounces", "g" | "grams") => Some((val / 0.035274, " oz", " g")),

        // Temperature
        ("f" | "fahrenheit", "c" | "celsius") => Some(((val - 32.0) * 5.0 / 9.0, "°F", "°C")),
        ("c" | "celsius", "f" | "fahrenheit") => Some((val * 9.0 / 5.0 + 32.0, "°C", "°F")),

        // Distance
        ("km" | "kilometers", "miles" | "mi") => Some((val * 0.621371, " km", " miles")),
        ("miles" | "mi", "km" | "kilometers") => Some((val / 0.621371, " miles", " km")),
        ("m" | "meters", "ft" | "feet") => Some((val * 3.28084, " m", " ft")),
        ("ft" | "feet", "m" | "meters") => Some((val / 3.28084, " ft", " m")),
        ("cm" | "centimeters", "inches" | "in" | "inch") => Some((val / 2.54, " cm", " inches")),
        ("inches" | "in" | "inch", "cm" | "centimeters") => Some((val * 2.54, " inches", " cm")),

        // Data
        ("kb", "mb") => Some((val / 1024.0, " KB", " MB")),
        ("mb", "kb") => Some((val * 1024.0, " MB", " KB")),
        ("mb", "gb") => Some((val / 1024.0, " MB", " GB")),
        ("gb", "mb") => Some((val * 1024.0, " GB", " MB")),
        ("gb", "tb") => Some((val / 1024.0, " GB", " TB")),
        ("tb", "gb") => Some((val * 1024.0, " TB", " GB")),

        // Time
        ("hours" | "hour" | "hr" | "hrs", "minutes" | "minute" | "min" | "mins") => Some((val * 60.0, " hours", " minutes")),
        ("minutes" | "minute" | "min" | "mins", "hours" | "hour" | "hr" | "hrs") => Some((val / 60.0, " minutes", " hours")),
        ("days" | "day", "hours" | "hour" | "hr" | "hrs") => Some((val * 24.0, " days", " hours")),
        ("hours" | "hour" | "hr" | "hrs", "days" | "day") => Some((val / 24.0, " hours", " days")),

        _ => None,
    }
}

fn format_num(val: f64) -> String {
    if val.fract() == 0.0 && val.abs() < 1e15 {
        format!("{}", val as i64)
    } else {
        let s = format!("{:.2}", val);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        s.to_string()
    }
}
