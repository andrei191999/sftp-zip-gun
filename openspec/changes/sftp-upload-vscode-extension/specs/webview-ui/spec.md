## ADDED Requirements

### Requirement: Three views rendered in the same panel
The webview SHALL render three distinct views within the same HTML page by toggling `display` on top-level sections: (1) **main upload view**, (2) **manage presets view**, (3) **remote browser overlay**. Only one view SHALL be fully visible at a time. View state (selected files, mode, filter text) MUST be preserved when switching between views.

#### Scenario: Manage button switches to manage view
- **WHEN** the user clicks the "⚙ Manage" button in the main upload view
- **THEN** the manage presets section becomes visible and the main upload section is hidden

#### Scenario: Back arrow returns to main view
- **WHEN** the user clicks the back arrow in the manage presets view
- **THEN** the main upload section is restored with all prior selections intact

#### Scenario: Remote browser opens as overlay
- **WHEN** the user clicks "📌 Change…" in the remote dir row
- **THEN** the remote browser overlay appears on top of the main view without navigating away

### Requirement: Main upload view — preset row
The main upload view SHALL show a dropdown listing all named presets by their `name` field, plus an "⚙ Manage" button. Selecting a preset from the dropdown MUST update the remote dir row to show that preset's `remoteDir`. The active preset SHALL be persisted to UI state (`lastPreset`).

#### Scenario: Preset dropdown populates on panel open
- **WHEN** the panel opens and the host posts `{ command: 'presets', presets: [...] }`
- **THEN** the dropdown is populated with one option per preset name

#### Scenario: Selecting preset updates remote dir row
- **WHEN** the user selects "PROD - AcmeCorp" from the dropdown
- **THEN** the remote dir row updates to show PROD - AcmeCorp's `remoteDir` value

### Requirement: Main upload view — file list
The webview SHALL list all files in the current input folder as checkboxes. The anchor XML file (identified by `isAnchor: true` in the `filesListed` response) SHALL always be checked and its checkbox disabled — it cannot be unchecked. "Select all" and "Deselect all" buttons SHALL operate only on non-anchor files. A text filter input SHALL filter the displayed non-anchor files by substring match (case-insensitive); the anchor file is always shown regardless of filter.

#### Scenario: Anchor XML locked
- **WHEN** the file list is rendered
- **THEN** the checkbox for the anchor XML is checked and `disabled`, and "Select all" / "Deselect all" do not affect it

#### Scenario: Filter hides non-matching non-anchor files
- **WHEN** the user types "pdf" in the filter input
- **THEN** only non-anchor files whose names contain "pdf" (case-insensitive) are shown; the anchor XML remains visible

#### Scenario: Select all checks all non-anchor checkboxes
- **WHEN** the user clicks "Select all"
- **THEN** every non-anchor file's checkbox is checked

### Requirement: Main upload view — mode toggle and output row
The webview SHALL display a mode toggle with two options: "ZIP bundle" and "Separate files". In ZIP mode, an output row SHALL show the computed ZIP filename (`{anchorStem}_{ISO8601timestamp}.zip`) and the save path (same folder as anchor XML). The output row MUST NOT be shown in Separate files mode.

#### Scenario: ZIP mode shows output row
- **WHEN** the mode toggle is set to "ZIP bundle"
- **THEN** the output row is visible with the computed ZIP filename

#### Scenario: Separate files mode hides output row
- **WHEN** the mode toggle is set to "Separate files"
- **THEN** the output row is hidden

### Requirement: Main upload view — progress log
The webview SHALL display a monospace scrollable log box below the Upload button. Each `progress` HostMessage SHALL append a new line to the log. An `uploadDone` HostMessage SHALL append a final success or error line. The log MUST auto-scroll to the bottom on each new line.

#### Scenario: Progress messages appear in log
- **WHEN** the host posts `{ command: 'progress', message: 'Connecting...' }`
- **THEN** "Connecting..." appears as a new line in the log box

#### Scenario: Log auto-scrolls on new content
- **WHEN** a new line is appended to the log box
- **THEN** the log scrolls so the new line is visible without user interaction

### Requirement: Upload history section
The webview SHALL include a collapsible history section toggled by a "📋 History" button. When expanded, it SHALL display the last 50 upload entries from the `history` HostMessage, showing timestamp, preset name, mode, file list, and result (success/error) per entry, newest first.

#### Scenario: History section toggles on button click
- **WHEN** the user clicks "📋 History"
- **THEN** the history section expands if collapsed, or collapses if expanded

#### Scenario: History entries shown newest first
- **WHEN** the history section is expanded after receiving a `history` message with N entries
- **THEN** the most recent entry (highest timestamp) is shown at the top

### Requirement: Manage presets view
The manage view SHALL list all presets with per-preset actions: edit (opens an inline form pre-populated with non-sensitive fields), delete (removes preset), and test connection (fires `testConnection` message and shows result inline). An "Import from FileZilla…" button SHALL fire the `importFileZilla` message. An "Add preset" action SHALL open a blank form.

#### Scenario: Edit form pre-populated with non-sensitive fields
- **WHEN** the user clicks Edit on a preset
- **THEN** an inline form appears with name, host, port, username, remoteDir, authType, and keyPath pre-filled; password field is empty

#### Scenario: Delete fires deletePreset message
- **WHEN** the user confirms deletion of a preset
- **THEN** the webview posts `{ command: 'deletePreset', name: '<presetName>' }` to the host

#### Scenario: Test connection result shown inline
- **WHEN** the host posts `{ command: 'testResult', success: true, preset: 'DEV - AcmeCorp' }`
- **THEN** a success indicator appears next to the "DEV - AcmeCorp" preset row

### Requirement: Remote browser overlay
The remote browser overlay SHALL show a breadcrumb path and a directory listing for the current remote path. Clicking a directory entry SHALL post `{ command: 'browseRemote', preset, path }` to navigate into it. A "📌 Pin this folder" button SHALL post `{ command: 'pinFolder', preset, path }` and close the overlay, updating the remote dir row with the new path. A loading spinner SHALL be shown while awaiting a `remoteListed` response.

#### Scenario: Clicking directory navigates into it
- **WHEN** the user clicks a directory entry named "acme" in the browser overlay
- **THEN** the webview posts `{ command: 'browseRemote', preset: '...', path: '/intake/acme' }` and shows a spinner

#### Scenario: Pin this folder closes overlay and updates remote dir row
- **WHEN** the user clicks "📌 Pin this folder" while browsing `/intake/acme/uat`
- **THEN** the overlay closes, the remote dir row updates to `/intake/acme/uat`, and `{ command: 'pinFolder', ... path: '/intake/acme/uat' }` is posted to the host

#### Scenario: Breadcrumb segments are clickable
- **WHEN** the user is at `/intake/acme/uat` and clicks "intake" in the breadcrumb
- **THEN** the webview posts `{ command: 'browseRemote', path: '/intake' }` to navigate up

### Requirement: Theme compliance — VS Code CSS variables only
All CSS in `media/panel.css` SHALL use VS Code CSS custom properties exclusively. No hardcoded hex colour values, `rgb()`, `hsl()`, or named colour keywords (except `transparent` and `inherit`) SHALL appear in any style rule. Required variables include at minimum: `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-input-background`, `--vscode-input-border`, `--vscode-button-background`, `--vscode-button-foreground`, `--vscode-list-activeSelectionBackground`, `--vscode-font-family`, `--vscode-font-size`.

#### Scenario: No hardcoded colours in CSS
- **WHEN** `media/panel.css` is searched for hex colour patterns (`#[0-9a-fA-F]{3,6}`) and `rgb(`
- **THEN** no matches are found

#### Scenario: Panel renders correctly in VS Code dark theme
- **WHEN** VS Code is set to a dark theme and the panel is opened
- **THEN** the panel background and text colours match the editor's theme colours

### Requirement: Content Security Policy compliance
All `<script>` and `<style>` tags in `panel.html` SHALL carry the per-request CSP nonce injected by the host. No inline event handlers (`onclick`, `onchange`, etc.) SHALL be used — all event listeners SHALL be attached via `addEventListener` in `panel.js`. External URLs SHALL NOT appear in any `src` or `href` attribute.

`panel.html` MUST use the following exact placeholder strings for host injection — any other syntax will silently break CSP and asset loading:
- `{{nonce}}` — replaced with the per-request cryptographic nonce
- `{{cspSource}}` — replaced with `webview.cspSource` (the allowed resource origin)
- `{{cssUri}}` — replaced with the webview-safe URI for `panel.css`
- `{{scriptUri}}` — replaced with the webview-safe URI for `panel.js`

#### Scenario: Script tag carries nonce
- **WHEN** the rendered HTML of the webview is inspected
- **THEN** the `<script src="panel.js">` tag has a `nonce` attribute matching the CSP header's nonce value

#### Scenario: No inline event handlers
- **WHEN** `media/panel.html` is searched for `on[a-z]+=` attribute patterns
- **THEN** no matches are found
