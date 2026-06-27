import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

type ResultKind = "app" | "command" | "process" | "calc" | "convert" | "websearch" | "prefix-hint" | "snippet";

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
}

interface AppSearchResult {
  id: number;
  name: string;
  path: string;
  score: number;
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

interface IndexStatus {
  ready: boolean;
  count: number;
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
  if (kind === "prefix-hint") return HINT_ROW_HEIGHT;
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
      const kw = cfg.builtin?.close?.keyword;
      if (kw) setCloseKeyword(kw);
    } catch {}
  }, []);

  useEffect(() => {
    loadCloseKeyword();
  }, [loadCloseKeyword]);

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

    const ck = closeKeyword;
    const ckLower = ck.toLowerCase();
    const ckHasSlash = ck.startsWith("/");
    const ql = query.toLowerCase();
    const closeArgMode = ql.startsWith(ckLower + " ");
    const closeExact = ql === ckLower;

    if (!indexReady && !query.startsWith("/") && !closeArgMode && !closeExact) return;

    debounceRef.current = setTimeout(async () => {
      try {
        let items: DisplayResult[] = [];

        if (closeArgMode) {
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

          const [evalResult, cmdResult, appResults, prefixHints] = await Promise.all([
            invoke<EvalResult | null>("evaluate_input", { query }).catch(() => null),
            invoke<CommandResult | null>("check_command", { query }).catch(() => null),
            invoke<AppSearchResult[]>("search_apps", { query }).catch(() => []),
            invoke<PrefixHint[]>("match_command_prefixes", { query }).catch(() => []),
          ]);

          // 1. Command prefix match (URL or snippet) is the top result.
          if (cmdResult) {
            items.push(commandResultToItem(cmdResult));
          }

          // 2. Calculator / unit converter.
          if (evalResult) {
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

        setResults(items);
        setSelectedIndex(0);
        resizeWindow(items);
      } catch (e) {
        console.error("Search failed:", e);
      }
    }, 30);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, resizeWindow, indexReady, closeKeyword]);

  const handleAction = useCallback(
    (item: DisplayResult) => {
      if (item.kind === "calc" || item.kind === "convert") {
        navigator.clipboard
          .writeText(item.copyValue ?? "")
          .then(() => {
            showToast("Copied to clipboard");
            hideWindow();
          })
          .catch(console.error);
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
    [hideWindow, showToast],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
            if (selected) handleAction(selected);
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
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
      }}
    >
      {/* Search bar */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-3 px-5"
        style={{
          height: BAR_HEIGHT,
          background: "rgba(24, 24, 32, 0.95)",
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
            background: "rgba(24, 24, 32, 0.95)",
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
                      background: isSelected ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.04)",
                      borderLeft: isSelected ? "2px solid #6366f1" : "2px solid transparent",
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

              if (result.kind === "prefix-hint") {
                return (
                  <div
                    key={`${result.kind}-${result.id}`}
                    className="result-enter flex cursor-pointer items-center px-4"
                    style={{
                      animationDelay: `${index * 20}ms`,
                      height: HINT_ROW_HEIGHT,
                      background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                      borderLeft: isSelected ? "2px solid #6366f1" : "2px solid transparent",
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
                    background: isSelected ? "rgba(255,255,255,0.07)" : "transparent",
                    borderLeft: isSelected ? "2px solid #6366f1" : "2px solid transparent",
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
                      {(result.kind === "websearch" || result.kind === "snippet") && (
                        <span className="mr-2">{result.icon}</span>
                      )}
                      {result.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {result.detail}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {isSelected && (
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">
                        {result.kind === "websearch"
                          ? "⏎ Open"
                          : result.kind === "snippet"
                            ? "⏎ Copy"
                            : "⏎"}
                      </span>
                    )}
                    {!isSelected && result.tag && (
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
            background: "rgba(24, 24, 32, 0.98)",
            borderRadius: 15,
          }}
        >
          <div className="text-center px-8">
            <div className="text-2xl font-bold text-white mb-2">Keystrike is ready!</div>
            <div className="text-sm text-gray-400 mb-1">
              {indexCount} apps indexed
            </div>
            <div className="text-sm text-gray-400 mb-5">
              Press <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-gray-200">Alt+Space</span> anytime to launch.
            </div>
            <button
              className="rounded-lg bg-indigo-500 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
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
