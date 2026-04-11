## ADDED Requirements

### Requirement: Non-sensitive preset fields stored in VS Code settings
The fields `name`, `host`, `port`, `username`, `remoteDir`, `authType`, and `keyPath` for each preset SHALL be stored in `vscode.workspace.getConfiguration('sftpUpload').presets` as an array of objects. These fields roam with VS Code Settings Sync. `port` SHALL default to `22` if not specified.

#### Scenario: Preset non-sensitive fields appear in settings.json after save
- **WHEN** the user saves a new preset with name "DEV - AcmeCorp" via the manage panel
- **THEN** `settings.json` contains an entry in `sftpUpload.presets` with `name`, `host`, `port`, `username`, `remoteDir`, `authType`, and `keyPath` fields — and no `password` or `passphrase` field

#### Scenario: Default port applied when not specified
- **WHEN** a preset is saved without specifying a port
- **THEN** the stored preset object has `port: 22`

### Requirement: Credentials stored exclusively in SecretStorage
Passwords and SSH key passphrases SHALL be stored in `context.secrets` (VS Code SecretStorage), keyed as `sftpUpload.preset.<name>.password` and `sftpUpload.preset.<name>.passphrase` respectively. These values MUST NOT appear in `settings.json`, `globalState`, or any log output.

#### Scenario: Password not present in settings.json after save
- **WHEN** a password-authenticated preset is saved
- **THEN** `settings.json` contains no `password` field for that preset

#### Scenario: Password retrievable from SecretStorage
- **WHEN** `presetManager.getPassword('DEV - AcmeCorp')` is called after a preset with that name was saved
- **THEN** the correct plaintext password is returned

#### Scenario: Passphrase stored under correct key
- **WHEN** a key-authenticated preset with a passphrase is saved
- **THEN** `context.secrets.get('sftpUpload.preset.DEV - AcmeCorp.passphrase')` returns the passphrase

### Requirement: Full CRUD on presets
`presetManager` SHALL expose operations to add, update, and delete presets. Deleting a preset MUST also delete its corresponding SecretStorage entries.

#### Scenario: Add new preset
- **WHEN** `presetManager.save(preset, isNew: true)` is called with a unique name
- **THEN** the preset appears in `sftpUpload.presets` in settings and any credentials are stored in SecretStorage

#### Scenario: Update existing preset
- **WHEN** `presetManager.save(preset, isNew: false)` is called with an existing preset name
- **THEN** the settings entry is updated and SecretStorage credentials are updated if provided

#### Scenario: Delete preset removes credentials
- **WHEN** `presetManager.delete('DEV - AcmeCorp')` is called
- **THEN** the preset is removed from settings AND `context.secrets.get('sftpUpload.preset.DEV - AcmeCorp.password')` returns `undefined`

### Requirement: FileZilla XML import
`fileZillaImporter` SHALL parse a FileZilla site manager XML export and return an array of `PresetWithCredentials` objects. It MUST filter to `<Protocol>1</Protocol>` entries (SFTP only) and skip FTP, FTPS, and other protocols. Base64-encoded passwords in `<Pass encoding="base64">` SHALL be decoded to plaintext before being passed to `presetManager`.

#### Scenario: SFTP sites imported, FTP sites skipped
- **WHEN** a FileZilla XML export containing 2 SFTP sites and 1 FTP site is imported
- **THEN** `fileZillaImporter.parse(xml)` returns an array of 2 preset objects, not 3

#### Scenario: Base64 password decoded on import
- **WHEN** a FileZilla XML entry contains `<Pass encoding="base64">dGVzdHBhc3M=</Pass>`
- **THEN** the returned preset object has `password: 'testpass'`

#### Scenario: Import result passed to presetManager
- **WHEN** the user confirms the FileZilla import flow
- **THEN** each parsed preset is saved via `presetManager.save()` and the host posts `{ command: 'importDone', imported: N, presets: [...] }` to the webview

### Requirement: pinFolder updates remoteDir in settings
`presetManager` SHALL expose a `pinFolder(presetName, path)` method that updates only the `remoteDir` field of the named preset in settings, without requiring the full preset object or credentials.

#### Scenario: Pin folder updates remoteDir only
- **WHEN** `presetManager.pinFolder('DEV - AcmeCorp', '/intake/acme/uat')` is called
- **THEN** the preset's `remoteDir` in settings is updated to `/intake/acme/uat` and no other field is changed
