import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
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
            style={{ border: recording ? "1px solid #6366f1" : "1px solid rgba(255,255,255,0.12)" }}
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

function GeneralSettings() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">General</h1>
      <p className="mt-1 text-sm text-gray-400">Core preferences for Keystrike</p>
      <div className="mt-7 flex flex-col gap-7">
        <HotkeySection />
      </div>
    </div>
  );
}

export default GeneralSettings;
