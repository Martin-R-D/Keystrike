interface CommandEntry {
  command: string;
  description: string;
  example: string;
}

const COMMANDS: CommandEntry[] = [
  { command: "/close", description: "Force-closes a running application", example: "/close chrome" },
  { command: "g", description: "Search Google in your browser", example: "g how to learn rust" },
  { command: "yt", description: "Search YouTube in your browser", example: "yt lofi hip hop" },
  { command: "wiki", description: "Search Wikipedia in your browser", example: "wiki theory of relativity" },
  { command: "r", description: "Search Reddit in your browser", example: "r best mechanical keyboards" },
  { command: "gh", description: "Search GitHub in your browser", example: "gh tauri examples" },
  { command: "so", description: "Search Stack Overflow in your browser", example: "so rust borrow checker" },
  { command: "ddg", description: "Search DuckDuckGo in your browser", example: "ddg privacy tools" },
  { command: "Math", description: "Calculate math expressions instantly", example: "15 * 23 + 7" },
  { command: "Units", description: "Convert between units", example: "150 lbs to kg" },
];

function Settings() {
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
          Built-in commands available in the search bar
        </p>

        <div className="mt-6 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          {/* Header row */}
          <div
            className="grid items-center gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            style={{ gridTemplateColumns: "120px 1fr 1fr", background: "rgba(255,255,255,0.03)" }}
          >
            <div>Command</div>
            <div>Description</div>
            <div>Example</div>
          </div>

          {COMMANDS.map((cmd, i) => (
            <div
              key={cmd.command}
              className="settings-row grid items-center gap-4 px-4 py-3 text-sm"
              style={{
                gridTemplateColumns: "120px 1fr 1fr",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="font-mono font-medium text-indigo-400">{cmd.command}</div>
              <div className="text-gray-200">{cmd.description}</div>
              <div className="truncate font-mono text-xs text-gray-500">{cmd.example}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default Settings;
