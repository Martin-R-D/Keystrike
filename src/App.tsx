import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

interface SearchResult {
  id: number;
  name: string;
  path: string;
  score: number;
}

const BAR_HEIGHT = 72;
const ROW_HEIGHT = 52;
const MAX_RESULTS = 8;

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
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
        const res = await invoke<SearchResult[]>("search_apps", { query });
        setResults(res);
        setSelectedIndex(0);
        resizeWindow(res.length);
      } catch (e) {
        console.error("Search failed:", e);
      }
    }, 50);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, resizeWindow]);

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
            if (selected) {
              invoke("launch_app", { id: selected.id })
                .then(() => hideWindow())
                .catch(console.error);
            }
          }
          break;
      }
    };

    const handleBlur = () => hideWindow();
    const handleFocus = () => inputRef.current?.focus();

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [results, selectedIndex, hideWindow]);

  const hasResults = results.length > 0;

  return (
    <div className="flex w-screen flex-col">
      {/* Search bar */}
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

      {/* Results */}
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
                key={result.id}
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
                onClick={() => {
                  invoke("launch_app", { id: result.id })
                    .then(() => hideWindow())
                    .catch(console.error);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="min-w-0 overflow-hidden">
                  <div className="truncate text-sm font-medium text-white">
                    {result.name}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {result.path}
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
