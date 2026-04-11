## ADDED Requirements

### Requirement: Module initialization pattern
`presetManager` and `stateManager` SHALL each export an `init(context: vscode.ExtensionContext): void` function. This function MUST be called from `activate()` before the modules are used by any other code. `SftpPanel.ts` and `extension.ts` SHALL import from these modules only after `init` has been called. This pattern ensures `context.secrets` and `context.globalState` are available without each module needing to accept context as a parameter on every method call.

#### Scenario: init called before any module method
- **WHEN** `activate()` runs
- **THEN** `presetManager.init(context)` and `stateManager.init(context)` are called before any command handler or panel is created

### Requirement: Status bar integration
`SftpPanel.createOrShow()` SHALL accept a `statusBar` parameter (an object with `startSpinner()`, `setSuccess()`, and `setError(msg: string)` methods, created in `extension.ts`). During the upload flow, `SftpPanel` SHALL call `statusBar.startSpinner()` when the upload begins and `statusBar.setSuccess()` or `statusBar.setError(error)` when `uploadDone` is posted. This is the only cross-module communication channel between the panel and the status bar.

#### Scenario: Status bar animates during panel-initiated upload
- **WHEN** the user clicks Upload in the panel and the upload begins
- **THEN** `statusBar.startSpinner()` is called and the status bar animates

#### Scenario: Status bar resets after panel upload completes
- **WHEN** `uploadDone` is posted with `success: true`
- **THEN** `statusBar.setSuccess()` is called

### Requirement: Panel initialization sequence
After setting `webview.html` on panel creation, the host SHALL immediately post two messages to the webview without waiting for requests: `{ command: 'presets', presets: presetManager.getAll() }` and `{ command: 'state', state: stateManager.getState() }`. The webview SHALL use these to populate the preset dropdown and restore UI state on first render. The webview still sends `getState` and `getPresets` on `DOMContentLoaded` as a fallback for panel reveals after `retainContextWhenHidden` has cleared JS state.

#### Scenario: Preset dropdown populated on panel open without user interaction
- **WHEN** the panel is created and HTML is set
- **THEN** the host immediately posts `presets` and `state` messages; the preset dropdown is populated before the user clicks anything

### Requirement: Single panel instance
`SftpPanel` SHALL maintain at most one live `vscode.WebviewPanel` at a time, tracked as a static or module-level singleton. If `SftpPanel.createOrShow()` is called while a panel is already open, the existing panel SHALL be revealed (brought to focus) rather than a second panel being created.

#### Scenario: Second openPanel call reveals existing panel
- **WHEN** the user triggers `sftpUpload.openPanel` while the panel is already open but hidden behind another tab
- **THEN** the existing panel becomes focused; no second panel is created

#### Scenario: Panel can be reopened after closing
- **WHEN** the user closes the panel and then triggers `sftpUpload.openPanel` again
- **THEN** a new panel is created successfully

### Requirement: Panel placement and retention
The panel SHALL be created with `ViewColumn.Beside` so it opens to the right of the active editor. `retainContextWhenHidden: true` SHALL be set on the webview options so that all JS state (file selections, filter text, mode toggle, active view) is preserved when the panel is hidden and restored when revealed.

#### Scenario: Panel opens beside the XML file
- **WHEN** the user right-clicks an XML file and selects "Open SFTP Upload Panel"
- **THEN** the panel appears in a column to the right of the XML file's editor column; the XML file remains visible

#### Scenario: File selections preserved on tab switch
- **WHEN** the user checks several files in the panel, switches to a different editor tab, then returns to the panel tab
- **THEN** the previously checked files are still checked

### Requirement: CSP nonce and asset URI injection
`SftpPanel` SHALL generate a cryptographically random nonce per panel creation (using `crypto.randomBytes(16).toString('hex')` or equivalent). The nonce SHALL be embedded in the `<meta http-equiv="Content-Security-Policy">` header and on every `<script>` and `<style>` tag in the rendered HTML. All asset paths (`panel.js`, `panel.css`) SHALL be converted to webview-safe URIs via `panel.webview.asWebviewUri()` before injection into the HTML.

#### Scenario: CSP header present in rendered HTML
- **WHEN** the webview HTML is generated
- **THEN** the `<meta>` CSP tag restricts `script-src` to `'nonce-{nonce}'` and `style-src` to `${webview.cspSource} 'nonce-{nonce}'`

#### Scenario: Assets loaded via asWebviewUri
- **WHEN** the panel HTML is inspected
- **THEN** the `src` of the `<script>` tag and the `href` of the `<link>` tag are `vscode-webview-resource:` URIs, not raw `file://` paths

### Requirement: Exhaustive WebviewMessage routing
`SftpPanel` SHALL handle every command in the `WebviewMessage` union. Each handler SHALL be wired as a case in the `panel.webview.onDidReceiveMessage` callback. Unrecognised commands SHALL be logged as a warning but SHALL NOT throw.

Routing table:
| WebviewMessage command | Handler |
|---|---|
| `listFiles` | `vscode.workspace.fs.readDirectory` → post `filesListed` |
| `upload` | `zipBuilder` (zip mode) or direct → `sftpClient.uploadFile` → post `progress` / `uploadDone` |
| `cancelUpload` | `sftpClient.cancelUpload()` |
| `testConnection` | `presetManager.getPassword/getPassphrase` → new `SftpClient().connect()` → `disconnect()` → post `testResult` (no import of presetManager.testConnection — direct client use) |
| `getPresets` | `presetManager.getAll()` → post `presets` |
| `savePreset` | `presetManager.save()` → post `presets` |
| `deletePreset` | `presetManager.delete()` → post `presets` |
| `importFileZilla` | file picker → `fileZillaImporter` → `presetManager.save` (loop) → post `importDone` |
| `getHistory` | `stateManager.getHistory()` → post `history` |
| `getState` | `stateManager.getState()` → post `state` |
| `setState` | `stateManager.setState()` |
| `browseRemote` | reuse `_browserClient` (connect if not open) → `listDirectory` → post `remoteListed` |
| `pinFolder` | `presetManager.pinFolder()` → post `presets`; call `_browserClient.disconnect()`, set `_browserClient = undefined` |
| `closeBrowser` | `_browserClient?.disconnect()`, set `_browserClient = undefined` |

#### Scenario: listFiles posts filesListed with isAnchor set
- **WHEN** the webview posts `{ command: 'listFiles', folder: '/invoices' }` and the panel was opened from `/invoices/INV-001.xml`
- **THEN** the host reads the directory and posts `{ command: 'filesListed', folder: '/invoices', files: [{name: 'INV-001.xml', isAnchor: true, ...}, ...] }`

#### Scenario: upload in zip mode builds ZIP then uploads
- **WHEN** the webview posts `{ command: 'upload', mode: 'zip', files: [...], preset: 'DEV', folder: '...' }`
- **THEN** the host calls `zipBuilder.createZip`, then `sftpClient.uploadFile` with the ZIP path, posting `progress` events and a final `uploadDone`

#### Scenario: Unrecognised command does not crash
- **WHEN** the webview posts `{ command: 'unknownCommand' }`
- **THEN** the host logs a warning and does not throw an unhandled exception

### Requirement: Browser session management
`SftpPanel` SHALL maintain a separate `_browserClient: SftpClient | undefined` instance used exclusively for the remote folder browser. When `browseRemote` is received, if `_browserClient` is `undefined` the host SHALL connect a new client using the requested preset's credentials and cache it. Subsequent `browseRemote` messages for the same preset reuse the open connection. When `closeBrowser` is received, or when `pinFolder` is processed, the host SHALL call `_browserClient.disconnect()` and set `_browserClient = undefined`. If a new `browseRemote` arrives for a different preset than the current `_browserClient`, the existing client MUST be disconnected before connecting the new one.

#### Scenario: Navigating directories reuses one connection
- **WHEN** the user clicks through three directories in the browser overlay (posting three `browseRemote` messages)
- **THEN** only one SFTP connection is established; `listDirectory` is called three times on the same client

#### Scenario: Switching preset in browser reconnects
- **WHEN** the user is browsing with preset "DEV" and opens the browser again with preset "PROD"
- **THEN** the DEV client is disconnected and a new PROD client is connected before listing

#### Scenario: Cancelling browser disconnects session
- **WHEN** the webview posts `{ command: 'closeBrowser' }`
- **THEN** `_browserClient.disconnect()` is called and `_browserClient` is set to `undefined`

### Requirement: Separate files upload progress formatting
In separate files mode, `SftpPanel` SHALL prefix each `progress` message with the file index and total: `[N/M] Uploading <filename> — <percent>%`. This gives the webview meaningful context without requiring changes to the `progress` message shape.

#### Scenario: Separate files progress includes file context
- **WHEN** uploading 3 files in separate mode and file 2 is at 60%
- **THEN** the webview receives `{ command: 'progress', message: '[2/3] Uploading invoice.pdf — 60%', percent: 60 }`

### Requirement: Import file picker cancellation
When the `importFileZilla` handler shows the VS Code file picker and the user cancels (selects nothing), the host SHALL post `{ command: 'importDone', imported: 0, presets: presetManager.getAll() }` so the webview can reset any loading state.

#### Scenario: Cancelled file picker posts importDone with zero imports
- **WHEN** the user triggers the FileZilla import and then closes the file picker without selecting a file
- **THEN** the host posts `{ command: 'importDone', imported: 0, presets: [...] }` and no preset changes are made

### Requirement: Upload progress forwarded to webview and VS Code notification
During an upload, `SftpPanel` SHALL wrap the operation in `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true })`. Progress events from `sftpClient` SHALL be forwarded both to the VS Code notification (via the `progress.report()` callback) and to the webview (via `{ command: 'progress', message, percent }` messages). If the user cancels via the notification toast, `sftpClient.cancelUpload()` SHALL be called.

#### Scenario: VS Code notification appears during upload
- **WHEN** an upload begins
- **THEN** a progress notification toast appears in VS Code with a cancel button

#### Scenario: Cancelling via notification toast cancels the upload
- **WHEN** the user clicks the cancel button on the VS Code progress notification
- **THEN** `sftpClient.cancelUpload()` is called and a `{ command: 'uploadDone', success: false, error: 'Cancelled' }` message is posted to the webview

### Requirement: Upload history recorded after each upload
After every completed upload (success or failure), `SftpPanel` SHALL call `stateManager.appendHistory(entry)` with a `HistoryEntry` containing the timestamp, preset name, mode, file list, result, and error (if any). The `lastPreset` state SHALL also be updated to the used preset name.

#### Scenario: History entry recorded on successful upload
- **WHEN** an upload completes successfully
- **THEN** `stateManager.getHistory()` returns an array where the first entry has `result: 'success'` and the correct preset, files, and timestamp

#### Scenario: History entry recorded on failed upload
- **WHEN** an upload fails due to a connection error
- **THEN** `stateManager.getHistory()` returns an entry with `result: 'error'` and a non-empty `error` field

### Requirement: Disposable cleanup
The `vscode.WebviewPanel`, its `onDidReceiveMessage` listener, and the `onDidDispose` handler SHALL all be disposed when the panel is closed. `SftpPanel` MUST push all disposables to an internal `_disposables` array and dispose them in `dispose()`. The singleton reference MUST be set to `undefined` on panel disposal so a new panel can be created.

#### Scenario: Singleton cleared on panel close
- **WHEN** the user closes the panel
- **THEN** the static singleton reference is `undefined` and calling `SftpPanel.createOrShow()` creates a fresh panel
