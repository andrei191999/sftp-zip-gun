## ADDED Requirements

### Requirement: Shared discriminated-union types file
A single TypeScript file at `src/types/messages.ts` SHALL export every message type and shared data shape used by the webview↔host boundary. No other file in the extension SHALL define message shapes inline.

Exported types:
- `UploadMode` — `'zip' | 'separate'`
- `PresetMeta` — non-sensitive preset fields (name, host, port, username, remoteDir, authType, keyPath)
- `PresetWithCredentials` — extends `PresetMeta` with optional `password` and `passphrase` fields; used only in the `savePreset` webview→host direction
- `FileEntry` — `{ name: string; sizeBytes: number; isAnchor: boolean }`
- `RemoteEntry` — `{ name: string; type: 'directory' | 'file'; path: string }`
- `HistoryEntry` — `{ timestamp: string; preset: string; mode: UploadMode; files: string[]; result: 'success' | 'error'; error?: string }`
- `UiState` — `{ lastFolder?: string; lastPreset?: string; mode?: UploadMode }`
- `WebviewMessage` — discriminated union of all webview→host message shapes, keyed on `command`
- `HostMessage` — discriminated union of all host→webview message shapes, keyed on `command`

#### Scenario: Types file compiles without error
- **WHEN** `tsc --noEmit` is run on the project
- **THEN** `src/types/messages.ts` produces zero TypeScript errors

#### Scenario: No inline message shapes in other files
- **WHEN** the source tree is searched for `interface.*Message` or `type.*Message` outside `src/types/messages.ts`
- **THEN** no matches are found — all message shapes are imported from `src/types/messages.ts`

### Requirement: WebviewMessage covers all webview→host commands
`WebviewMessage` SHALL be a discriminated union where every member has a `command` string literal field. The union MUST include exactly these commands: `listFiles`, `upload`, `cancelUpload`, `testConnection`, `getPresets`, `savePreset`, `deletePreset`, `importFileZilla`, `getHistory`, `getState`, `setState`, `browseRemote`, `pinFolder`, `closeBrowser`.

#### Scenario: Missing command caught at compile time
- **WHEN** a handler in `SftpPanel.ts` references a `command` value not present in `WebviewMessage`
- **THEN** TypeScript reports a type error before compilation completes

#### Scenario: Exhaustive switch over WebviewMessage
- **WHEN** a `switch (msg.command)` in `SftpPanel.ts` covers all `WebviewMessage` variants
- **THEN** TypeScript's exhaustiveness check produces no error for the `default` case being unreachable

### Requirement: HostMessage contains no credential fields
No member of the `HostMessage` union SHALL include a `password`, `passphrase`, or any other credential field. `PresetMeta` (used in `HostMessage`) explicitly omits these fields; `PresetWithCredentials` MUST NOT appear in any `HostMessage` member.

#### Scenario: Credential fields absent from HostMessage union
- **WHEN** `HostMessage` is inspected via TypeScript's type system
- **THEN** no member of the union has a `password` or `passphrase` property

#### Scenario: presets host→webview message uses PresetMeta not PresetWithCredentials
- **WHEN** the `{ command: 'presets' }` HostMessage member is examined
- **THEN** its `presets` field is typed as `PresetMeta[]`, not `PresetWithCredentials[]`

### Requirement: closeBrowser terminates the browser SFTP session
The `closeBrowser` WebviewMessage SHALL signal the host to disconnect the persistent browser SFTP session (see `panel-host` spec). The webview SHALL post `closeBrowser` when the remote browser overlay is closed by any means: pinning a folder, clicking Cancel/back, or the panel being hidden. The host MUST NOT reuse the browser session after receiving `closeBrowser` — the next `browseRemote` message starts a fresh connection.

#### Scenario: closeBrowser disconnects browser session
- **WHEN** the webview posts `{ command: 'closeBrowser' }`
- **THEN** the host disconnects the browser SFTP client and sets the browser session reference to `undefined`

### Requirement: browseRemote root convention
The `browseRemote` WebviewMessage SHALL accept `path: ''` (empty string) to signal "navigate to the SFTP root". The host MUST interpret an empty `path` as a request to list the server's root directory.

#### Scenario: Empty path triggers root listing
- **WHEN** the webview posts `{ command: 'browseRemote', preset: 'DEV', path: '' }`
- **THEN** the host connects and lists the SFTP root directory, posting `{ command: 'remoteListed', path: '/', entries: [...] }`
