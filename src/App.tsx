import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

type ResultKind = "app" | "command" | "process";

interface DisplayResult {
  id: number;
  name: string;
  detail: string;
  kind: ResultKind;
  meta?: string;
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

const COMMANDS = [{ name: "close", description: "Close a running application" }];

const BAR_HEIGHT = 72;
const ROW_HEIGHT = 52;
const MAX_RESULTS = 8;

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resizeWindow = useCallback(async (count: number) => {
    const height = BAR_HEIGHT + Math.min(count, MAX_RESULTS) * ROW_HEIGHT;
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
          const res = await invoke<AppSearchResult[]>("search_apps", {
            query,
          });
          items = res.map((r) => ({
            id: r.id,
            name: r.name,
            detail: r.path,
            kind: "app",
          }));
        }

        setResults(items);
        setSelectedIndex(0);
        resizeWindow(items.length);
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
      if (item.kind === "app") {
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
    [],
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
