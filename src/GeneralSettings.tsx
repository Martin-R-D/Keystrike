import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ACCENT_PRESETS, DEFAULT_THEME, saveTheme, ThemeConfig, ThemeMode } from "./theme";

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

/** Translate a KeyboardEvent into a hotkey string like "Ctrl+Shift+K". */
function eventToHotkey(e: React.KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null; // wait for the real key

  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else {
    const named: Record<string, string> = {
      Space: "Space",
      Enter: "Enter",
      Tab: "Tab",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
    };
    key = named[e.code] ?? null;
  }
  if (!key) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  if (parts.length === 0) return null; // require a modifier
  return [...parts, key].join("+");
}

function HotkeySection() {
  const [hotkey, setHotkey] = useState("");
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<string>("get_hotkey").then(setHotkey).catch(console.error);
  }, []);

  const apply = useCallback(async (value: string) => {
    try {
      const applied = await invoke<string>("set_hotkey", { hotkey: value });
      setHotkey(applied);
      setError(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      setPending(null);
      return;
    }
    const combo = eventToHotkey(e);
    if (combo) {
      setPending(combo);
      setRecording(false);
      apply(combo);
    }
  };

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Hotkey</h2>
      <div
        className="mt-3 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
        style={{ border: "1px solid rgba(var(--fg-rgb), 0.07)" }}
      >
        <div>
          <div className="text-sm text-gray-200">Open Keystrike</div>
          <div className="text-xs text-gray-500">
            Click the box, then press the key combination you want (Esc to cancel).
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRecording(true);
              setPending(null);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setRecording(false)}
            className="min-w-[140px] rounded-md bg-black/30 px-3 py-1.5 text-center font-mono text-sm text-white outline-none"
            style={{ border: recording ? "1px solid var(--accent)" : "1px solid rgba(var(--fg-rgb), 0.12)" }}
          >
            {recording ? "Press keys..." : pending ?? hotkey}
          </button>
          <button
            type="button"
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline"
            onClick={() => invoke<string>("reset_hotkey").then((h) => { setHotkey(h); setPending(null); setError(null); }).catch((e) => setError(String(e)))}
          >
            Reset
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs font-medium text-red-400">{error}</div>}
      {saved && <div className="mt-2 text-xs font-medium text-green-400">Hotkey updated</div>}
    </section>
  );
}

interface AliasEntry {
  alias: string;
  name: string;
  launch_path: string;
}

interface AppHit {
  id: number;
  name: string;
  path: string;
}

function AliasesSection() {
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [alias, setAlias] = useState("");
  const [appQuery, setAppQuery] = useState("");
  const [hits, setHits] = useState<AppHit[]>([]);
  const [chosen, setChosen] = useState<AppHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const load = useCallback(() => {
    invoke<AliasEntry[]>("get_aliases").then(setAliases).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (chosen || !appQuery.trim()) {
      setHits([]);
      return;
    }
    const seq = ++searchSeq.current;
    invoke<AppHit[]>("search_apps", { query: appQuery })
      .then((r) => {
        if (seq === searchSeq.current) setHits(r);
      })
      .catch(() => {});
  }, [appQuery, chosen]);

  const canAdd = alias.trim().length > 0 && chosen !== null;

  const add = async () => {
    if (!chosen || !canAdd) return;
    try {
      await invoke("set_alias", { alias: alias.trim(), appId: chosen.id });
      setAlias("");
      setAppQuery("");
      setChosen(null);
      setError(null);
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (a: string) => {
    await invoke("remove_alias", { alias: a }).catch(console.error);
    load();
  };

  const inputStyle = { border: "1px solid rgba(var(--fg-rgb), 0.12)" };

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">App Aliases</h2>
      <p className="mt-1 text-xs text-gray-500">
        Type a short alias in the search bar to jump straight to an app, e.g. <span className="font-mono text-gray-400">ff</span> for Firefox.
      </p>
      <div className="mt-3 rounded-xl p-4" style={{ border: "1px solid rgba(var(--fg-rgb), 0.07)" }}>
        <div className="flex items-start gap-2">
          <input
            type="text"
            value={alias}
            spellCheck={false}
            placeholder="Alias"
            onChange={(e) => setAlias(e.target.value)}
            className="w-28 rounded-md bg-black/30 px-3 py-1.5 font-mono text-sm text-white outline-none placeholder:text-gray-600"
            style={inputStyle}
          />
          <div className="relative flex-1">
            <input
              type="text"
              value={chosen ? chosen.name : appQuery}
              spellCheck={false}
              placeholder="Search for an app..."
              onChange={(e) => {
                setChosen(null);
                setAppQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!chosen && hits.length > 0) {
                    setChosen(hits[0]);
                    setHits([]);
                  } else {
                    add();
                  }
                }
              }}
              className="w-full rounded-md bg-black/30 px-3 py-1.5 text-sm text-white outline-none placeholder:text-gray-600"
              style={inputStyle}
            />
            {hits.length > 0 && (
              <div
                className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-md"
                style={{ background: "var(--bg-popover)", border: "1px solid rgba(var(--fg-rgb), 0.12)" }}
              >
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-white/10"
                    onClick={() => {
                      setChosen(h);
                      setHits([]);
                    }}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={add}
            className="rounded-md px-3.5 py-1.5 text-sm font-medium text-on-accent transition-colors"
            style={canAdd ? { background: "var(--accent)" } : { background: "rgba(var(--accent-rgb), 0.35)", cursor: "not-allowed" }}
          >
            Add
          </button>
        </div>
        {error && <div className="mt-2 text-xs font-medium text-red-400">{error}</div>}

        {aliases.length > 0 && (
          <div className="mt-4 flex flex-col">
            {aliases.map((a, i) => (
              <div
                key={a.alias}
                className="flex items-center justify-between py-2 text-sm"
                style={{ borderTop: i === 0 ? "none" : "1px solid rgba(var(--fg-rgb), 0.05)" }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-28 shrink-0 font-mono font-medium text-indigo-400">{a.alias}</span>
                  <span className="truncate text-gray-200">{a.name}</span>
                </div>
                <button
                  type="button"
                  className="text-xs text-gray-500 hover:text-red-400"
                  onClick={() => remove(a.alias)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ThemeConfig>("get_theme").then(setTheme).catch(console.error);
  }, []);

  const update = async (next: ThemeConfig) => {
    const previous = theme;
    setTheme(next);
    try {
      setTheme(await saveTheme(next));
      setError(null);
    } catch (e) {
      setTheme(previous);
      setError(String(e));
    }
  };

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Appearance</h2>
      <div className="mt-3 rounded-xl px-4 py-3" style={{ border: "1px solid rgba(var(--fg-rgb), 0.07)" }}>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-gray-200">Theme</div>
          <div className="flex gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => update({ ...theme, mode: m.value })}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={
                  theme.mode === m.value
                    ? { background: "rgba(var(--accent-rgb), 0.22)", border: "1px solid var(--accent)" }
                    : { background: "rgba(var(--fg-rgb), 0.04)", border: "1px solid rgba(var(--fg-rgb), 0.1)", color: "var(--text-muted)" }
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="text-sm text-gray-200">Accent color</div>
          <div className="flex items-center gap-2">
            {ACCENT_PRESETS.map((a) => (
              <button
                key={a.value}
                type="button"
                title={a.name}
                aria-label={a.name}
                onClick={() => update({ ...theme, accent: a.value })}
                className="h-6 w-6 rounded-full"
                style={{
                  background: a.value,
                  border: theme.accent === a.value ? "2px solid rgba(var(--fg-rgb), 0.9)" : "2px solid transparent",
                }}
              />
            ))}
          </div>
        </div>
      </div>
      {error && <div className="mt-2 text-xs font-medium text-red-400">{error}</div>}
    </section>
  );
}

function GeneralSettings() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">General</h1>
      <p className="mt-1 text-sm text-gray-400">Core preferences for Keystrike</p>
      <div className="mt-7 flex flex-col gap-7">
        <HotkeySection />
        <AppearanceSection />
        <AliasesSection />
      </div>
    </div>
  );
}

export default GeneralSettings;
