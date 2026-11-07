use regex::Regex;

#[derive(Debug, Clone)]
pub struct ColorResult {
    pub hex: String,
    pub rgb: String,
    pub hsl: String,
}

pub fn parse_color(input: &str) -> Option<ColorResult> {
    let s = input.trim();

    if let Some(c) = parse_hex(s) {
        return Some(c);
    }
    if let Some(c) = parse_rgb(s) {
        return Some(c);
    }
    None
}

fn parse_hex(s: &str) -> Option<ColorResult> {
    let re3 = Regex::new(r"^#([0-9a-fA-F]{3})$").unwrap();
    let re6 = Regex::new(r"^#([0-9a-fA-F]{6})$").unwrap();

    if let Some(caps) = re3.captures(s) {
        let h = caps.get(1).unwrap().as_str();
        let r = u8::from_str_radix(&h[0..1].repeat(2), 16).ok()?;
        let g = u8::from_str_radix(&h[1..2].repeat(2), 16).ok()?;
        let b = u8::from_str_radix(&h[2..3].repeat(2), 16).ok()?;
        return Some(build_result(r, g, b));
    }

    if let Some(caps) = re6.captures(s) {
        let h = caps.get(1).unwrap().as_str();
        let r = u8::from_str_radix(&h[0..2], 16).ok()?;
        let g = u8::from_str_radix(&h[2..4], 16).ok()?;
        let b = u8::from_str_radix(&h[4..6], 16).ok()?;
        return Some(build_result(r, g, b));
    }

    None
}

fn parse_rgb(s: &str) -> Option<ColorResult> {
    let re = Regex::new(r"(?i)^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$").unwrap();

    if let Some(caps) = re.captures(s) {
        let r: u16 = caps.get(1).unwrap().as_str().parse().ok()?;
        let g: u16 = caps.get(2).unwrap().as_str().parse().ok()?;
        let b: u16 = caps.get(3).unwrap().as_str().parse().ok()?;
        if r > 255 || g > 255 || b > 255 {
            return None;
        }
        return Some(build_result(r as u8, g as u8, b as u8));
    }

    None
}

fn build_result(r: u8, g: u8, b: u8) -> ColorResult {
    let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);
    let rgb = format!("rgb({}, {}, {})", r, g, b);
    let (h, s, l) = rgb_to_hsl(r, g, b);
    let hsl = format!("hsl({}, {}%, {}%)", h, s, l);
    ColorResult { hex, rgb, hsl }
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (u16, u16, u16) {
    let r = r as f64 / 255.0;
    let g = g as f64 / 255.0;
    let b = b as f64 / 255.0;

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;

    let l = (max + min) / 2.0;

    let s = if delta == 0.0 {
        0.0
    } else {
        delta / (1.0 - (2.0 * l - 1.0).abs())
    };

    let h = if delta == 0.0 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / delta) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };

    let h = ((h % 360.0) + 360.0) % 360.0;

    (h.round() as u16, (s * 100.0).round() as u16, (l * 100.0).round() as u16)
}
