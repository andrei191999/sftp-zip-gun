# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
# Compile (bundle with esbuild, outputs to dist/extension.js)
npm run compile

# Watch mode (recompiles on save)
npm run watch

# Type-check only (no emit)
npm run typecheck

# Package as .vsix for distribution
npm run package
```

No test runner is configured — changes should be verified by launching the extension in the VS Code Extension Development Host (`F5` in VS Code with this folder open).

## Architecture

This is a VS Code extension with a webview panel UI. There are two execution contexts that communicate via a typed message-passing protocol:

### Host side (`src/`)
Runs in Node.js with full VS Code API access.

- **`extension.ts`** — entry point; registers commands (`sftpZipGun.openPanel`, `sftpZipGun.quickUpload`, `sftpZipGun.importFileZilla`), status bar, and wires together the managers.
- **`logger.ts`** — VS Code OutputChannel logger ("SFTP Zip Gun" panel). Initialized in `activate()` via `initLogger(context)`. Use `log('info'|'warn'|'error', msg)` anywhere in host-side code for developer-visible output.
- **`config/presetManager.ts`** — reads/writes SFTP presets to VS Code global settings (`sftpZipGun.presets`). **Passwords and SSH passphrases are stored exclusively in `context.secrets` (OS keychain), never in settings.** `PresetMeta` is the sanitized struct safe to expose to the webview. Key methods: `getByName(name)`, `resolveConnectOptions(preset)` — **all connect paths must use `resolveConnectOptions`**, which handles password/key/passphrase resolution and key file reading with proper error handling.
- **`config/stateManager.ts`** — persists UI state (`PanelState`) and upload history (capped at 50 entries) via `context.globalState`.
- **`config/fileZillaImporter.ts`** — parses FileZilla XML site-manager exports.
- **`sftp/sftpClient.ts`** — thin wrapper around `ssh2-sftp-client`; supports password and private-key auth, progress callbacks, and abort-by-closing-connection.
- **`sftp/zipBuilder.ts`** — builds a ZIP archive from a list of local files using `archiver`.
- **`webview/SftpPanel.ts`** — singleton panel host; creates/reveals the `WebviewPanel`, serves the HTML template from `media/`, and handles all `WebviewToHost` messages.

### Webview side (`media/`)
Runs in a sandboxed browser context inside VS Code. No Node.js or VS Code API access — all communication goes through `vscode.postMessage` / `onMessage`.

- **`media/panel.html`** — HTML shell with `{{nonce}}`, `{{cspSource}}`, `{{cssUri}}`, `{{scriptUri}}` template slots filled by `SftpPanel._getHtml()`.
- **`media/panel.js`** — webview-side logic (vanilla JS).
- **`media/panel.css`** — styles.

### Message contract (`src/types/messages.ts`)
All host↔webview communication uses typed discriminated unions:
- `WebviewToHost` — messages sent from panel JS to the extension host.
- `HostToWebview` — messages sent from host to panel JS.
- `assertNever()` enforces exhaustive switch handling at compile time.
- `generateId()` — shared utility for history entry IDs (`Date.now()-random`).

**Init sequence:** the webview posts only `{ kind: 'ready' }` on startup. The host `ready` handler responds with presets, state, and history in one shot — do not add separate `getState`/`getPresets`/`getHistory` on init.

**Security invariant:** secrets (`password`, `passphrase`) travel only in `WebviewToHost` `savePreset` messages and are immediately written to `SecretStorage`. They are never included in any `HostToWebview` message.

## Key Constraints

- `ssh2-sftp-client` is marked `--external` in the esbuild compile script — it must remain a runtime dependency (not bundled), because it contains native bindings (`keytar.node`).
- The `readOnly` preset flag disables `stat`/`exists`/`delete`/`mkdir` operations for drop-box/intake servers that reject management commands. The UAT SFTP (`sftp-1-2.nxt.uat.unifiedpost.com:22`) is such a server.
- The webview CSP uses a nonce generated fresh on each panel creation (`crypto.randomBytes(16)`).
- Upload history is capped at 50 entries in `StateManager`; webview log buffer capped at 500 lines.
- `persistState()` in `panel.js` posts a `setState` message (triggers `globalState.update()`). Call it only on user interactions — **not** inside the message handler for upload progress, and **not** from `render()` directly.

## Remaining Work (as of session 2)

Tasks from `openspec/changes/sftp-upload-vscode-extension/tasks.md`:
- **Task 11** — Smoke test in Extension Development Host (F5)
- **Task 12** — Unit tests (jest + ts-jest): `fileZillaImporter`, `stateManager`, `zipBuilder`
- **Task 13** — Final comprehensive review (CSP, SecretStorage, disposables checklist)
- **Task 14** — Packaging: `README.md`, `CHANGELOG.md`, `LICENSE`, `icon.png` (128×128), `npx vsce package`
