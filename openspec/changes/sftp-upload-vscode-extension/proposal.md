## Why

The team manually uploads XML invoices and attachment bundles to an intake SFTP server via a standalone Python GUI. There is no VS Code-native path: users must leave their editor, context-switch to the GUI, pick files again, and return. A VS Code extension eliminates that round-trip and makes the most common action (right-click XML → upload) a one-click operation.

## What Changes

- New VS Code extension at `vs-code-extensions/sftp-upload/` published to the VS Code Marketplace
- Introduces a TypeScript message-contract file (`src/types/messages.ts`) shared by all modules — the single source of truth for webview↔host communication
- Adds SFTP preset management backed by VS Code SecretStorage (credentials never in settings.json)
- Adds a Webview panel (upload UI, manage presets, remote folder browser, upload history) opened via right-click, editor title bar button, or `Ctrl+Shift+U`
- Adds ZIP bundle mode: selected files are zipped locally then uploaded as one file
- Adds separate-files mode: selected files uploaded individually in sequence
- Adds quick upload command: uploads the active XML directly to the last-used preset, no panel
- Adds FileZilla site manager XML import to auto-populate presets
- Adds an animated status bar item showing the active preset and upload state
- Adds upload history: last 50 entries persisted across VS Code restarts

## Capabilities

### New Capabilities

- `message-contract`: TypeScript discriminated-union types for every webview↔host message (`WebviewMessage`, `HostMessage`) and all shared data shapes (`PresetMeta`, `PresetWithCredentials`, `FileEntry`, `RemoteEntry`, `HistoryEntry`, `UiState`). Lives at `src/types/messages.ts`. All other modules import from here — never inline message shapes.
- `preset-management`: CRUD on named SFTP presets. Non-sensitive fields (name, host, port, username, remoteDir, authType, keyPath) stored in VS Code settings; passwords and SSH key passphrases stored in `context.secrets` (SecretStorage). Includes FileZilla XML import (`fast-xml-parser`) and test-connection validation.
- `sftp-transport`: SFTP client wrapper around `ssh2-sftp-client` (connect, upload single file, stream progress, disconnect, cancellation flag) and ZIP archive builder using `archiver` (`{xml_stem}_{YYYYMMDDTHHmmss}.zip` saved alongside the anchor XML).
- `webview-ui`: All client-side webview code (`media/panel.html`, `media/panel.js`, `media/panel.css`). Covers three views rendered in the same panel: (1) main upload view — preset dropdown, remote dir row with pin/browse, local folder picker, file list with checkboxes and filter, mode toggle, output row, progress log; (2) manage presets view — add/edit/delete/test per preset, FileZilla import button; (3) remote browser overlay — breadcrumb path + directory listing, Pin this folder button. All CSS uses VS Code theme variables only.
- `panel-host`: `src/webview/SftpPanel.ts` — creates and owns the `vscode.WebviewPanel` (single-instance, `ViewColumn.Beside`, `retainContextWhenHidden`), injects CSP nonce and asset URIs, and routes every `WebviewMessage` to the appropriate module (presetManager, sftpClient, zipBuilder, stateManager), then posts `HostMessage` responses back.
- `extension-integration`: `src/extension.ts` — registers commands (`sftpUpload.openPanel`, `sftpUpload.quickUpload`, `sftpUpload.importFileZilla`), sets `sftpUpload.hasPresets` context variable, wires the animated status bar item (idle/uploading/success/error states with spinner), registers the `Ctrl+Shift+U` keybinding, and attaches an `onDidChangeConfiguration` listener to refresh the panel when presets are edited directly in `settings.json`.

### Modified Capabilities

*(none — this is a new extension with no existing specs)*

## Impact

- **New directory**: `vs-code-extensions/sftp-upload/` (extension root)
- **New NPM dependencies**: `ssh2-sftp-client`, `archiver`, `fast-xml-parser` (runtime); `@types/vscode`, `typescript`, `@vscode/vsce`, `esbuild` (dev)
- **VS Code minimum version**: `^1.74.0` (stable SecretStorage API)
- **No changes** to any existing script, tool, or shared config in this repo
- **Credentials**: passwords and passphrases live exclusively in OS-keychain-backed SecretStorage — they do not roam with Settings Sync and never appear in settings.json or cross the webview boundary
- **Parallel build plan**: `message-contract` is authored first (by the orchestrating session); `preset-management`, `sftp-transport`, and `webview-ui` are built in parallel by independent subagents; `panel-host` and `extension-integration` are assembled by the orchestrator once all three converge
- **Review checkpoints**: interface-alignment review after parallel phase, integration review after panel-host wiring, final comprehensive review (CSP, theme vars, SecretStorage, activation events, disposables, `vsce package`) before publish
