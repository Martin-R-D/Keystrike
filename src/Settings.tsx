import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type CommandType = "url" | "snippet" | "system";

interface BuiltinCommand {
  keyword: string;
  type: CommandType;
  label: string;
  url?: string | null;
  fallback?: string | null;
  description: string;
  editable_keyword: boolean;
  deletable: boolean;
}

interface CustomCommand {
  id: string;
  keyword: string;
  type: CommandType;
  label: string;
  url?: string | null;
  fallback?: string | null;
  content?: string | null;
  description?: string;
}

interface AllCommandsConfig {
  builtin: Record<string, BuiltinCommand>;
  custom: CustomCommand[];
}

// Display order + fixed examples for the built-in commands.
const BUILTIN_ORDER: { id: string; example: string }[] = [
  { id: "close", example: "/close chrome" },
  { id: "google", example: "g how to learn rust" },
  { id: "youtube", example: "yt lofi hip hop" },
  { id: "wikipedia", example: "wiki theory of relativity" },
  { id: "reddit", example: "r best mechanical keyboards" },
  { id: "github", example: "gh tauri examples" },
  { id: "stackoverflow", example: "so rust borrow checker" },
  { id: "duckduckgo", example: "ddg privacy tools" },
];

// Calculator / converter are features without an editable keyword.
const STATIC_ROWS = [
  { name: "Math", description: "Calculate math expressions instantly", example: "15 * 23 + 7" },
  { name: "Units", description: "Convert between units", example: "150 lbs to kg" },
];

const GRID = "120px 1fr 1fr 80px";

function normalize(kw: string): string {
  return kw.replace(/^\/+/, "").toLowerCase();
}

/** Find the label of any other command already using this keyword. */
function findConflict(
  config: AllCommandsConfig,
  excludeId: string | null,
  keyword: string,
): string | null {
  const target = normalize(keyword.trim());
  if (!target) return null;
  for (const [id, c] of Object.entries(config.builtin)) {
    if (id === excludeId) continue;
    if (normalize(c.keyword) === target) return c.label;
  }
  for (const c of config.custom) {
    if (c.id === excludeId) continue;
    if (normalize(c.keyword) === target) return c.label;
  }
  return null;
}

/** Live validation message for a keyword, or null if it's fine. */
function keywordError(
  config: AllCommandsConfig,
  excludeId: string | null,
  keyword: string,
): string | null {
  const t = keyword.trim();
  if (!t) return null; // empty just disables Save, no red message
  if (/\s/.test(t)) return "Keyword cannot contain spaces";
  const label = findConflict(config, excludeId, t);
  return label ? `Already used by ${label}` : null;
}

interface FormState {
  keyword: string;
  type: "url" | "snippet";
  label: string;
  url: string;
  fallback: string;
  content: string;
}

const EMPTY_FORM: FormState = {
  keyword: "",
  type: "url",
  label: "",
  url: "",
  fallback: "",
  content: "",
};

function Settings() {
  const [config, setConfig] = useState<AllCommandsConfig | null>(null);

  // Built-in inline keyword editing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Modal (create/edit custom command).
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);

  // Misc dialogs.
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<AllCommandsConfig>("get_all_commands");
      setConfig(cfg);
    } catch (e) {
      console.error("Failed to load commands:", e);
    }
  }, []);

  // Fresh data on mount and on focus (window may be reused).
  useEffect(() => {
    loadConfig();
    window.addEventListener("focus", loadConfig);
    return () => window.removeEventListener("focus", loadConfig);
  }, [loadConfig]);

  useEffect(() => {
    if (editingId) {
      inlineInputRef.current?.focus();
      inlineInputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (modalOpen) keywordInputRef.current?.focus();
  }, [modalOpen]);

  // ---- Built-in inline keyword edit ----

  const startInlineEdit = useCallback((id: string, keyword: string) => {
    setEditingId(id);
    setDraft(keyword);
    setInlineError(null);
  }, []);

  const cancelInlineEdit = useCallback(() => {
    setEditingId(null);
    setInlineError(null);
  }, []);

  const confirmInlineEdit = useCallback(
    async (id: string) => {
      if (!config) return;
      const trimmed = draft.trim();
      const current = config.builtin[id]?.keyword ?? "";
      if (trimmed === current) {
        cancelInlineEdit();
        return;
      }
      if (!trimmed) {
        setInlineError("Keyword cannot be empty");
        return;
      }
      if (/\s/.test(trimmed)) {
        setInlineError("Keyword cannot contain spaces");
        return;
      }
      const conflict = findConflict(config, id, trimmed);
      if (conflict) {
        setInlineError(`Already used by ${conflict}`);
        return;
      }
      try {
        await invoke("update_command_keyword", { commandId: id, newKeyword: trimmed });
      } catch (e) {
        setInlineError(String(e));
        return;
      }
      await loadConfig();
      setEditingId(null);
      setInlineError(null);
      setSavedId(id);
      window.setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1200);
    },
    [config, draft, cancelInlineEdit, loadConfig],
  );

  // ---- Custom command modal ----

  const openCreate = useCallback(() => {
    setEditingCustomId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((cmd: CustomCommand) => {
    setEditingCustomId(cmd.id);
    setForm({
      keyword: cmd.keyword,
      type: cmd.type === "snippet" ? "snippet" : "url",
      label: cmd.label,
      url: cmd.url ?? "",
      fallback: cmd.fallback ?? "",
      content: cmd.content ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }, []);

  const liveKeywordError = useMemo(() => {
    if (!config) return null;
    return keywordError(config, editingCustomId, form.keyword);
  }, [config, editingCustomId, form.keyword]);

  const showFallbackField = form.type === "url" && form.url.includes("{query}");

  const canSave = useMemo(() => {
    if (!form.keyword.trim() || liveKeywordError) return false;
    if (!form.label.trim()) return false;
    if (form.type === "url") return !!form.url.trim();
    return !!form.content.trim();
  }, [form, liveKeywordError]);

  const saveModal = useCallback(async () => {
    if (!canSave) return;
    const input = {
      keyword: form.keyword.trim(),
      type: form.type,
      label: form.label.trim(),
      url: form.type === "url" ? form.url.trim() : null,
      fallback: form.type === "url" && showFallbackField ? form.fallback.trim() : null,
      content: form.type === "snippet" ? form.content : null,
      description: "",
    };
    try {
      if (editingCustomId) {
        await invoke("update_custom_command", { id: editingCustomId, command: input });
      } else {
        await invoke("create_custom_command", { command: input });
      }
    } catch (e) {
      setFormError(String(e));
      return;
    }
    await loadConfig();
    setModalOpen(false);
  }, [canSave, form, showFallbackField, editingCustomId, loadConfig]);

  const doDelete = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_custom_command", { id });
      } catch (e) {
        console.error("Failed to delete:", e);
      }
      await loadConfig();
      setDeleteConfirmId(null);
    },
    [loadConfig],
  );

  const doReset = useCallback(async () => {
    try {
      const defaults = await invoke<AllCommandsConfig>("reset_commands_to_defaults");
      setConfig(defaults);
    } catch (e) {
      console.error("Failed to reset:", e);
    }
    setEditingId(null);
    setInlineError(null);
    setShowResetConfirm(false);
  }, []);

  // ---- Render helpers ----

  const renderActions = (children: React.ReactNode) => (
    <div className="flex items-center justify-end gap-1.5">{children}</div>
  );

  const editIcon = (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
  const trashIcon = (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );

  const renderKeywordCell = (id: string, keyword: string) => {
    if (editingId === id) {
      return (
        <input
          ref={inlineInputRef}
          type="text"
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            setDraft(e.target.value);
            if (inlineError) setInlineError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmInlineEdit(id);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelInlineEdit();
            }
          }}
          className="w-full rounded-md bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none"
          style={{ border: inlineError ? "1px solid #ef4444" : "1px solid #6366f1" }}
        />
      );
    }
    return <span className="font-mono font-medium text-indigo-400">{keyword}</span>;
  };

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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Commands &amp; Shortcuts</h1>
            <p className="mt-1 text-sm text-gray-400">
              Customize built-in keywords or create your own commands
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
            onClick={openCreate}
          >
            + Add Command
          </button>
        </div>

        {/* Built-in commands */}
        <h2 className="mt-7 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Built-in Commands
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <div
            className="grid items-center gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            style={{ gridTemplateColumns: GRID, background: "rgba(255,255,255,0.03)" }}
          >
            <div>Command</div>
            <div>Description</div>
            <div>Example</div>
            <div />
          </div>

          {config &&
            BUILTIN_ORDER.filter((b) => config.builtin[b.id]).map((b, i) => {
              const cmd = config.builtin[b.id];
              const isSaved = savedId === b.id;
              const isEditing = editingId === b.id;
              return (
                <div
                  key={b.id}
                  className={`settings-row ${isSaved ? "flash-saved" : ""}`}
                  style={{ borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)" }}
                >
                  <div className="grid items-center gap-4 px-4 py-3 text-sm" style={{ gridTemplateColumns: GRID }}>
                    <div className="min-w-0">{renderKeywordCell(b.id, cmd.keyword)}</div>
                    <div className="flex items-center gap-2 text-gray-200">
                      <span>{cmd.description}</span>
                      {isSaved && <span className="saved-badge text-[11px] font-medium text-green-400">Saved</span>}
                    </div>
                    <div className="truncate font-mono text-xs text-gray-500">{b.example}</div>
                    {renderActions(
                      isEditing ? (
                        <>
                          <button type="button" aria-label="Confirm" title="Confirm" className="icon-btn text-green-400" onClick={() => confirmInlineEdit(b.id)}>
                            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                          </button>
                          <button type="button" aria-label="Cancel" title="Cancel" className="icon-btn text-red-400" onClick={cancelInlineEdit}>
                            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                          </button>
                        </>
                      ) : (
                        cmd.editable_keyword && (
                          <button type="button" aria-label={`Edit ${cmd.label} keyword`} title="Edit keyword" className="icon-btn text-gray-500" onClick={() => startInlineEdit(b.id, cmd.keyword)}>
                            {editIcon}
                          </button>
                        )
                      ),
                    )}
                  </div>
                  {isEditing && inlineError && (
                    <div className="px-4 pb-2 -mt-1 text-xs font-medium text-red-400">{inlineError}</div>
                  )}
                </div>
              );
            })}

          {STATIC_ROWS.map((s) => (
            <div
              key={s.name}
              className="settings-row"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="grid items-center gap-4 px-4 py-3 text-sm" style={{ gridTemplateColumns: GRID }}>
                <div className="font-mono font-medium text-gray-400">{s.name}</div>
                <div className="text-gray-200">{s.description}</div>
                <div className="truncate font-mono text-xs text-gray-500">{s.example}</div>
                <div />
              </div>
            </div>
          ))}
        </div>

        {/* Custom commands */}
        <h2 className="mt-7 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Custom Commands
        </h2>

        {config && config.custom.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <div
              className="grid items-center gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
              style={{ gridTemplateColumns: GRID, background: "rgba(255,255,255,0.03)" }}
            >
              <div>Command</div>
              <div>Label</div>
              <div>Destination</div>
              <div />
            </div>
            {config.custom.map((cmd, i) => (
              <div key={cmd.id} className="settings-row" style={{ borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
                <div className="grid items-center gap-4 px-4 py-3 text-sm" style={{ gridTemplateColumns: GRID }}>
                  <div className="min-w-0 font-mono font-medium text-indigo-400">{cmd.keyword}</div>
                  <div className="flex min-w-0 items-center gap-2 text-gray-200">
                    <span className="truncate">{cmd.label}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style={{ background: "rgba(99,102,241,0.18)", color: "#a5b4fc" }}
                    >
                      {cmd.type === "snippet" ? "Snippet" : "URL"}
                    </span>
                  </div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {cmd.type === "snippet" ? cmd.content : cmd.url}
                  </div>
                  {renderActions(
                    <>
                      <button type="button" aria-label="Edit command" title="Edit" className="icon-btn text-gray-500" onClick={() => openEdit(cmd)}>
                        {editIcon}
                      </button>
                      <button type="button" aria-label="Delete command" title="Delete" className="icon-btn text-gray-500 hover:!text-red-400" onClick={() => setDeleteConfirmId(cmd.id)}>
                        {trashIcon}
                      </button>
                    </>,
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl px-6 py-10 text-center"
            style={{ border: "1px dashed rgba(255,255,255,0.12)" }}
          >
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="text-gray-600">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" strokeLinecap="round" />
            </svg>
            <div className="text-sm text-gray-400">No custom commands yet.</div>
            <div className="text-xs text-gray-600">Click &quot;+ Add Command&quot; to create one.</div>
          </div>
        )}

        {/* Reset to default */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-xs text-gray-500 underline-offset-2 transition-colors hover:text-gray-300 hover:underline"
            onClick={() => setShowResetConfirm(true)}
          >
            Reset built-in keywords to default
          </button>
        </div>
      </main>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-[440px] max-h-full overflow-y-auto rounded-xl p-5"
            style={{ background: "#1f1f2e", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold text-white">
              {editingCustomId ? "Edit Command" : "Add Command"}
            </div>

            {/* Keyword */}
            <label className="mt-4 block text-xs font-medium text-gray-400">Keyword</label>
            <input
              ref={keywordInputRef}
              type="text"
              value={form.keyword}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="e.g., gt or ;email"
              onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
              className="mt-1 w-full rounded-md bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-gray-600"
              style={{ border: liveKeywordError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.12)" }}
            />
            {liveKeywordError && <div className="mt-1 text-xs font-medium text-red-400">{liveKeywordError}</div>}

            {/* Type toggle */}
            <label className="mt-4 block text-xs font-medium text-gray-400">Type</label>
            <div className="mt-1 flex gap-2">
              {(["url", "snippet"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  className="flex-1 rounded-md py-2 text-sm font-medium transition-colors"
                  style={
                    form.type === t
                      ? { background: "rgba(99,102,241,0.22)", border: "1px solid #6366f1", color: "#fff" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#9ca3af" }
                  }
                >
                  {t === "url" ? "URL" : "Text Snippet"}
                </button>
              ))}
            </div>

            {/* Label */}
            <label className="mt-4 block text-xs font-medium text-gray-400">Label</label>
            <input
              type="text"
              value={form.label}
              placeholder={form.type === "url" ? "e.g., Open GitHub" : "e.g., My Email"}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="mt-1 w-full rounded-md bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
            />

            {form.type === "url" ? (
              <>
                <label className="mt-4 block text-xs font-medium text-gray-400">URL</label>
                <input
                  type="text"
                  value={form.url}
                  spellCheck={false}
                  placeholder="e.g., https://github.com or https://github.com/search?q={query}"
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  className="mt-1 w-full rounded-md bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600"
                  style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Use <span className="font-mono text-gray-400">{"{query}"}</span> to make it a search command. Whatever you type after the keyword will replace <span className="font-mono text-gray-400">{"{query}"}</span>.
                </p>

                {showFallbackField && (
                  <>
                    <label className="mt-4 block text-xs font-medium text-gray-400">
                      Fallback URL <span className="text-gray-600">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={form.fallback}
                      spellCheck={false}
                      placeholder="e.g., https://github.com (opens when no query is given)"
                      onChange={(e) => setForm((f) => ({ ...f, fallback: e.target.value }))}
                      className="mt-1 w-full rounded-md bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600"
                      style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-gray-400">Content</label>
                <textarea
                  value={form.content}
                  rows={3}
                  spellCheck={false}
                  placeholder="e.g., john.smith@gmail.com"
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  className="mt-1 w-full resize-none rounded-md bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600"
                  style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  This text will be copied to your clipboard for 1 minute, then automatically cleared.
                </p>
              </>
            )}

            {formError && <div className="mt-3 text-xs font-medium text-red-400">{formError}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/10"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                className="rounded-md px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
                style={canSave ? { background: "#6366f1" } : { background: "rgba(99,102,241,0.35)", cursor: "not-allowed" }}
                onClick={saveModal}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setDeleteConfirmId(null)}>
          <div className="w-80 rounded-xl p-5" style={{ background: "#1f1f2e", border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white">Delete this command?</div>
            <p className="mt-2 text-sm text-gray-400">This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/10" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-400" onClick={() => doDelete(deleteConfirmId)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation */}
      {showResetConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setShowResetConfirm(false)}>
          <div className="w-80 rounded-xl p-5" style={{ background: "#1f1f2e", border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white">Reset commands</div>
            <p className="mt-2 text-sm text-gray-400">Reset all commands to their default keywords?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/10" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400" onClick={doReset}>
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
