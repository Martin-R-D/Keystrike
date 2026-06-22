import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

type ResultKind = "app" | "command" | "process" | "calc" | "convert" | "websearch" | "prefix-hint";

interface DisplayResult {
  id: number;
  name: string;
  detail: string;
  kind: ResultKind;
  meta?: string;
  copyValue?: string;
  icon?: string;
  url?: string;
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

const COMMANDS = [{ name: "close", description: "Close a running application" }];

const BAR_HEIGHT = 72;
const ROW_HEIGHT = 52;
const EVAL_ROW_HEIGHT = 60;
const MAX_RESULTS = 8;

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resizeWindow = useCallback(async (items: DisplayResult[]) => {
    let height = BAR_HEIGHT;
    const count = Math.min(items.length, MAX_RESULTS);
    for (let i = 0; i < count; i++) {
      const k = items[i].kind;
      if (k === "calc" || k === "convert") height += EVAL_ROW_HEIGHT;
      else if (k === "prefix-hint") height += 40;
      else height += ROW_HEIGHT;
    }
    await appWindow.setSize(new LogicalSize(680, height));
  }, []);

  const hideWindow = useCallback(async () => {
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    await appWindow.setSize(new LogicalSize(680, BAR_HEIGHT));
    await appWindow.hide();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        let items: DisplayResult[] = [];

        if (query.startsWith("/")) {
          const afterSlash = query.slice(1);
          const spaceIdx = afterSlash.indexOf(" ");

          if (spaceIdx === -1) {
            items = COMMANDS.filter((c) =>
              c.name.startsWith(afterSlash.toLowerCase()),
            ).map((c, i) => ({
              id: i,
              name: `/${c.name}`,
              detail: c.description,
              kind: "command",
            }));
          } else {
            const cmd = afterSlash.slice(0, spaceIdx).toLowerCase();
            const arg = afterSlash.slice(spaceIdx + 1).trim();

            if (cmd === "close") {
              const procs = await invoke<ProcessInfo[]>(
                "search_running_apps",
                { query: arg },
              );
              items = procs.map((p, i) => ({
                id: i,
                name: p.name,
                detail: p.exe,
                kind: "process",
                meta: p.exe,
              }));
            }
          }
        } else if (query.length > 0) {
          const [evalResult, webResult, appResults, prefixHints] = await Promise.all([
            invoke<EvalResult | null>("evaluate_input", { query }).catch(() => null),
            invoke<WebSearchResult | null>("check_web_search", { query }).catch(() => null),
            invoke<AppSearchResult[]>("search_apps", { query }).catch(() => []),
            invoke<WebSearchResult[]>("match_search_providers", { query }).catch(() => []),
          ]);

          if (evalResult) {
            const isCalc = evalResult.result_type === "calculator";
            items.push({
              id: -1,
              name: isCalc ? evalResult.expression : evalResult.display,
              detail: isCalc ? `= ${evalResult.display}` : "",
              kind: isCalc ? "calc" : "convert",
              copyValue: String(evalResult.result),
            });
          }

          if (webResult) {
            const label = webResult.search_query
              ? `Search ${webResult.provider_name} for '${webResult.search_query}'`
              : `Search ${webResult.provider_name}...`;
            items.push({
              id: -2,
              name: label,
              detail: webResult.full_url,
              kind: "websearch",
              icon: webResult.icon,
              url: webResult.full_url,
            });
          }

          if (!webResult && prefixHints.length > 0) {
            for (let i = 0; i < Math.min(prefixHints.length, 2); i++) {
              const h = prefixHints[i];
              items.push({
                id: -10 - i,
                name: h.full_url.trim(),
                detail: h.provider_name,
                kind: "prefix-hint",
                icon: h.icon,
              });
            }
          }

          const appItems = appResults.map((r) => ({
            id: r.id,
            name: r.name,
            detail: r.path,
            kind: "app" as ResultKind,
          }));
          items.push(...appItems);

          if (!webResult && prefixHints.length === 0 && query.trim().length > 0) {
            const fallback = await invoke<WebSearchResult>("get_google_fallback", { query }).catch(() => null);
            if (fallback) {
              items.push({
                id: -3,
                name: `Search Google for '${fallback.search_query}'`,
                detail: fallback.full_url,
                kind: "websearch",
                icon: fallback.icon,
                url: fallback.full_url,
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
    }, 50);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, resizeWindow]);

  const handleAction = useCallback(
    (item: DisplayResult) => {
      if (item.kind === "calc" || item.kind === "convert") {
        navigator.clipboard
          .writeText(item.copyValue ?? "")
          .then(() => hideWindow())
          .catch(console.error);
      } else if (item.kind === "prefix-hint") {
        setQuery(item.name + " ");
        inputRef.current?.focus();
      } else if (item.kind === "websearch") {
        invoke("open_url", { url: item.url })
          .then(() => hideWindow())
          .catch(console.error);
      } else if (item.kind === "app") {
        invoke("launch_app", { id: item.id })
          .then(() => hideWindow())
          .catch(console.error);
      } else if (item.kind === "command") {
        setQuery(item.name + " ");
        inputRef.current?.focus();
      } else if (item.kind === "process") {
        invoke("close_process", { name: item.meta ?? item.detail })
          .then(() => hideWindow())
          .catch(console.error);
      }
    },
    [hideWindow],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          hideWindow();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
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

    const handleFocus = () => inputRef.current?.focus();

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("focus", handleFocus);
    };
  }, [results, selectedIndex, hideWindow, handleAction]);

  const hasResults = results.length > 0;

  return (
    <div className="flex w-screen flex-col">
      <div
        className="flex shrink-0 items-center gap-3 px-5"
        style={{
          height: BAR_HEIGHT,
          background: "rgba(24, 24, 32, 0.92)",
          borderRadius: hasResults ? "16px 16px 0 0" : "16px",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: hasResults ? "none" : "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        <svg
          className="h-5 w-5 shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search..."
          className="flex-1 bg-transparent text-xl text-white outline-none placeholder:text-gray-500"
          autoFocus
        />
      </div>

      {hasResults && (
        <div
          style={{
            background: "rgba(24, 24, 32, 0.92)",
            borderRadius: "0 0 16px 16px",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div className="mx-3 h-px bg-white/10" />
          {results.map((result, index) => {
            const isSelected = index === selectedIndex;
            const isEval = result.kind === "calc" || result.kind === "convert";
            const isWebSearch = result.kind === "websearch";

            if (isEval) {
              return (
                <div
                  key={`${result.kind}-${result.id}`}
                  className="flex cursor-pointer items-center justify-between px-4 transition-colors duration-75"
                  style={{
                    height: EVAL_ROW_HEIGHT,
                    background: isSelected
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(99, 102, 241, 0.06)",
                    borderLeft: isSelected
                      ? "2px solid #6366f1"
                      : "2px solid transparent",
                    borderRadius:
                      index === results.length - 1
                        ? "0 0 16px 16px"
                        : undefined,
                  }}
                  onClick={() => handleAction(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0">
                      {result.kind === "calc" ? "🔢" : "📐"}
                    </span>
                    <div className="min-w-0 overflow-hidden">
                      <div className="truncate text-sm text-gray-300">
                        {result.name}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xl font-bold text-white">
                      {result.kind === "calc" ? result.detail.replace("= ", "") : result.copyValue}
                    </span>
                    {isSelected && (
                      <span className="text-xs text-gray-500">
                        &#x23CE; Copy
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            if (isWebSearch) {
              return (
                <div
                  key={`${result.kind}-${result.id}`}
                  className="flex cursor-pointer items-center justify-between px-4 transition-colors duration-75"
                  style={{
                    height: ROW_HEIGHT,
                    background: isSelected
                      ? "rgba(255,255,255,0.08)"
                      : "transparent",
                    borderLeft: isSelected
                      ? "2px solid #6366f1"
                      : "2px solid transparent",
                    borderRadius:
                      index === results.length - 1
                        ? "0 0 16px 16px"
                        : undefined,
                  }}
                  onClick={() => handleAction(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="min-w-0 overflow-hidden">
                    <div className="truncate text-sm font-medium text-white">
                      <span className="mr-2">{result.icon}</span>
                      {result.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {result.detail}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="ml-3 shrink-0 text-xs text-gray-500">
                      &#x23CE; Open
                    </span>
                  )}
                </div>
              );
            }

            if (result.kind === "prefix-hint") {
              return (
                <div
                  key={`${result.kind}-${result.id}`}
                  className="flex cursor-pointer items-center justify-between px-4 transition-colors duration-75"
                  style={{
                    height: 40,
                    background: isSelected
                      ? "rgba(255,255,255,0.06)"
                      : "transparent",
                    borderLeft: isSelected
                      ? "2px solid #6366f1"
                      : "2px solid transparent",
                    borderRadius:
                      index === results.length - 1
                        ? "0 0 16px 16px"
                        : undefined,
                  }}
                  onClick={() => handleAction(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{result.icon}</span>
                    <span className="text-xs text-gray-500">
                      Type{" "}
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-gray-300">
                        {result.name}
                      </span>{" "}
                      to search {result.detail}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`${result.kind}-${result.id}`}
                className="flex cursor-pointer items-center justify-between px-4 transition-colors duration-75"
                style={{
                  height: ROW_HEIGHT,
                  background: isSelected
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                  borderLeft: isSelected
                    ? "2px solid #6366f1"
                    : "2px solid transparent",
                  borderRadius:
                    index === results.length - 1
                      ? "0 0 16px 16px"
                      : undefined,
                }}
                onClick={() => handleAction(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="min-w-0 overflow-hidden">
                  <div className="truncate text-sm font-medium text-white">
                    {result.kind === "process" && (
                      <span className="mr-2 text-red-400">&#x2715;</span>
                    )}
                    {result.kind === "command" && (
                      <span className="mr-2 text-blue-400">/</span>
                    )}
                    {result.name}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {result.detail}
                  </div>
                </div>
                {isSelected && (
                  <span className="ml-3 shrink-0 text-xs text-gray-500">
                    &#x23CE;
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
