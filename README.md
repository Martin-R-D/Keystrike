<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Keystrike" width="80" />
</p>

<h1 align="center">Keystrike</h1>

<p align="center">
  A fast, keyboard-driven app launcher for Windows.<br/>
  Search apps, do math, convert units, and browse the web — all from one search bar.
</p>

<p align="center">
  Built with Tauri 2 + React + Rust
</p>

---

## How It Works

Press **Alt+Space** from anywhere to open Keystrike. Start typing to search. Press **Enter** to act on the selected result. Press **Escape** to dismiss.

Keystrike sits quietly in your system tray and uses virtually no resources when idle. It indexes your installed applications on startup and ranks them by how often you use them — your most-launched apps always appear first.

---

## Features

### App Launcher

Just start typing an app name. Keystrike fuzzy-matches against all installed applications found in your Start Menu and Desktop shortcuts.

- Results are ranked by a combination of match quality and usage frequency
- Press **Enter** to launch the selected app
- Navigate results with **Arrow Up/Down** or **Tab/Shift+Tab**

When the search bar is empty, your most frequently used apps are shown.

### Calculator

Type any math expression directly into the search bar to get an instant result.

| Input | Output |
|---|---|
| `2 + 2` | 4 |
| `sqrt(144)` | 12 |
| `sin(3.14)` | ~0.00159 |
| `2^10` | 1024 |
| `15% of 200` | 30 |
| `100 / 3` | 33.3333... |

**Supported operators:** `+`, `-`, `*` (or `x`, `×`), `/` (or `÷`), `^`, `%` (modulo)

**Natural language:** You can also type `plus`, `minus`, `times`, `divided by`, `to the power of`, and `mod`.

**Functions:** `sqrt`, `sin`, `cos`, `tan`, `log`, `ln`, `abs`, `exp`, `ceil`, `floor`

**Percentage:** Type `X% of Y` to calculate percentages (e.g. `20% of 150`).

Press **Enter** to copy the result to your clipboard.

### Unit Converter

Type a conversion in the format `{value} {unit} to {unit}`.

**Weight:**

| Input | Output |
|---|---|
| `100 kg to lbs` | 220.46 lbs |
| `150 lbs to kg` | 68.04 kg |
| `500 g to oz` | 17.64 oz |
| `8 oz to g` | 226.8 g |

**Temperature:**

| Input | Output |
|---|---|
| `72 F to C` | 22.22°C |
| `100 C to F` | 212°F |

**Distance:**

| Input | Output |
|---|---|
| `10 km to miles` | 6.21 miles |
| `5 miles to km` | 8.05 km |
| `180 cm to inches` | 70.87 inches |
| `6 ft to m` | 1.83 m |

**Data:**

| Input | Output |
|---|---|
| `1024 MB to GB` | 1 GB |
| `2 GB to MB` | 2048 MB |
| `500 GB to TB` | 0.49 TB |

**Time:**

| Input | Output |
|---|---|
| `2.5 hours to minutes` | 150 minutes |
| `3 days to hours` | 72 hours |

You can use `to` or `in` as the separator (e.g. `100 kg in lbs`).

Press **Enter** to copy the result to your clipboard.

### Web Search Prefixes

Type a prefix followed by a space and your search query to search the web directly from Keystrike.

| Prefix | Provider | Example |
|---|---|---|
| `g` | Google | `g how to center a div` |
| `yt` | YouTube | `yt lofi hip hop` |
| `r` | Reddit | `r best mechanical keyboards` |
| `gh` | GitHub | `gh tauri examples` |
| `so` | Stack Overflow | `so rust lifetime error` |
| `wiki` | Wikipedia | `wiki Turing machine` |
| `ddg` | DuckDuckGo | `ddg privacy browser` |

Press **Enter** to open the search in your default browser.

If you start typing a prefix but haven't completed it yet, Keystrike will show hints suggesting available search providers.

**Google fallback:** If your query doesn't match any app, prefix, or special command, a "Search Google" option appears at the bottom of the results so you can always fall back to a web search.

### Process Manager

Use the `/close` command to find and terminate running applications.

1. Type `/close` — the command will appear in the results
2. Press **Enter** or add a space to activate it
3. Type the name of the process you want to close (e.g. `/close chrome`)
4. Select the process from the list and press **Enter** to terminate it

The process list is fuzzy-matched and filters out system processes automatically.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Alt+Space** | Toggle Keystrike (global, works from any app) |
| **Enter** | Launch app / open URL / copy result / run command |
| **Escape** | Hide Keystrike |
| **Arrow Up/Down** | Navigate results |
| **Tab** | Next result |
| **Shift+Tab** | Previous result |

---

## System Tray

Keystrike runs in the system tray. Right-click the tray icon for options:

- **Show Keystrike** — Bring up the search bar (same as Alt+Space)
- **Reindex Apps** — Rescan your system for newly installed applications
- **Start with Windows** — Toggle autostart on/off (enabled by default)
- **Quit Keystrike** — Exit the application

Left-click the tray icon to toggle the search bar.

---

## Data Storage

Keystrike stores its data in `%USERPROFILE%\.keystrike\`:

| File | Purpose |
|---|---|
| `app_usage.json` | Tracks how often you launch each app (for ranking) |
| `window_position.json` | Remembers where you last positioned the window |
| `config.json` | Stores first-launch flag and configuration |

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI](https://tauri.app/start/) (`npm install -g @tauri-apps/cli`)

### Development

```bash
npm install
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

The installer will be generated at `src-tauri/target/release/bundle/nsis/Keystrike_X.X.X_x64-setup.exe`.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Backend:** Rust, Tauri 2
- **Search:** Fuzzy matching via [skim](https://github.com/lotabout/fuzzy-matcher)
- **Math:** Expression evaluation via [meval](https://github.com/rekka/meval-rs)
- **Packaging:** NSIS installer via Tauri bundler

---

## License

MIT
