## 0. Pre-Implementation Validation Spikes

Run these before writing any extension code. Each is a throwaway script in `vs-code-extensions/sftp-upload/spikes/` — delete the folder after all spikes pass. A spike failing means an assumption is wrong; fix the assumption in the spec before proceeding.

- [ ] 0.1 **SFTP library connectivity spike** — write `spikes/sftp-spike.js` (plain Node.js, no VS Code): `require('ssh2-sftp-client')`, connect to the DEV SFTP server using a real password, call `.list('/')`, upload a small test file (`spikes/test.txt`), call `.delete()` to clean it up, disconnect. Expected: no errors, file appears and disappears. If this fails, diagnose before proceeding — cipher suite mismatches, server key type issues, or library version problems must be resolved now, not during integration.
- [ ] 0.2 **FileZilla XML parsing spike** — write `spikes/filezilla-spike.js`: open an actual FileZilla site manager XML export from the team, run it through `fast-xml-parser`, and `console.log(JSON.stringify(parsed, null, 2))`. Confirm the field paths match what `fileZillaImporter.ts` will use (`Server.Host`, `Server.Port`, `Server.User`, `Server.Pass`, `Server.Protocol`). If the structure differs from assumed, update `fileZillaImporter.ts` spec and task 3.7 before building.
- [ ] 0.3 **ZIP creation spike** — write `spikes/zip-spike.js`: use `archiver` to create a ZIP from 2–3 test files using the streaming pattern planned for `zipBuilder.ts` (output stream to a file, `archive.file()` per entry, `archive.finalize()`). Confirm the ZIP is created, openable, and contains entries with basenames only (no directory prefix). Confirm the timestamp pattern `YYYYMMDDTHHmmss` in the filename.
- [ ] 0.4 **Webview message round-trip spike** — create `spikes/roundtrip-extension/` as a minimal VS Code extension (its own `package.json` + `extension.ts` + `panel.html` + `panel.js`): the extension opens a webview, the host posts `{ command: 'ping', value: 42 }`, `panel.js` receives it and posts back `{ command: 'pong', value: 43 }`, the host logs the pong. Press F5 and verify the round-trip in the debug console. This validates `acquireVsCodeApi()`, `postMessage`, `onDidReceiveMessage`, and nonce CSP injection before building the full panel.
- [ ] 0.5 **messages.ts strict compile spike** — write `src/types/messages.ts` with all types from the message-contract spec (just the types, no implementation), then run `npx tsc --noEmit --strict`. Confirm zero errors. Specifically verify the discriminated union exhaustiveness works: write a dummy `switch (msg.command)` in a scratch file that covers all `WebviewMessage` variants and confirm TypeScript reports the `default` branch as unreachable.
- [ ] 0.6 **esbuild bundle spike** — create a stub `src/extension.ts` (`export function activate() {}`), run the compile script from task 1.7, and confirm `dist/extension.js` is produced with no errors. Then verify `vscode` is correctly externalized: run `node -e "require('./dist/extension.js')"` and confirm it fails with "Cannot find module 'vscode'" (not any other error) — this confirms esbuild excluded vscode correctly.

## 1. Project Scaffold

- [ ] 1.1 Create extension root directory at `vs-code-extensions/sftp-upload/` with subdirectories: `src/types/`, `src/webview/`, `src/sftp/`, `src/config/`, `media/`, `spikes/`
- [ ] 1.2 Write `package.json` with name `sftp-upload`, version `0.1.0`, publisher placeholder, `engines: { vscode: "^1.74.0" }`, `main: "./dist/extension.js"`, and empty `contributes` object (commands/menus/settings filled in task 9)
- [ ] 1.3 Write `tsconfig.json` targeting `ES2020`, `module: commonjs`, `outDir: ./dist`, `strict: true`, `lib: ["ES2020"]` — note: `outDir` is `dist` to match the esbuild output; `tsc` is used for type checking only (`--noEmit`), not to produce the actual bundle
- [ ] 1.4 Write `.vscodeignore` excluding `src/`, `node_modules/`, `*.ts`, `tsconfig.json`, `openspec/`, `docs/`, `spikes/`
- [ ] 1.5 Install runtime dependencies: `npm install ssh2-sftp-client archiver fast-xml-parser`
- [ ] 1.6 Install dev dependencies: `npm install -D @types/vscode @types/node typescript @vscode/vsce esbuild @types/archiver`
- [ ] 1.7 Add `scripts` to `package.json`: `"compile": "esbuild src/extension.ts --bundle --platform=node --external:vscode --outfile=dist/extension.js --sourcemap"`, `"watch": "npm run compile -- --watch"`, `"package": "vsce package"`, `"typecheck": "tsc --noEmit"`
- [ ] 1.8 Run spikes 0.1–0.6 from the `spikes/` directory to validate all assumptions before writing any extension code — do not proceed to task 2 until all six pass

## 2. Message Contract

- [ ] 2.1 Write `src/types/messages.ts` with all shared types: `UploadMode`, `PresetMeta`, `PresetWithCredentials`, `FileEntry`, `RemoteEntry`, `HistoryEntry`, `UiState`
- [ ] 2.2 Add `WebviewMessage` discriminated union to `src/types/messages.ts` covering all 14 commands: `listFiles`, `upload`, `cancelUpload`, `testConnection`, `getPresets`, `savePreset`, `deletePreset`, `importFileZilla`, `getHistory`, `getState`, `setState`, `browseRemote`, `pinFolder`, `closeBrowser`
- [ ] 2.3 Add `HostMessage` discriminated union to `src/types/messages.ts` covering all 9 commands: `filesListed`, `progress`, `uploadDone`, `testResult`, `presets`, `history`, `state`, `remoteListed`, `importDone` — verify no member has `password` or `passphrase` field
- [ ] 2.4 Run `npm run typecheck` — expect zero errors on `src/types/messages.ts` before proceeding to parallel phase
- [ ] 2.5 Define module initialization pattern — add to the top of `src/config/presetManager.ts` and `src/config/stateManager.ts` stubs: each exports `init(context: vscode.ExtensionContext): void` that stores the context reference in a module-level variable; all other exported functions use this stored reference. Agents building these modules MUST follow this pattern exactly — no context passed per-method-call, no constructor. Verify: calling any method before `init()` throws a clear error ("presetManager not initialized")

## 3. Config Layer (parallel-eligible with tasks 4 and 5 — start after task 2.5)

- [ ] 3.1 Write `src/config/presetManager.ts`: implement `init(context)`, then `getAll(): PresetMeta[]` reading from `vscode.workspace.getConfiguration('sftpUpload').presets`
- [ ] 3.2 Implement `save(preset: PresetWithCredentials, isNew: boolean)` in `presetManager.ts`: write non-sensitive fields to settings, write password to `context.secrets` keyed as `sftpUpload.preset.<name>.password`, write passphrase as `sftpUpload.preset.<name>.passphrase`
- [ ] 3.3 Implement `delete(name: string)` in `presetManager.ts`: remove from settings array AND delete both SecretStorage keys for the preset
- [ ] 3.4 Implement `getPassword(name: string): Promise<string | undefined>` and `getPassphrase(name: string): Promise<string | undefined>` reading from `context.secrets`
- [ ] 3.5 Implement `pinFolder(name: string, path: string)` in `presetManager.ts`: update only the `remoteDir` field of the named preset in settings without altering any other field
- [ ] 3.6 Write `src/config/fileZillaImporter.ts`: implement `parse(xmlString: string): PresetWithCredentials[]` using `fast-xml-parser`; filter to `<Protocol>1</Protocol>` entries only; base64-decode `<Pass encoding="base64">` values — use field paths confirmed in spike 0.2
- [ ] 3.7 Write `src/config/stateManager.ts`: implement `init(context)`, then `getState(): UiState`, `setState(partial: Partial<UiState>)`, `getHistory(): HistoryEntry[]`, `appendHistory(entry: HistoryEntry)` (cap at 50 entries, newest first) — all backed by `context.globalState`

## 4. SFTP Transport (parallel-eligible with tasks 3 and 5 — start after task 2.5)

- [ ] 4.1 Write `src/sftp/sftpClient.ts`: define class `SftpClient` with `connect(preset: PresetMeta, password?: string, passphrase?: string): Promise<void>` supporting both `authType: 'password'` and `authType: 'key'` — use connection options confirmed in spike 0.1
- [ ] 4.2 Implement `uploadFile(localPath: string, remotePath: string, onProgress: (transferred: number, total: number) => void): Promise<void>` in `sftpClient.ts`: create remote parent directory if missing, stream upload via `ssh2-sftp-client` `fastPut`, call `onProgress` on each chunk
- [ ] 4.3 Implement cancellation in `sftpClient.ts`: add `cancelUpload()` method that sets a `_cancelled` flag and is safe to call when no upload is active (no throw); check the flag in the `fastPut` step callback and reject + delete the partial remote file if set
- [ ] 4.4 Implement `disconnect(): Promise<void>` in `sftpClient.ts` — idempotent (safe to call when already disconnected or never connected)
- [ ] 4.5 Implement `listDirectory(remotePath: string): Promise<RemoteEntry[]>` in `sftpClient.ts`: if `remotePath` is `''` treat as `/`; list remote path, map entries to `{ name, type: 'directory'|'file', path }` where `path` is the full absolute remote path; return `[]` for empty directories

- [ ] 4.6 Write `src/sftp/zipBuilder.ts`: implement `createZip(anchorPath: string, filePaths: string[]): Promise<string>` using the streaming pattern confirmed in spike 0.3; output filename `{anchorStem}_{YYYYMMDDTHHmmss}.zip` in same directory as anchor; return absolute output path

## 5. Webview UI (parallel-eligible with tasks 3 and 4 — start after task 2.5)

- [ ] 5.1 Write `media/panel.html`: shell HTML with CSP `<meta>` using exact placeholders `{{nonce}}` and `{{cspSource}}`; `<link href="{{cssUri}}">` for styles; `<script nonce="{{nonce}}" src="{{scriptUri}}">` for the script; three top-level `<section>` elements with IDs `view-upload`, `view-manage`, `view-remote-browser` — use no other placeholder syntax; these exact strings are required for `SftpPanel.ts` substitution
- [ ] 5.2 Write `media/panel.css`: all layout and component styles using VS Code CSS variables only — no hardcoded hex colours, `rgb()`, or named colour keywords (except `transparent`/`inherit`); style file list, checkboxes, mode toggle, log box, breadcrumb, remote browser overlay, history section, form elements, spinner
- [ ] 5.3 Implement VS Code message API wrappers in `media/panel.js`: `const vscode = acquireVsCodeApi()` — called exactly once at the top of the file, outside any function or event handler (calling it more than once throws at runtime); `function post(msg)` helper wrapping `vscode.postMessage`; `window.addEventListener('message', e => { const msg = e.data; switch(msg.command) { ... } })` dispatcher routing each `HostMessage` command to the appropriate UI update function
- [ ] 5.4 Implement main upload view in `panel.js`: preset dropdown population from `presets` message, remote dir row update on preset change, folder path display, mode toggle (zip/separate), output row show/hide, "📂 Change…" folder browse (posts `listFiles`), Upload button (posts `upload`), Stop button (posts `cancelUpload`)
- [ ] 5.5 Implement file list in `panel.js`: render `FileEntry[]` from `filesListed` message as checkboxes; anchor file always checked + disabled; "Select all" / "Deselect all" on non-anchor files; text filter input (case-insensitive substring, non-anchor files only, anchor always shown)
- [ ] 5.6 Implement progress log in `panel.js`: clear log at upload start; append each `progress` message as a new `<div>` line; auto-scroll to bottom on each append; append success/error line on `uploadDone`
- [ ] 5.7 Implement history section in `panel.js`: "📋 History" button toggles section visibility; render `HistoryEntry[]` from `history` message newest-first with timestamp, preset, mode, file list, and result badge
- [ ] 5.8 Implement manage presets view in `panel.js`: "⚙ Manage" button switches to `view-manage`; render preset list with Edit (inline form pre-populated from `PresetMeta`, password field blank), Delete (posts `deletePreset`), Test (posts `testConnection`, renders `testResult` inline); Add preset (blank form); "Import from FileZilla…" (posts `importFileZilla`); back arrow returns to `view-upload`
- [ ] 5.9 Implement remote browser overlay in `panel.js`: "📌 Change…" shows `view-remote-browser`; posts `{ command: 'browseRemote', preset, path: '' }` on open; spinner while awaiting `remoteListed`; render breadcrumb (each segment clickable); render directory entries (clicking a dir posts `browseRemote` into it, file entries are not clickable); "📌 Pin this folder" posts `pinFolder` then `closeBrowser`, closes overlay, updates remote dir row; Cancel button posts `closeBrowser` and closes overlay
- [ ] 5.10 Implement UI state persistence in `panel.js`: on `DOMContentLoaded` post `getState` and `getPresets`; restore mode, preset selection, and folder from `state` response; on mode toggle, preset selection, and folder change, post `setState`

## 6. Checkpoint 1 — Interface Alignment Review (subagent)

- [ ] 6.1 Dispatch a `code-reviewer` subagent scoped to `src/types/messages.ts`, `src/config/presetManager.ts`, `src/sftp/sftpClient.ts`, `src/sftp/zipBuilder.ts`, `src/config/fileZillaImporter.ts`, `src/config/stateManager.ts`, and `media/panel.js` — verify: (a) no inline message shapes defined outside `messages.ts`, (b) all 14 `WebviewMessage` commands present including `closeBrowser`, (c) `PresetWithCredentials` not used in any `HostMessage`, (d) `cancelUpload()` does not throw when called with no upload in progress, (e) `presetManager` and `stateManager` each export `init()` and no method is callable before `init()`, (f) `acquireVsCodeApi()` called exactly once at module top in `panel.js`, (g) `panel.html` uses only `{{nonce}}`, `{{cspSource}}`, `{{cssUri}}`, `{{scriptUri}}` as placeholders
- [ ] 6.2 Fix all issues flagged by checkpoint 1 before proceeding to task group 7

## 7. Panel Host — SftpPanel.ts

- [ ] 7.1 Write `src/webview/SftpPanel.ts`: static `currentPanel: SftpPanel | undefined` singleton; `createOrShow(context: vscode.ExtensionContext, anchorUri: vscode.Uri, statusBar: StatusBar)` method — `StatusBar` is a locally-defined interface `{ startSpinner(): void; setSuccess(): void; setError(msg: string): void }`; reveals existing panel or creates new one with `ViewColumn.Beside` and `retainContextWhenHidden: true`; stores `statusBar` reference on the instance
- [ ] 7.2 After setting `webview.html`, immediately post initial state: `this._panel.webview.postMessage({ command: 'presets', presets: presetManager.getAll() })` and `this._panel.webview.postMessage({ command: 'state', state: stateManager.getState() })`
- [ ] 7.3 Implement `_getHtmlForWebview(webview)` in `SftpPanel.ts`: generate a cryptographically random nonce (`crypto.randomBytes(16).toString('hex')`), read `media/panel.html` from disk, substitute `{{nonce}}`, `{{cspSource}}`, `{{cssUri}}`, `{{scriptUri}}` using `String.replace()`, return the result
- [ ] 7.4 Wire `onDidReceiveMessage` in `SftpPanel.ts`: exhaustive switch over all 14 `WebviewMessage` commands; log a warning for unrecognised commands without throwing
- [ ] 7.5 Implement `listFiles` handler: call `vscode.workspace.fs.readDirectory(uri)`, map to `FileEntry[]` with `isAnchor: true` for the file matching the anchor URI, post `filesListed`
- [ ] 7.6 Implement `upload` handler: call `this._statusBar.startSpinner()`; wrap in `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true })`; in zip mode call `zipBuilder.createZip` then `sftpClient.uploadFile`; in separate mode loop `sftpClient.uploadFile` per file with progress prefixed `[N/M] Uploading <filename> — <percent>%`; forward progress to both webview and VS Code notification; on cancellation call `sftpClient.cancelUpload()`; post `uploadDone`; call `this._statusBar.setSuccess()` or `this._statusBar.setError(err)`; call `stateManager.appendHistory` and `stateManager.setState({ lastPreset })`
- [ ] 7.7 Implement `testConnection` handler: call `presetManager.getPassword(name)` and `getPassphrase(name)`; instantiate a new `SftpClient()`, call `.connect(preset, password, passphrase)`; call `.disconnect()` immediately; post `{ command: 'testResult', success: true/false, preset: name, error? }`
- [ ] 7.8 Implement remaining handlers: `cancelUpload` → `sftpClient.cancelUpload()`; `getPresets`/`savePreset`/`deletePreset` → `presetManager` methods → post `presets`; `importFileZilla` → show file picker → if cancelled post `{ command: 'importDone', imported: 0, presets: presetManager.getAll() }` and return → else `fileZillaImporter.parse` → loop `presetManager.save` → post `importDone`; `getHistory` → post `history`; `getState`/`setState` → `stateManager`; `pinFolder` → `presetManager.pinFolder()` → `_browserClient?.disconnect()` → `_browserClient = undefined` → post `presets`; `closeBrowser` → `_browserClient?.disconnect()` → `_browserClient = undefined`
- [ ] 7.9 Implement `browseRemote` handler: if `_browserClient` is undefined or the preset differs from the current browser session, disconnect existing client and connect a new `SftpClient` for the requested preset; cache as `_browserClient`; if `path === ''` use `'/'`; call `_browserClient.listDirectory(path)` → post `remoteListed`
- [ ] 7.10 Implement `dispose()`: call `_browserClient?.disconnect()`, call `_panel.dispose()`, dispose all `_disposables`, set `SftpPanel.currentPanel = undefined`
- [ ] 7.11 Implement `onDidDispose` handler: call `this.dispose()`

## 8. Extension Entry — extension.ts

- [ ] 8.1 Write `src/extension.ts`: implement `activate(context: vscode.ExtensionContext)`; call `presetManager.init(context)` and `stateManager.init(context)` first; then register three commands: `sftpUpload.openPanel` (→ `SftpPanel.createOrShow(context, activeXmlUri, statusBar)`), `sftpUpload.quickUpload`, `sftpUpload.importFileZilla` (→ open panel via `SftpPanel.createOrShow` if not open, then post `{ command: 'importFileZilla' }` to the panel); push all to `context.subscriptions`
- [ ] 8.2 Implement `sftpUpload.hasPresets` context variable in `activate`: call `setContext('sftpUpload.hasPresets', presets.length > 0)` immediately after `presetManager.init`; expose a `refreshHasPresets()` helper called after every `presetManager.save` and `presetManager.delete`
- [ ] 8.3 Implement lazy status bar item in `extension.ts`: create on first command activation (not on startup); type as `StatusBar` interface matching the one in `SftpPanel.ts` (`{ startSpinner, setSuccess, setError }`); idle text `$(cloud-upload) <lastPreset or 'SFTP Upload'>`; spinner frame animation at 100ms intervals; 3-second auto-reset on success; `$(issue-opened) Upload failed` on error (persists until next action); click opens QuickPick to switch preset; push to `context.subscriptions`
- [ ] 8.4 Implement `sftpUpload.quickUpload` command handler: read `lastPreset` from `stateManager`; if no presets configured show `showErrorMessage`; if no `lastPreset` show QuickPick; connect using `new SftpClient()` + `presetManager.getPassword`; upload active XML file; show progress via `withProgress`; update `stateManager` history and `lastPreset`; call `statusBar.setSuccess()` or `statusBar.setError()`
- [ ] 8.5 Register `onDidChangeConfiguration` listener scoped to `'sftpUpload'`: on change re-read presets, post `presets` to `SftpPanel.currentPanel` if open, call `refreshHasPresets()`
- [ ] 8.6 Implement `deactivate()` export (empty function — subscriptions handle cleanup)

## 9. Package Manifest — Contributions

- [ ] 9.1 Add `commands` to `package.json` `contributes`: `sftpUpload.openPanel` (title "Open SFTP Upload Panel", category "SFTP Upload", icon `$(cloud-upload)`), `sftpUpload.quickUpload` (title "Quick Upload", category "SFTP Upload"), `sftpUpload.importFileZilla` (title "Import from FileZilla…", category "SFTP Upload")
- [ ] 9.2 Add `menus`: `explorer/context` and `editor/context` entries for `openPanel` (group `sftp@1`) and `quickUpload` (group `sftp@2`), both `when: "resourceExtname == .xml"`; `editor/title` entry for `openPanel` with `when: "resourceExtname == .xml"`, `group: "navigation"`
- [ ] 9.3 Add `keybindings`: `sftpUpload.openPanel` with `key: "ctrl+shift+u"`, `mac: "cmd+shift+u"`, `when: "resourceExtname == .xml"`
- [ ] 9.4 Add `configuration`: `sftpUpload.presets` array with properties `name`, `host`, `port` (default 22), `username`, `remoteDir`, `authType` (enum password/key), `keyPath`; all with `markdownDescription`; confirm no `password` or `passphrase` field in schema
- [ ] 9.5 Set `activationEvents` to `["onCommand:sftpUpload.openPanel", "onCommand:sftpUpload.quickUpload", "onCommand:sftpUpload.importFileZilla"]` — no `"*"`

## 10. Checkpoint 2 — Integration Review (subagent)

- [ ] 10.1 Dispatch a `code-reviewer` subagent scoped to `src/webview/SftpPanel.ts`, `src/extension.ts`, and `package.json` — verify: (a) all 14 `WebviewMessage` commands handled including `closeBrowser`, (b) `presetManager.init` and `stateManager.init` called before any command handler in `activate`, (c) `statusBar` passed to `SftpPanel.createOrShow`, (d) initial `presets` + `state` messages posted immediately after setting `webview.html`, (e) `retainContextWhenHidden: true` and `ViewColumn.Beside` set, (f) all disposables in `_disposables` or `context.subscriptions`, (g) singleton cleared on dispose, (h) upload wrapped in `withProgress` with `cancellable: true`, (i) `_browserClient` disconnected in `dispose()`, (j) `importFileZilla` command opens panel before posting, (k) `package.json` `activationEvents` has no `"*"`, (l) settings schema has no `password`/`passphrase` field
- [ ] 10.2 Fix all issues flagged by checkpoint 2 before proceeding to task group 11

## 11. Smoke Test in Extension Development Host

- [ ] 11.1 Press F5 in VS Code to launch the Extension Development Host; confirm extension activates without errors in the Debug Console
- [ ] 11.2 Right-click an XML file → confirm "Open SFTP Upload Panel" and "Quick Upload" appear; confirm `$(cloud-upload)` title bar icon appears
- [ ] 11.3 Open panel → confirm it opens beside the XML; confirm preset dropdown is pre-populated (or shows empty-state prompt) without user interaction
- [ ] 11.4 Add a test preset via manage panel; click Test Connection → confirm success/failure shown inline; confirm status bar updates to show preset name
- [ ] 11.5 Open remote folder browser → navigate into at least two subdirectories → confirm no second SFTP connection is opened (check server logs or add console.log to `connect()`); pin a folder → confirm remote dir row updates and browser closes
- [ ] 11.6 Upload a file in ZIP mode → confirm ZIP appears locally, upload completes, history entry recorded, status bar shows success and resets after 3s
- [ ] 11.7 Upload 3 files in separate mode → confirm progress log shows `[1/3]`, `[2/3]`, `[3/3]` prefixes
- [ ] 11.8 Run `sftpUpload.importFileZilla` from command palette when panel is closed → confirm panel opens then import dialog appears
- [ ] 11.9 `Ctrl+Shift+U` on XML → panel opens; same shortcut on a `.ts` file → nothing happens
- [ ] 11.10 Edit `sftpUpload.presets` in `settings.json` directly → confirm open panel refreshes dropdown automatically

## 12. Unit Tests

- [ ] 12.1 Install `jest`, `ts-jest`, `@types/jest` as dev dependencies; write `jest.config.js` with `ts-jest` preset targeting `node` test environment; add `"test": "jest"` to `package.json` scripts
- [ ] 12.2 Write `src/__tests__/fileZillaImporter.test.ts`: SFTP sites imported, FTP sites skipped (`<Protocol>` ≠ `1`); base64 `<Pass encoding="base64">dGVzdHBhc3M=</Pass>` decoded to `'testpass'`; entry with no `<Pass>` element returns `password: undefined`; host, port, username fields mapped correctly to `PresetWithCredentials`
- [ ] 12.3 Write `src/__tests__/stateManager.test.ts`: `appendHistory` keeps entries newest-first; `appendHistory` caps at 50 entries (51st push drops the oldest, list stays at 50); `getState` returns `{}` when never set; `setState` merges partial state without overwriting unmentioned fields
- [ ] 12.4 Write `src/__tests__/zipBuilder.test.ts` (uses real `archiver` against OS temp files): ZIP filename matches pattern `{anchorStem}_\d{8}T\d{6}\.zip`; returned path resolves to a readable ZIP file; extracted entries contain only basenames (no directory prefix); all `filePaths` entries are represented inside the archive
- [ ] 12.5 Write `src/__tests__/messages.test.ts`: write a compile-time exhaustiveness check — a dummy `switch (msg.command)` in a scratch file covering all 14 `WebviewMessage` variants; confirm `tsc --noEmit` reports no error on it; write a TypeScript conditional-type assertion that no `HostMessage` variant has a `password` property
- [ ] 12.6 Run `npm test` — all tests must pass before proceeding to the final review

## 13. Final Comprehensive Review (subagent)

- [ ] 13.1 Dispatch a `code-reviewer` subagent with the following checklist — do not proceed to packaging until all pass:
  - **CSP**: nonce is `crypto.randomBytes(16).toString('hex')`; nonce present on `<script>` and `<style>` tags; `script-src 'nonce-{nonce}'`; no external URLs
  - **Theme**: grep `media/panel.css` for `#[0-9a-fA-F]{3,6}` and `rgb(` — expect zero matches
  - **SecretStorage**: grep entire `src/` for `password` in any settings write or `HostMessage` — expect zero matches
  - **Activation events**: `package.json` `activationEvents` contains no `"*"`
  - **Disposables**: every `Disposable` in `extension.ts` and `SftpPanel.ts` accounted for; `_browserClient` disconnected in `dispose()`
  - **Engine version**: `engines.vscode` is `^1.74.0`
  - **Module init**: `presetManager.init` and `stateManager.init` are the first calls in `activate()`
  - **Credentials in transit**: `PresetWithCredentials` only appears in `savePreset` handler (host receives); never appears in any host→webview post
  - **acquireVsCodeApi**: appears exactly once in `panel.js` at module top level
  - **cancelUpload idempotency**: calling it with no active upload does not throw
  - **Browser session cleanup**: `_browserClient` set to `undefined` after `closeBrowser`, `pinFolder`, and `dispose()`
  - **Settings schema**: `package.json` configuration schema contains no `password` or `passphrase` property
- [ ] 13.2 Fix all issues flagged by the final review

## 14. Packaging and Publish Prep

- [ ] 14.1 Write `README.md`: feature list, setup instructions, FileZilla import walkthrough, note on Settings UI raw JSON rendering directing users to the manage panel, required VS Code version
- [ ] 14.2 Write `CHANGELOG.md` with initial `0.1.0` entry
- [ ] 14.3 Write `LICENSE` (MIT)
- [ ] 14.4 Add a placeholder `icon.png` (128×128 PNG at repo root) — `vsce package` requires this file; final icon can replace it before publish
- [ ] 14.5 Add `"vscode:prepublish": "npm run compile"` to `package.json` scripts so `vsce package` always builds before packaging
- [ ] 14.6 Run `npx vsce package` — expect clean `.vsix` under 50 MB; install locally with `code --install-extension sftp-upload-0.1.0.vsix` and re-run smoke tests 11.1–11.10
- [ ] 14.7 Set `publisher` to `am-vs-tools` in `package.json`; run `npx vsce publish`
