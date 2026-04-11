## ADDED Requirements

### Requirement: Command registration
The `activate` function in `extension.ts` SHALL register exactly three commands: `sftpUpload.openPanel`, `sftpUpload.quickUpload`, and `sftpUpload.importFileZilla`. All three SHALL be pushed to `context.subscriptions`. The commands SHALL be registered on every activation regardless of whether presets exist.

The `sftpUpload.importFileZilla` command handler in `extension.ts` SHALL open the panel first via `SftpPanel.createOrShow(context, anchorUri, statusBar)` if it is not already open, then post `{ command: 'importFileZilla' }` to the panel. This ensures the import flow always has a live panel to receive `importDone`.

#### Scenario: Commands registered on activation
- **WHEN** the extension activates (e.g. user runs `sftpUpload.openPanel` for the first time)
- **THEN** all three commands are available in the VS Code command palette

#### Scenario: Commands pushed to subscriptions
- **WHEN** the extension deactivates
- **THEN** no "command already registered" or "command not found" errors appear in the extension host log

### Requirement: Specific activation events (not wildcard)
`package.json` SHALL declare `activationEvents` as exactly `["onCommand:sftpUpload.openPanel", "onCommand:sftpUpload.quickUpload", "onCommand:sftpUpload.importFileZilla"]`. The wildcard `"*"` SHALL NOT be used. The extension MUST NOT activate on VS Code startup unless the user triggers one of the three commands.

#### Scenario: Extension not loaded on VS Code startup
- **WHEN** VS Code starts with no active XML file and the user triggers no SFTP Upload command
- **THEN** the extension host does not load `sftp-upload`

#### Scenario: Extension loads on first command
- **WHEN** the user right-clicks an XML file and selects "Open SFTP Upload Panel"
- **THEN** the extension activates and the panel opens

### Requirement: sftpUpload.hasPresets context variable
On activation, `extension.ts` SHALL read the current preset list from `presetManager` and call `vscode.commands.executeCommand('setContext', 'sftpUpload.hasPresets', presets.length > 0)`. The same `setContext` call SHALL be made after every preset add or delete to keep the context variable current.

#### Scenario: hasPresets false when no presets configured
- **WHEN** no presets are configured and the extension activates
- **THEN** `sftpUpload.hasPresets` is `false` and palette commands are hidden per their `when` clause

#### Scenario: hasPresets true after first preset added
- **WHEN** the user saves a new preset via the manage panel
- **THEN** `sftpUpload.hasPresets` is set to `true` and the commands become visible in the palette

### Requirement: Animated status bar item
`extension.ts` SHALL create a `vscode.StatusBarItem` with `StatusBarAlignment.Left` on first command activation (lazy — not on startup). The item SHALL display `$(cloud-upload) <presetName>` in idle state. During upload, it SHALL animate with spinner frames (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`) at 100ms intervals. On upload success, it SHALL display a checkmark and auto-reset to idle after 3 seconds. On upload error, it SHALL display `$(issue-opened) Upload failed` and remain until the next action. Clicking the status bar item SHALL open a `vscode.QuickPick` to switch the active preset.

#### Scenario: Status bar shows active preset name at idle
- **WHEN** no upload is in progress and `lastPreset` is "DEV - AcmeCorp"
- **THEN** the status bar item text is `$(cloud-upload) DEV - AcmeCorp`

#### Scenario: Status bar animates during upload
- **WHEN** an upload begins
- **THEN** the status bar item text cycles through spinner frames at approximately 100ms intervals

The `statusBar` object (exposing `startSpinner()`, `setSuccess()`, `setError(msg)`) SHALL be passed as a parameter to `SftpPanel.createOrShow()` so the panel can call these methods directly during uploads. `extension.ts` owns the statusBar instance; `SftpPanel.ts` uses it but does not create it.

#### Scenario: Status bar resets after success
- **WHEN** an upload completes successfully
- **THEN** the status bar item shows a success indicator and reverts to `$(cloud-upload) <presetName>` after 3 seconds

#### Scenario: Clicking status bar opens preset QuickPick
- **WHEN** the user clicks the status bar item
- **THEN** a QuickPick list of all preset names appears for the user to select the active preset

### Requirement: Quick upload command
`sftpUpload.quickUpload` SHALL read `lastPreset` from `stateManager`. If a `lastPreset` is set, it SHALL upload the active XML file directly to that preset's `remoteDir` without opening the panel. If no `lastPreset` is set, it SHALL show a `vscode.QuickPick` listing all preset names and proceed with the chosen preset after selection.

#### Scenario: Quick upload uses last preset directly
- **WHEN** `lastPreset` is "DEV - AcmeCorp" and the user right-clicks an XML and selects "Quick Upload"
- **THEN** the XML is uploaded to "DEV - AcmeCorp"'s `remoteDir` without opening the panel; progress is shown via VS Code notification toast

#### Scenario: Quick upload with no last preset shows QuickPick
- **WHEN** `lastPreset` is not set and the user triggers quick upload
- **THEN** a QuickPick list of preset names appears; after selection, the upload proceeds and the selected preset becomes `lastPreset`

#### Scenario: Quick upload with no presets configured shows error
- **WHEN** no presets are configured and the user triggers quick upload
- **THEN** `vscode.window.showErrorMessage` is called with a message prompting the user to add a preset first

### Requirement: Keyboard shortcut
`package.json` SHALL register a keybinding for `sftpUpload.openPanel` with `"key": "ctrl+shift+u"`, `"mac": "cmd+shift+u"`, and `"when": "resourceExtname == .xml"`. The binding MUST be rebindable via VS Code's Keyboard Shortcuts editor.

#### Scenario: Ctrl+Shift+U opens panel when XML is active
- **WHEN** an XML file is the active editor and the user presses Ctrl+Shift+U (Windows/Linux) or Cmd+Shift+U (Mac)
- **THEN** the SFTP Upload panel opens

#### Scenario: Shortcut does not fire when non-XML file is active
- **WHEN** a `.ts` file is the active editor and the user presses Ctrl+Shift+U
- **THEN** the SFTP Upload command is not triggered (the `when` clause prevents it)

### Requirement: Configuration change listener
`extension.ts` SHALL register a `vscode.workspace.onDidChangeConfiguration` listener scoped to `'sftpUpload'`. When the user edits `sftpUpload.presets` directly in `settings.json`, the listener SHALL re-read the preset list and post a `{ command: 'presets', presets: [...] }` message to the open panel (if any), and update the `sftpUpload.hasPresets` context variable.

#### Scenario: Panel preset list refreshes on settings.json edit
- **WHEN** the user edits `sftpUpload.presets` directly in `settings.json` while the panel is open
- **THEN** the panel's preset dropdown updates to reflect the new preset list without the user manually reopening the panel

### Requirement: Minimum VS Code engine version
`package.json` SHALL declare `"engines": { "vscode": "^1.74.0" }`. This version is required for stable SecretStorage API support.

#### Scenario: Extension installs on VS Code 1.74 and later
- **WHEN** the `.vsix` is installed on VS Code 1.74.0
- **THEN** the extension loads without "engine version mismatch" errors

### Requirement: All disposables registered
Every event listener, the status bar item, and the panel created in `extension.ts` SHALL be pushed to `context.subscriptions` or an equivalent disposables array. No disposable SHALL be left unregistered.

#### Scenario: No disposable leak warnings in dev mode
- **WHEN** the extension is run in the Extension Development Host (F5) and then deactivated
- **THEN** VS Code's extension host reports no "disposable not disposed" warnings in the output channel
