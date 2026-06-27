<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Keystrike" width="80" />
</p>

<h1 align="center">Keystrike</h1>

<p align="center">
  A fast, keyboard-driven app launcher for Windows.<br/>
  Search apps, do math, convert units, browse the web, and run your own commands — all from one search bar.
</p>

<p align="center">
  Built with Tauri 2 + React + Rust
</p>

---

## How It Works

Press **Alt+Space** from anywhere to open Keystrike. Start typing to search, press **Enter** to act on the selected result, and **Escape** to dismiss. Click the **gear icon** in the search bar to open Settings.

Keystrike sits quietly in your system tray and uses virtually no resources when idle. It indexes your installed applications on startup and ranks them by how often you use them — your most-launched apps always appear first.

---

## Features

### App Launcher

Just start typing an app name. Keystrike fuzzy-matches against all installed applications found in your Start Menu and Desktop shortcuts, ranked by match quality and usage frequency. Navigate with **Arrow Up/Down** or **Tab/Shift+Tab**, and press **Enter** to launch. When the search bar is empty, your most frequently used apps are shown.

### Calculator

Type any math expression for an instant result.

| Input | Output |
|---|---|
| `15% of 200` | 30 |
| `sqrt(144)` | 12 |
| `2^10` | 1024 |

**Operators:** `+`, `-`, `*` (or `x`, `×`), `/` (or `÷`), `^`, `%` (modulo) — plus natural language like `plus`, `times`, `divided by`, and `mod`.
**Functions:** `sqrt`, `sin`, `cos`, `tan`, `log`, `ln`, `abs`, `exp`, `ceil`, `floor`.

Type `X% of Y` for percentages. Press **Enter** to copy the result.

### Unit Converter

Type a conversion as `{value} {unit} to {unit}` (you can use `to` or `in`).

| Input | Output |
|---|---|
| `100 kg to lbs` | 220.46 lbs |
| `72 F to C` | 22.22°C |
| `10 km to miles` | 6.21 miles |
| `1024 MB to GB` | 1 GB |
| `2.5 hours to minutes` | 150 minutes |

Supports **weight, temperature, distance, data, and time**. Press **Enter** to copy the result.

### Web Search Prefixes

Type a prefix followed by a space and your query to search the web directly.

| Prefix | Provider | Example |
|---|---|---|
| `g` | Google | `g how to center a div` |
| `yt` | YouTube | `yt lofi hip hop` |
| `r` | Reddit | `r best mechanical keyboards` |
| `gh` | GitHub | `gh tauri examples` |
| `so` | Stack Overflow | `so rust lifetime error` |
| `wiki` | Wikipedia | `wiki Turing machine` |
| `ddg` | DuckDuckGo | `ddg privacy browser` |

Press **Enter** to open the search in your default browser. Every prefix is customizable in Settings, and partial prefixes show hints. If your query matches nothing else, a "Search Google" fallback always appears at the bottom.

### Custom Commands

Create your own commands from the Settings dashboard — two types:

**URL commands** open or search any website.
- *Direct:* keyword `gt` → `https://github.com` opens GitHub when you type `gt`.
- *Search:* include `{query}` in the URL (e.g. `https://github.com/search?q={query}`) and whatever you type after the keyword fills it in — `gt tauri` searches GitHub. An optional fallback URL opens when no query is given.

**Text snippets** paste frequently used text. A snippet like `;email` → `you@example.com` copies the text to your clipboard on **Enter**, then automatically clears it after **1 minute** — unless you've copied something else in the meantime, in which case it's left untouched.

### Process Manager

Use the `/close` command to find and terminate running applications. Type `/close chrome`, select the process from the fuzzy-matched list, and press **Enter** to terminate it. System processes are filtered out automatically.

### Settings Dashboard

Click the **gear icon** in the search bar to open Settings, where you can:

- **Edit any built-in keyword** — rename `g`, `gh`, `/close`, and others to whatever you prefer.
- **Add, edit, and delete custom commands** — manage your URL commands and text snippets.

Changes apply instantly — no restart required.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Alt+Space** | Toggle Keystrike (global, works from any app) |
| **Enter** | Launch app / open URL / copy result / run command |
| **Escape** | Hide Keystrike |
| **Arrow Up/Down** | Navigate results |
| **Tab** / **Shift+Tab** | Next / previous result |

---

## System Tray

Keystrike runs in the system tray. Left-click to toggle the search bar, or right-click for options:

- **Show Keystrike** — Bring up the search bar (same as Alt+Space)
- **Reindex Apps** — Rescan your system for newly installed applications
- **Start with Windows** — Toggle autostart on/off (enabled by default)
- **Quit Keystrike** — Exit the application

---

## Data Storage

Keystrike stores its data in `%USERPROFILE%\.keystrike\`:

| File | Purpose |
|---|---|
| `app_usage.json` | Tracks how often you launch each app (for ranking) |
| `window_position.json` | Remembers where you last positioned the window |
| `commands.json` | Stores your customized keywords and custom commands |
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

The installer will be generated at `src-tauri/target/release/bundle/nsis/Keystrike_0.2.0_x64-setup.exe`.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Backend:** Rust, Tauri 2
- **Search:** Fuzzy matching via [skim](https://github.com/lotabout/fuzzy-matcher)
- **Math:** Expression evaluation via [meval](https://github.com/rekka/meval-rs)
- **Clipboard:** Snippet handling via [arboard](https://github.com/1Password/arboard)
- **Packaging:** NSIS installer via Tauri bundler

---

## License

MIT
