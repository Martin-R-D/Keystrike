import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "dark" | "light" | "system";

export interface ThemeConfig {
  mode: ThemeMode;
  accent: string;
}

export const DEFAULT_THEME: ThemeConfig = { mode: "dark", accent: "#6366f1" };

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: "Indigo", value: "#6366f1" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Pink", value: "#ec4899" },
  { name: "Purple", value: "#a855f7" },
];

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

/** Apply a theme to the current document. */
export function applyTheme(theme: ThemeConfig): void {
  const root = document.documentElement;
  root.dataset.theme = resolveMode(theme.mode);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-rgb", hexToRgb(theme.accent));
}

let current: ThemeConfig = DEFAULT_THEME;

/** Load the saved theme from the backend and apply it. */
export async function loadAndApplyTheme(): Promise<ThemeConfig> {
  try {
    current = await invoke<ThemeConfig>("get_theme");
  } catch {
    current = DEFAULT_THEME;
  }
  applyTheme(current);
  return current;
}

/** Persist a theme and apply it immediately. */
export async function saveTheme(theme: ThemeConfig): Promise<ThemeConfig> {
  current = await invoke<ThemeConfig>("set_theme", { theme });
  applyTheme(current);
  return current;
}

/** Keep the theme in sync with window focus (other windows may change it) and
 * with the OS setting when mode is "system". */
export function watchTheme(): void {
  window.addEventListener("focus", () => {
    loadAndApplyTheme();
  });
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", () => applyTheme(current));
}
