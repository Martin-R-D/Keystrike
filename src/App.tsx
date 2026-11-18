import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

type ResultKind = "app" | "command" | "process" | "calc" | "convert" | "color" | "websearch" | "prefix-hint" | "snippet" | "note-save" | "note-item" | "clip-item" | "window" | "file" | "script-item" | "quick-action";

interface DisplayResult {
  id: number;
  name: string;
  detail: string;
  kind: ResultKind;
  meta?: string;
  copyValue?: string;
  icon?: string;
  url?: string;
  tag?: string;
  isPinned?: boolean;
  confirm?: boolean;
}

interface AppSearchResult {
  id: number;
  name: string;
  path: string;
  score: number;
  is_pinned: boolean;
}

interface ProcessInfo {
  name: string;
  exe: string;
}

interface EvalResult {
  result_type: string;
  expression: string;
  result: number;
  display: string;
  input_unit: string | null;
  output_unit: string | null;
  color_hex: string | null;
  color_rgb: string | null;
  color_hsl: string | null;
}

interface WebSearchResult {
  provider_name: string;
  search_query: string;
  full_url: string;
  icon: string;
}

interface CommandResult {
  id: string;
  kind: "url" | "snippet";
  label: string;
  icon: string;
  query: string;
  url: string | null;
  content: string | null;
}

interface PrefixHint {
  keyword: string;
  label: string;
  icon: string;
  kind: string;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  confirm: boolean;
}

interface ClipEntry {
  id: number;
  text: string;
  copied_at: number;
}

function timeAgo(epochSecs: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSecs);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface WindowInfo {
  hwnd: number;
  title: string;
}

interface FileHit {
  name: string;
  path: string;
  is_dir: boolean;
}

interface ScriptInfo {
  keyword: string;
  file_name: string;
}

interface ScriptResultItem {
  title: string;
  subtitle: string;
  copy: string;
  url: string | null;
}

interface IndexStatus {
  ready: boolean;
  count: number;
}

interface NoteEntry {
  text: string;
  timestamp: string;
}

const DEFAULT_CLOSE_KEYWORD = "/close";

const BAR_HEIGHT = 72;
const ROW_HEIGHT = 48;
const EVAL_ROW_HEIGHT = 56;
const HINT_ROW_HEIGHT = 36;
const MAX_VISIBLE = 8;
const MAX_HEIGHT = BAR_HEIGHT + MAX_VISIBLE * ROW_HEIGHT;

function rowHeight(kind: ResultKind): number {
  if (kind === "calc" || kind === "convert") return EVAL_ROW_HEIGHT;
  if (kind === "color") return 68;
  if (kind === "prefix-hint") return HINT_ROW_HEIGHT;
  if (kind === "note-item" || kind === "clip-item") return 52;
  return ROW_HEIGHT;
}

function commandResultToItem(c: CommandResult): DisplayResult {
  if (c.kind === "snippet") {
    const preview = (c.content ?? "").replace(/\s+/g, " ").slice(0, 50);
    return {
      id: -2,
      name: c.label,
      detail: preview,
      kind: "snippet",
      icon: c.icon,
      copyValue: c.content ?? "",
      tag: "Snippet",
    };
  }
  return {
    id: -2,
    name: c.query ? `${c.label} – '${c.query}'` : c.label,
    detail: c.url ?? "",
    kind: "websearch",
    icon: c.icon,
    url: c.url ?? "",
    tag: "Web",
  };
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [indexReady, setIndexReady] = useState(false);
  const [indexCount, setIndexCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [windowVisible, setWindowVisible] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [closeKeyword, setCloseKeyword] = useState(DEFAULT_CLOSE_KEYWORD);
  const [noteKeyword, setNoteKeyword] = useState("note");
  const [notesKeyword, setNotesKeyword] = useState("notes");
  const [clipKeyword, setClipKeyword] = useState("clip");
  const [snipKeyword, setSnipKeyword] = useState("snip");
  const [winKeyword, setWinKeyword] = useState("win");
  const [fileKeyword, setFileKeyword] = useState("file");
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [hotkey, setHotkey] = useState("Alt+Space");
  // Id of a destructive quick action waiting for a second Enter to confirm.
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const status = await invoke<IndexStatus>("get_index_status");
        if (status.ready) {
          setIndexReady(true);
          setIndexCount(status.count);
          clearInterval(poll);
          try {
            const first = await invoke<boolean>("is_first_launch");
            if (first) {
              setShowWelcome(true);
              await appWindow.setSize(new LogicalSize(680, 220));
              await appWindow.show();
              await appWindow.setFocus();
            }
          } catch {}
        }
      } catch {}
    }, 200);
    return () => clearInterval(poll);
  }, []);

  const positionRestored = useRef(false);

  useEffect(() => {
    const restorePosition = async () => {
      try {
        const saved = await invoke<{ x: number; y: number } | null>("load_position");
        if (saved) {
          await appWindow.setPosition(new LogicalPosition(saved.x, saved.y));
        }
      } catch {}
      positionRestored.current = true;
    };
    restorePosition();
  }, []);

  const loadCloseKeyword = useCallback(async () => {
    try {
      const cfg = await invoke<{ builtin: Record<string, { keyword: string }> }>(
        "get_all_commands",
      );
      if (cfg.builtin?.close?.keyword) setCloseKeyword(cfg.builtin.close.keyword);
      if (cfg.builtin?.note?.keyword) setNoteKeyword(cfg.builtin.note.keyword);
      if (cfg.builtin?.notes?.keyword) setNotesKeyword(cfg.builtin.notes.keyword);
      if (cfg.builtin?.clip?.keyword) setClipKeyword(cfg.builtin.clip.keyword);
      if (cfg.builtin?.snippets?.keyword) setSnipKeyword(cfg.builtin.snippets.keyword);
      if (cfg.builtin?.windows?.keyword) setWinKeyword(cfg.builtin.windows.keyword);
      if (cfg.builtin?.files?.keyword) setFileKeyword(cfg.builtin.files.keyword);
    } catch {}
    try {
      setScripts(await invoke<ScriptInfo[]>("get_scripts"));
    } catch {}
  }, []);

  useEffect(() => {
    loadCloseKeyword();
  }, [loadCloseKeyword]);

  useEffect(() => {
    invoke<string>("get_hotkey").then(setHotkey).catch(() => {});
  }, []);

  useEffect(() => {
    const onFocus = () => {
      setWindowVisible(true);
      inputRef.current?.focus();
      // Pick up keyword changes made in the settings window.
      loadCloseKeyword();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadCloseKeyword]);

  const resizeWindow = useCallback(async (items: DisplayResult[]) => {
    let h = BAR_HEIGHT;
    for (let i = 0; i < Math.min(items.length, MAX_VISIBLE); i++) {
      h += rowHeight(items[i].kind);
    }
    h = Math.min(h, MAX_HEIGHT);
    await appWindow.setSize(new LogicalSize(680, h));
  }, []);

  const hideWindow = useCallback(async () => {
    try {
      const pos = await appWindow.outerPosition();
      const scale = await appWindow.scaleFactor();
      await invoke("save_position", {
        x: pos.x / scale,
        y: pos.y / scale,
      });
    } catch {}
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    setWindowVisible(false);
    await appWindow.setSize(new LogicalSize(680, BAR_HEIGHT));
    await appWindow.hide();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPendingConfirm(null);

    const ck = closeKeyword;
    const ckLower = ck.toLowerCase();
    const ckHasSlash = ck.startsWith("/");
    const ql = query.toLowerCase();
    const closeArgMode = ql.startsWith(ckLower + " ");
    const closeExact = ql === ckLower;
    const noteArgMode = ql.startsWith(noteKeyword.toLowerCase() + " ");
    const notesExact = ql === notesKeyword.toLowerCase();
    const clipLower = clipKeyword.toLowerCase();
    const clipMode = ql === clipLower || ql.startsWith(clipLower + " ");
    const snipLower = snipKeyword.toLowerCase();
    const snipMode = ql === snipLower || ql.startsWith(snipLower + " ");
    const winLower = winKeyword.toLowerCase();
    const winMode = ql === winLower || ql.startsWith(winLower + " ");
    const fileLower = fileKeyword.toLowerCase();
    const fileMode = ql === fileLower || ql.startsWith(fileLower + " ");
    const scriptWord = ql.split(" ")[0];
    const scriptMatch = scripts.find((sc) => sc.keyword === scriptWord);
    const scriptMode = !!scriptMatch && (ql === scriptWord || ql.startsWith(scriptWord + " "));

    if (!indexReady && !query.startsWith("/") && !closeArgMode && !closeExact && !noteArgMode && !notesExact && !clipMode && !snipMode && !winMode && !fileMode && !scriptMode) return;

    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      try {
        let items: DisplayResult[] = [];

        if (scriptMode && scriptMatch) {
          const arg = query.slice(scriptWord.length).trim();
          try {
            const out = await invoke<ScriptResultItem[]>("run_script", {
              keyword: scriptMatch.keyword,
              args: arg,
            });
            items = out.length === 0
              ? [{
                  id: -90,
                  name: "Script returned no output",
                  detail: scriptMatch.file_name,
                  kind: "note-item" as ResultKind,
                  tag: "Script",
                }]
              : out.map((r, i) => ({
                  id: -300 - i,
                  name: r.title,
                  detail: r.subtitle,
                  kind: "script-item" as ResultKind,
                  copyValue: r.copy,
                  url: r.url ?? undefined,
                  icon: "⚙️",
                  tag: "Script",
                }));
          } catch (err) {
            items = [{
              id: -91,
              name: "Script failed",
              detail: String(err),
              kind: "note-item",
              tag: "Script",
            }];
          }
        } else if (fileMode) {
          const arg = query.slice(fileKeyword.length).trim();
          if (!arg) {
            items = [{
              id: -80,
              name: "Search your files",
              detail: `Type "${fileKeyword} <name>" to find files and folders`,
              kind: "note-item",
              tag: "Files",
            }];
          } else {
            const hits = await invoke<FileHit[]>("search_files", { query: arg }).catch(() => []);
            items = hits.length === 0
              ? [{
                  id: -81,
                  name: "No matching files",
                  detail: "Searches Desktop, Documents, Downloads, Pictures, Videos and Music",
                  kind: "note-item" as ResultKind,
                  tag: "Files",
                }]
              : hits.map((h, i) => ({
                  id: -200 - i,
                  name: h.name,
                  detail: h.path,
                  kind: "file" as ResultKind,
                  icon: h.is_dir ? "📁" : "📄",
                  meta: h.path,
                  tag: h.is_dir ? "Folder" : "File",
                }));
          }
        } else if (winMode) {
          const arg = query.slice(winKeyword.length).trim();
          const wins = await invoke<WindowInfo[]>("search_windows", { query: arg }).catch(() => []);
          if (wins.length === 0) {
            items = [{
              id: -70,
              name: arg ? "No matching windows" : "No open windows found",
              detail: arg ? "Try a different search" : "",
              kind: "note-item",
              tag: "Window",
            }];
          } else {
            items = wins.map((w) => ({
              id: w.hwnd,
              name: w.title,
              detail: "Switch to this window",
              kind: "window" as ResultKind,
              meta: String(w.hwnd),
              tag: "Window",
            }));
          }
        } else if (snipMode) {
          const arg = query.slice(snipKeyword.length).trim();
          const snippets = await invoke<CommandResult[]>("search_snippets", { query: arg }).catch(() => []);
          if (snippets.length === 0) {
            items = [{
              id: -60,
              name: arg ? "No matching snippets" : "No snippets yet",
              detail: arg ? "Try a different search" : "Add one in Settings → Commands",
              kind: "note-item",
              tag: "Snippet",
            }];
          } else {
            items = snippets.slice(0, MAX_VISIBLE).map((c, i) => ({
              id: -100 - i,
              name: c.label,
              detail: (c.content ?? "").replace(/\s+/g, " ").slice(0, 50),
              kind: "snippet" as ResultKind,
              icon: c.icon,
              copyValue: c.content ?? "",
              tag: "Snippet",
            }));
          }
        } else if (clipMode) {
          const arg = query.slice(clipKeyword.length).trim();
          const clips = await invoke<ClipEntry[]>("search_clipboard_history", { query: arg }).catch(() => []);
          if (clips.length === 0) {
            items = [{
              id: -50,
              name: arg ? "No matching clipboard entries" : "Clipboard history is empty",
              detail: arg ? "Try a different search" : "Copy some text and it will show up here",
              kind: "clip-item",
              tag: "Clipboard",
            }];
          } else {
            items = clips.slice(0, MAX_VISIBLE).map((c) => ({
              id: c.id,
              name: c.text.replace(/\s+/g, " ").trim().slice(0, 90),
              detail: timeAgo(c.copied_at),
              kind: "clip-item" as ResultKind,
              copyValue: c.text,
              tag: "Clipboard",
            }));
          }
        } else if (noteArgMode) {
          const text = query.slice(noteKeyword.length + 1).trim();
          items = [{
            id: -30,
            name: `Save note: "${text}"`,
            detail: "Saves to your scratchpad",
            kind: "note-save",
            copyValue: text,
            tag: "Note",
          }];
        } else if (notesExact) {
          const noteList = await invoke<NoteEntry[]>("get_notes").catch(() => []);
          if (noteList.length === 0) {
            items = [{
              id: -31,
              name: "No notes yet",
              detail: `Type "${noteKeyword} <text>" to save one`,
              kind: "note-item",
              tag: "Note",
            }];
          } else {
            items = noteList.map((n, i) => ({
              id: -31 - i,
              name: n.text,
              detail: n.timestamp,
              kind: "note-item" as ResultKind,
              copyValue: n.text,
              tag: "Note",
            }));
          }
        } else if (closeArgMode) {
          // Close command with a target -> list running processes to kill.
          const arg = query.slice(ck.length + 1).trim();
          const procs = await invoke<ProcessInfo[]>("search_running_apps", {
            query: arg,
          });
          items = procs.map((p, i) => ({
            id: i,
            name: p.name,
            detail: p.exe,
            kind: "process",
            meta: p.exe,
            tag: "Process",
          }));

          // App/file results still show below, so an app literally named like
          // the keyword can still be launched.
          if (indexReady) {
            const appResults = await invoke<AppSearchResult[]>("search_apps", {
              query,
            }).catch(() => []);
            items.push(
              ...appResults.map((r) => ({
                id: r.id,
                name: r.name,
                detail: r.path,
                kind: "app" as ResultKind,
                tag: "App",
                isPinned: r.is_pinned,
              })),
            );
          }
        } else if (query.startsWith("/")) {
          // Slash queries: close-command discovery + any slash-prefixed
          // custom commands. (No app/Google-fallback noise here.)
          const afterSlash = query.slice(1);
          if (afterSlash.indexOf(" ") === -1 && ckHasSlash && ckLower.startsWith(ql)) {
            items.push({
              id: -20,
              name: ck,
              detail: "Close a running application",
              kind: "command",
              tag: "Command",
            });
          }
          const cmdResult = await invoke<CommandResult | null>("check_command", { query }).catch(() => null);
          if (cmdResult) {
            items.push(commandResultToItem(cmdResult));
          } else {
            const prefixHints = await invoke<PrefixHint[]>("match_command_prefixes", { query }).catch(() => []);
            for (let i = 0; i < Math.min(prefixHints.length, 2); i++) {
              const h = prefixHints[i];
              items.push({ id: -10 - i, name: h.keyword, detail: h.label, kind: "prefix-hint", icon: h.icon });
            }
          }
        } else if (query.length > 0) {
          // When the close keyword has no slash and is typed exactly, offer it
          // as a command (apps/files still appear below).
          if (closeExact && !ckHasSlash) {
            items.push({
              id: -20,
              name: ck,
              detail: "Close a running application",
              kind: "command",
              tag: "Command",
            });
          }

          const [evalResult, cmdResult, appResults, prefixHints, quickActions] = await Promise.all([
            invoke<EvalResult | null>("evaluate_input", { query }).catch(() => null),
            invoke<CommandResult | null>("check_command", { query }).catch(() => null),
            invoke<AppSearchResult[]>("search_apps", { query }).catch(() => []),
            invoke<PrefixHint[]>("match_command_prefixes", { query }).catch(() => []),
            invoke<QuickAction[]>("search_quick_actions", { query }).catch(() => []),
          ]);

          // 1. Command prefix match (URL or snippet) is the top result.
          if (cmdResult) {
            items.push(commandResultToItem(cmdResult));
          }

          // 2. Calculator / unit converter / color picker.
          if (evalResult) {
            if (evalResult.result_type === "color") {
              items.push({
                id: -1,
                name: evalResult.color_hex ?? evalResult.display,
                detail: `${evalResult.color_rgb}  ·  ${evalResult.color_hsl}`,
                kind: "color",
                copyValue: evalResult.color_hex ?? evalResult.display,
                meta: evalResult.color_hex ?? "",
                tag: "Color",
              });
            } else {
              const isCalc = evalResult.result_type === "calculator";
              items.push({
                id: -1,
                name: isCalc ? evalResult.expression : evalResult.display,
                detail: isCalc ? `= ${evalResult.display}` : "",
                kind: isCalc ? "calc" : "convert",
                copyValue: String(evalResult.result),
                tag: isCalc ? "Calculator" : "Converter",
              });
            }
          }

          // Partial-keyword hints when nothing matched exactly.
          if (!cmdResult && prefixHints.length > 0) {
            for (let i = 0; i < Math.min(prefixHints.length, 2); i++) {
              const h = prefixHints[i];
              items.push({
                id: -10 - i,
                name: h.keyword,
                detail: h.label,
                kind: "prefix-hint",
                icon: h.icon,
              });
            }
          }

          // 3. App fuzzy search (always shown below command matches).
          items.push(
            ...appResults.map((r) => ({
              id: r.id,
              name: r.name,
              detail: r.path,
              kind: "app" as ResultKind,
              tag: "App",
              isPinned: r.is_pinned,
            })),
          );

          // 3b. System quick actions (lock, sleep, restart, ...).
          items.push(
            ...quickActions.map((a) => ({
              id: -40,
              name: a.label,
              detail: a.description,
              kind: "quick-action" as ResultKind,
              icon: a.icon,
              meta: a.id,
              confirm: a.confirm,
              tag: "System",
            })),
          );

          // 4. Google fallback when no command matched.
          if (!cmdResult && prefixHints.length === 0 && query.trim().length > 0) {
            const fallback = await invoke<WebSearchResult>("get_google_fallback", { query }).catch(() => null);
            if (fallback) {
              items.push({
                id: -3,
                name: `Search Google for '${fallback.search_query}'`,
                detail: fallback.full_url,
                kind: "websearch",
                icon: fallback.icon,
                url: fallback.full_url,
                tag: "Web",
              });
            }
          }
        }

        if (cancelled) return;
        setResults(items);
        setSelectedIndex(0);
        resizeWindow(items);
      } catch (e) {
        console.error("Search failed:", e);
      }
    }, scriptMode ? 250 : 30);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, resizeWindow, indexReady, closeKeyword, noteKeyword, notesKeyword, clipKeyword, snipKeyword, winKeyword, fileKeyword, scripts]);

  const handleAction = useCallback(
    (item: DisplayResult) => {
      if (item.kind === "calc" || item.kind === "convert" || item.kind === "color") {
        navigator.clipboard
          .writeText(item.copyValue ?? "")
          .then(() => {
            showToast("Copied to clipboard");
            hideWindow();
          })
          .catch(console.error);
      } else if (item.kind === "note-save") {
        invoke("save_note", { text: item.copyValue ?? "" })
          .then(() => {
            showToast("Note saved");
            hideWindow();
          })
          .catch(console.error);
      } else if (item.kind === "note-item" || item.kind === "clip-item") {
        if (item.copyValue) {
          navigator.clipboard
            .writeText(item.copyValue)
            .then(() => {
              showToast("Copied to clipboard");
              hideWindow();
            })
            .catch(console.error);
        }
      } else if (item.kind === "prefix-hint") {
        setQuery(item.name + " ");
        inputRef.current?.focus();
      } else if (item.kind === "websearch") {
        invoke("open_url", { url: item.url })
          .then(() => hideWindow())
          .catch(console.error);
      } else if (item.kind === "snippet") {
        invoke("execute_snippet", { content: item.copyValue ?? "" })
          .then(() => {
            showToast("Copied to clipboard (clears in 1 min)");
            setTimeout(() => hideWindow(), 1400);
          })
          .catch(console.error);
      } else if (item.kind === "quick-action") {
        const actionId = item.meta ?? "";
        if (item.confirm && pendingConfirm !== actionId) {
          setPendingConfirm(actionId);
          showToast(`Press Enter again to confirm: ${item.name}`);
          return;
        }
        setPendingConfirm(null);
        invoke("run_quick_action", { id: actionId })
          .then(() => hideWindow())
          .catch((err) => showToast(`Failed: ${err}`));
      } else if (item.kind === "script-item") {
        if (item.url) {
          invoke("open_url", { url: item.url })
            .then(() => hideWindow())
            .catch(console.error);
        } else if (item.copyValue) {
          navigator.clipboard
            .writeText(item.copyValue)
            .then(() => {
              showToast("Copied to clipboard");
              hideWindow();
            })
            .catch(console.error);
        }
      } else if (item.kind === "file") {
        invoke("open_path", { path: item.meta })
          .then(() => hideWindow())
          .catch((err) => showToast(`Failed: ${err}`));
      } else if (item.kind === "window") {
        // Hide first so focus can move to the chosen window.
        hideWindow().then(() =>
          invoke("focus_window", { hwnd: Number(item.meta) }).catch((err) =>
            console.error("focus_window failed:", err),
          ),
        );
      } else if (item.kind === "app") {
        invoke<string>("launch_app", { id: item.id })
          .then(() => hideWindow())
          .catch((err) => {
            showToast(String(err));
          });
      } else if (item.kind === "command") {
        setQuery(item.name + " ");
        inputRef.current?.focus();
      } else if (item.kind === "process") {
        invoke("close_process", { name: item.meta ?? item.detail })
          .then(() => hideWindow())
          .catch(console.error);
      }
    },
    [hideWindow, showToast, pendingConfirm],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" && e.ctrlKey) {
        const selected = results[selectedIndex];
        if (selected?.kind === "clip-item" && selected.copyValue) {
          e.preventDefault();
          invoke("remove_clipboard_entry", { id: selected.id })
            .then(() => {
              setResults((prev) => prev.filter((r) => !(r.kind === "clip-item" && r.id === selected.id)));
              setSelectedIndex((i) => Math.max(0, i - 1));
              showToast("Removed from history");
            })
            .catch(console.error);
        }
        return;
      }

      if (e.key === "p" && e.ctrlKey) {
        const selected = results[selectedIndex];
        if (selected?.kind === "app") {
          e.preventDefault();
          invoke<boolean>("toggle_pin", { id: selected.id })
            .then((nowPinned) => {
              showToast(nowPinned ? "Pinned" : "Unpinned");
              // Refresh results so pin order and icon update immediately.
              setResults((prev) =>
                prev.map((r) =>
                  r.id === selected.id ? { ...r, isPinned: nowPinned } : r,
                ),
              );
            })
            .catch(console.error);
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          hideWindow();
          break;
        case "ArrowDown":
        case "Tab":
          if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            setSelectedIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
          } else {
            e.preventDefault();
            setSelectedIndex((i) => (i >= results.length - 1 ? 0 : i + 1));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
          break;
        case "Enter":
          if (results.length > 0) {
            e.preventDefault();
            const selected = results[selectedIndex];
            if (selected?.kind === "file" && e.ctrlKey) {
              invoke("reveal_path", { path: selected.meta })
                .then(() => hideWindow())
                .catch((err) => showToast(`Failed: ${err}`));
            } else if (selected) {
              handleAction(selected);
            }
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, hideWindow, handleAction]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const hasResults = results.length > 0;

  return (
    <div
      className="flex w-screen flex-col"
      style={{
        border: "1px solid rgba(var(--fg-rgb), 0.08)",
        borderRadius: 16,
      }}
    >
      {/* Search bar */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-3 px-5"
        style={{
          height: BAR_HEIGHT,
          background: "var(--panel-bg)",
          borderRadius: hasResults ? "15px 15px 0 0" : 15,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: hasResults ? "none" : "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        {!indexReady ? (
          <svg className="h-5 w-5 shrink-0 text-indigo-400 spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            className={`h-5 w-5 shrink-0 text-gray-400 ${windowVisible ? "search-icon-pulse" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="m21 21-4.35-4.35" />
          </svg>
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={indexReady ? "Type to search..." : `Indexing apps...`}
          disabled={!indexReady}
          className="flex-1 bg-transparent text-lg text-white outline-none placeholder:text-gray-500 disabled:cursor-wait"
          autoFocus
        />
        {indexReady && indexCount > 0 && query === "" && (
          <span className="shrink-0 text-xs text-gray-600">{indexCount} apps</span>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Settings"
          title="Settings"
          className="settings-gear flex shrink-0 items-center justify-center text-gray-500"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            invoke("open_settings_window").catch(console.error);
          }}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Results */}
      {hasResults && (
        <div
          style={{
            background: "var(--panel-bg)",
            borderRadius: "0 0 15px 15px",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            maxHeight: MAX_HEIGHT - BAR_HEIGHT,
            overflowY: "auto",
          }}
        >
          <div className="mx-3 h-px bg-white/10" />
          <div ref={listRef}>
            {results.map((result, index) => {
              const isSelected = index === selectedIndex;
              const isEval = result.kind === "calc" || result.kind === "convert";
              const isLast = index === results.length - 1;
              const radius = isLast ? "0 0 15px 15px" : undefined;

              if (isEval) {
                return (
                  <div
                    key={`${result.kind}-${result.id}`}
                    className="result-enter flex cursor-pointer items-center justify-between px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: EVAL_ROW_HEIGHT,
                      background: isSelected ? "rgba(var(--accent-rgb), 0.12)" : "rgba(var(--accent-rgb), 0.04)",
                      borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                      borderRadius: radius,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => handleAction(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base shrink-0 opacity-70">
                        {result.kind === "calc" ? "=" : "📐"}
                      </span>
                      <div className="min-w-0 overflow-hidden">
                        <div className="truncate text-sm text-gray-300">
                          {result.name}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <span className="text-lg font-semibold text-white">
                        {result.kind === "calc" ? result.detail.replace("= ", "") : result.copyValue}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">
                          &#x23CE; Copy
                        </span>
                      )}
                      {!isSelected && result.tag && (
                        <span className="text-[10px] text-gray-600 whitespace-nowrap">{result.tag}</span>
                      )}
                    </div>
                  </div>
                );
              }

              if (result.kind === "note-save") {
                return (
                  <div
                    key={`note-save-${result.id}`}
                    className="result-enter flex cursor-pointer items-center justify-between px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: ROW_HEIGHT,
                      background: isSelected ? "rgba(234, 179, 8, 0.1)" : "rgba(234, 179, 8, 0.03)",
                      borderLeft: isSelected ? "2px solid #eab308" : "2px solid transparent",
                      borderRadius: radius,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => handleAction(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base shrink-0 opacity-70">📝</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{result.name}</div>
                        <div className="text-xs text-gray-500">{result.detail}</div>
                      </div>
                    </div>
                    <div className="shrink-0 ml-3">
                      {isSelected ? (
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">⏎ Save</span>
                      ) : (
                        <span className="text-[10px] text-gray-600 whitespace-nowrap">Note</span>
                      )}
                    </div>
                  </div>
                );
              }

              if (result.kind === "note-item" || result.kind === "clip-item") {
                return (
                  <div
                    key={`note-item-${result.id}`}
                    className="result-enter flex cursor-pointer items-center justify-between px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: 52,
                      background: isSelected ? "rgba(var(--fg-rgb), 0.07)" : "transparent",
                      borderLeft: isSelected ? `2px solid ${result.kind === "clip-item" ? "var(--accent)" : "#eab308"}` : "2px solid transparent",
                      borderRadius: radius,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => handleAction(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">{result.name}</div>
                      {result.detail && (
                        <div className="text-[11px] text-gray-600">{result.detail}</div>
                      )}
                    </div>
                    <div className="shrink-0 ml-3">
                      {isSelected ? (
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">
                          {result.kind === "clip-item" && result.copyValue ? "^Del Remove  ⏎ Copy" : "⏎ Copy"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-600 whitespace-nowrap">{result.tag ?? "Note"}</span>
                      )}
                    </div>
                  </div>
                );
              }

              if (result.kind === "color") {
                return (
                  <div
                    key={`color-${result.id}`}
                    className="result-enter flex cursor-pointer items-center justify-between px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: 68,
                      background: isSelected ? "rgba(var(--fg-rgb), 0.06)" : "rgba(var(--fg-rgb), 0.02)",
                      borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                      borderRadius: radius,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => handleAction(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: result.meta,
                          flexShrink: 0,
                          border: "1px solid rgba(var(--fg-rgb), 0.15)",
                          boxShadow: `0 0 12px 2px ${result.meta}55`,
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{result.name}</div>
                        <div className="text-xs text-gray-500 truncate">{result.detail}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {isSelected ? (
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">&#x23CE; Copy hex</span>
                      ) : (
                        <span className="text-[10px] text-gray-600 whitespace-nowrap">Color</span>
                      )}
                    </div>
                  </div>
                );
              }

              if (result.kind === "prefix-hint") {
                return (
                  <div
                    key={`${result.kind}-${result.id}`}
                    className="result-enter flex cursor-pointer items-center px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: HINT_ROW_HEIGHT,
                      background: isSelected ? "rgba(var(--fg-rgb), 0.05)" : "transparent",
                      borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                      borderRadius: radius,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => handleAction(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{result.icon}</span>
                      <span className="text-[11px] text-gray-500">
                        Type{" "}
                        <span className="rounded bg-white/10 px-1 py-0.5 font-mono text-gray-300">
                          {result.name}
                        </span>{" "}
                        &middot; {result.detail}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`${result.kind}-${result.id}`}
                  className="result-enter flex cursor-pointer items-center justify-between px-4"
                  style={{
                    animationDelay: `${index * 20}ms`,
                    height: ROW_HEIGHT,
                    background: isSelected ? "rgba(var(--fg-rgb), 0.07)" : "transparent",
                    borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                    borderRadius: radius,
                    transition: "background 100ms ease",
                  }}
                  onClick={() => handleAction(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="min-w-0 overflow-hidden">
                    <div className="truncate text-sm font-medium text-white">
                      {result.kind === "process" && (
                        <span className="mr-2 text-red-400 text-xs">&#x2715;</span>
                      )}
                      {result.kind === "command" && (
                        <span className="mr-2 text-red-400 text-xs">&#x2715;</span>
                      )}
                      {(result.kind === "websearch" || result.kind === "snippet" || result.kind === "quick-action" || result.kind === "file" || result.kind === "script-item") && (
                        <span className="mr-2">{result.icon}</span>
                      )}
                      {result.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {result.detail}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {result.isPinned && (
                      <span className="text-[11px] opacity-60" title="Pinned">📌</span>
                    )}
                    {isSelected && (
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">
                        {result.kind === "app"
                          ? (result.isPinned ? "^P Unpin  ⏎" : "^P Pin  ⏎")
                          : result.kind === "websearch"
                            ? "⏎ Open"
                            : result.kind === "snippet"
                              ? "⏎ Copy"
                              : result.kind === "script-item"
                                ? (result.url ? "⏎ Open" : "⏎ Copy")
                              : result.kind === "file"
                                ? "^⏎ Show in folder  ⏎ Open"
                              : result.kind === "window"
                                ? "⏎ Switch"
                              : result.kind === "quick-action"
                                ? (result.confirm && pendingConfirm === result.meta ? "⏎ Confirm" : "⏎ Run")
                                : "⏎"}
                      </span>
                    )}
                    {!isSelected && !result.isPinned && result.tag && (
                      <span className="text-[10px] text-gray-600 whitespace-nowrap">{result.tag}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Welcome overlay */}
      {showWelcome && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center"
          style={{
            background: "var(--panel-bg-solid)",
            borderRadius: 15,
          }}
        >
          <div className="text-center px-8">
            <div className="text-2xl font-bold text-white mb-2">Keystrike is ready!</div>
            <div className="text-sm text-gray-400 mb-1">
              {indexCount} apps indexed
            </div>
            <div className="text-sm text-gray-400 mb-5">
              Press <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-gray-200">{hotkey}</span> anytime to launch.
            </div>
            <button
              className="rounded-lg bg-indigo-500 px-5 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-indigo-400"
              onClick={async () => {
                invoke("mark_first_launch_done").catch(console.error);
                setShowWelcome(false);
                await appWindow.setSize(new LogicalSize(680, BAR_HEIGHT));
                inputRef.current?.focus();
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-xs font-medium shadow-lg"
          style={{
            bottom: 12,
            background: toast.startsWith("Failed") ? "rgba(239, 68, 68, 0.9)" : "rgba(34, 197, 94, 0.9)",
            color: "white",
            backdropFilter: "blur(8px)",
            zIndex: 50,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
