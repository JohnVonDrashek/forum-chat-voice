# Forumline Desktop App

Thin [Tauri v2](https://tauri.app/) shell that wraps the Forumline hub web app (`app.forumline.net`) in a native window with system tray, notifications, autostart, and deep link support.

## Prerequisites

- **Rust** — Install via [rustup](https://rustup.rs/)
- **Tauri CLI** — `cargo install tauri-cli --version "^2"`
- **Node.js 20+** and npm
- **Platform dependencies** — See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

1. Start the forumline dev server (the Tauri app loads it as `devUrl`):

   ```bash
   cd central-services
   npm install
   npm run dev
   ```

2. In a separate terminal, start the Tauri app:

   ```bash
   cd desktop
   cargo tauri dev
   ```

   This compiles the Rust backend, opens the native window pointing at `http://localhost:5173`, and enables hot reload for the web frontend.

## Architecture

```
desktop/
├── Cargo.toml              # Rust dependencies (Tauri plugins)
├── tauri.conf.json          # Tauri config (window, bundle, plugins)
├── capabilities/
│   └── default.json         # IPC permissions (notifications, shell, deep-link)
├── src/
│   ├── main.rs              # Entry point
│   └── lib.rs               # App setup: tray, close-to-tray, plugin init
└── icons/                   # App icons for each platform
```

**Key points:**

- **No bundled frontend** — `frontendDist` points to `https://app.forumline.net`. The desktop app loads the production hub directly.
- **System tray** — Close minimizes to tray instead of quitting. Tray menu has Show/Quit.
- **Plugins** — `notification`, `autostart`, `shell`, `deep-link` are all Tauri v2 plugins configured in `Cargo.toml` and `capabilities/default.json`.
- **Deep links** — Registers `forumline://` protocol. URLs like `forumline://forum/{domain}/t/{threadId}` open the app and navigate to the target forum/thread.

## Building for Distribution

```bash
cd desktop
cargo tauri build
```

Output binaries are in `desktop/target/release/bundle/` (`.dmg` on macOS, `.msi` on Windows, `.deb`/`.AppImage` on Linux).

## Deep Link URL Scheme

| URL | Action |
|-----|--------|
| `forumline://forum/{domain}/t/{threadId}` | Open thread in forum |
| `forumline://forum/{domain}/chat/{channel}` | Open chat channel |
| `forumline://forum/{domain}/{path}` | Open arbitrary forum path |
