import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type CommandGroup = "web_search" | "system";

interface CommandsConfig {
  web_search: Record<string, string>;
  system: Record<string, string>;
}

interface CommandMeta {
  /** Stable backend id (for editable commands). */
  id: string;
  /** Which config group the keyword lives in (omitted for non-editable). */
  group?: CommandGroup;
  /** Friendly name, used in conflict messages. */
  name: string;
  description: string;
  example: string;
  editable: boolean;
}

// Static metadata. Descriptions, examples and order are fixed; only the
// keyword/prefix is editable, and it is loaded from the backend config.
const COMMAND_META: CommandMeta[] = [
  { id: "close", group: "system", name: "Close App", description: "Force-closes a running application", example: "/close chrome", editable: true },
  { id: "google", group: "web_search", name: "Google Search", description: "Search Google in your browser", example: "g how to learn rust", editable: true },
  { id: "youtube", group: "web_search", name: "YouTube Search", description: "Search YouTube in your browser", example: "yt lofi hip hop", editable: true },
  { id: "wikipedia", group: "web_search", name: "Wikipedia Search", description: "Search Wikipedia in your browser", example: "wiki theory of relativity", editable: true },
  { id: "reddit", group: "web_search", name: "Reddit Search", description: "Search Reddit in your browser", example: "r best mechanical keyboards", editable: true },
  { id: "github", group: "web_search", name: "GitHub Search", description: "Search GitHub in your browser", example: "gh tauri examples", editable: true },
  { id: "stackoverflow", group: "web_search", name: "Stack Overflow Search", description: "Search Stack Overflow in your browser", example: "so rust borrow checker", editable: true },
  { id: "duckduckgo", group: "web_search", name: "DuckDuckGo Search", description: "Search DuckDuckGo in your browser", example: "ddg privacy tools", editable: true },
  { id: "math", name: "Math", description: "Calculate math expressions instantly", example: "15 * 23 + 7", editable: false },
  { id: "units", name: "Units", description: "Convert between units", example: "150 lbs to kg", editable: false },
];

const GRID = "120px 1fr 1fr 72px";

/** Normalize a keyword for duplicate comparison (mirror of the Rust side). */
function normalize(kw: string): string {
  return kw.replace(/^\/+/, "").toLowerCase();
}

function Settings() {
  const [config, setConfig] = useState<CommandsConfig | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<CommandsConfig>("get_commands");
      setConfig(cfg);
    } catch (e) {
      console.error("Failed to load commands:", e);
    }
  }, []);

  // Fetch fresh data on mount and whenever the window regains focus, so a
  // reused settings window never shows stale keywords.
  useEffect(() => {
    loadConfig();
    window.addEventListener("focus", loadConfig);
    return () => window.removeEventListener("focus", loadConfig);
  }, [loadConfig]);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const keywordOf = useCallback(
    (meta: CommandMeta): string => {
      if (!config || !meta.group) return "";
      return config[meta.group][meta.id] ?? "";
    },
    [config],
  );

  const startEdit = useCallback(
    (meta: CommandMeta) => {
      setEditingId(meta.id);
      setDraft(keywordOf(meta));
      setError(null);
    },
    [keywordOf],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setError(null);
  }, []);

  const confirmEdit = useCallback(
    async (meta: CommandMeta) => {
      const trimmed = draft.trim();
      const current = keywordOf(meta);

      // No-op: unchanged keyword.
      if (trimmed === current) {
        cancelEdit();
        return;
      }
      if (!trimmed) {
        setError("Keyword cannot be empty");
        return;
      }
      if (/\s/.test(trimmed)) {
        setError("Keyword cannot contain spaces");
        return;
      }

      // Conflict check against every other command (case-insensitive,
      // slash-insensitive).
      const target = normalize(trimmed);
      const conflict = COMMAND_META.find(
        (m) => m.editable && m.id !== meta.id && normalize(keywordOf(m)) === target,
      );
      if (conflict) {
        setError(`Already used by ${conflict.name}`);
        return;
      }

      try {
        await invoke("update_command_keyword", {
          commandId: meta.id,
          newKeyword: trimmed,
        });
      } catch (e) {
        setError(String(e));
        return;
      }

      // Apply locally and show success flash.
      if (config && meta.group) {
        setConfig({
          ...config,
          [meta.group]: { ...config[meta.group], [meta.id]: trimmed },
        });
      }
      setEditingId(null);
      setError(null);
      setSavedId(meta.id);
      window.setTimeout(() => {
        setSavedId((cur) => (cur === meta.id ? null : cur));
      }, 1200);
    },
    [draft, keywordOf, cancelEdit, config],
  );

  const doReset = useCallback(async () => {
    try {
      const defaults = await invoke<CommandsConfig>("reset_commands_to_defaults");
      setConfig(defaults);
    } catch (e) {
      console.error("Failed to reset commands:", e);
    }
    setEditingId(null);
    setError(null);
    setShowResetConfirm(false);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-white" style={{ background: "#1a1a2e" }}>
      {/* Sidebar */}
      <aside
        className="flex w-48 shrink-0 flex-col gap-1 p-3"
        style={{ background: "#15151f", borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Settings
        </div>
        <button
          className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-white"
          style={{ background: "rgba(99, 102, 241, 0.18)", borderLeft: "2px solid #6366f1" }}
        >
          Commands
        </button>
        <div
          className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-600"
          title="Coming soon"
        >
          <span>General</span>
          <span className="text-[10px] text-gray-700">Soon</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold text-white">Commands &amp; Shortcuts</h1>
        <p className="mt-1 text-sm text-gray-400">
          Click the pencil to customize a command&apos;s keyword
        </p>

        <div className="mt-6 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          {/* Header row */}
          <div
            className="grid items-center gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            style={{ gridTemplateColumns: GRID, background: "rgba(255,255,255,0.03)" }}
          >
            <div>Command</div>
            <div>Description</div>
            <div>Example</div>
            <div />
          </div>

          {COMMAND_META.map((meta, i) => {
            const isEditing = editingId === meta.id;
            const isSaved = savedId === meta.id;
            const keyword = keywordOf(meta);

            return (
              <div
                key={meta.id}
                className={`settings-row ${isSaved ? "flash-saved" : ""}`}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div
                  className="grid items-center gap-4 px-4 py-3 text-sm"
                  style={{ gridTemplateColumns: GRID }}
                >
                  {/* Command / keyword */}
                  <div className="min-w-0">
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={draft}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        onChange={(e) => {
                          setDraft(e.target.value);
                          if (error) setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmEdit(meta);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="w-full rounded-md bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none"
                        style={{
                          border: error ? "1px solid #ef4444" : "1px solid #6366f1",
                        }}
                      />
                    ) : meta.editable ? (
                      <span className="font-mono font-medium text-indigo-400">{keyword}</span>
                    ) : (
                      <span className="font-mono font-medium text-gray-400">{meta.name}</span>
                    )}
                  </div>

                  {/* Description */}
                  <div className="flex items-center gap-2 text-gray-200">
                    <span>{meta.description}</span>
                    {isSaved && <span className="saved-badge text-[11px] font-medium text-green-400">Saved</span>}
                  </div>

                  {/* Example */}
                  <div className="truncate font-mono text-xs text-gray-500">{meta.example}</div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5">
                    {meta.editable && !isEditing && (
                      <button
                        type="button"
                        aria-label={`Edit ${meta.name} keyword`}
                        title="Edit keyword"
                        className="icon-btn text-gray-500"
                        onClick={() => startEdit(meta)}
                      >
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button
                          type="button"
                          aria-label="Confirm"
                          title="Confirm"
                          className="icon-btn text-green-400"
                          onClick={() => confirmEdit(meta)}
                        >
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel"
                          title="Cancel"
                          className="icon-btn text-red-400"
                          onClick={cancelEdit}
                        >
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Inline error, full width below the row */}
                {isEditing && error && (
                  <div className="px-4 pb-2 -mt-1 text-xs font-medium text-red-400">{error}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reset to default */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-xs text-gray-500 underline-offset-2 transition-colors hover:text-gray-300 hover:underline"
            onClick={() => setShowResetConfirm(true)}
          >
            Reset to default
          </button>
        </div>
      </main>

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="w-80 rounded-xl p-5"
            style={{ background: "#1f1f2e", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-white">Reset commands</div>
            <p className="mt-2 text-sm text-gray-400">
              Reset all commands to their default keywords?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/10"
                onClick={() => setShowResetConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
                onClick={doReset}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
