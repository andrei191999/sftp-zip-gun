# SFTP Zip Gun

SFTP Zip Gun keeps SFTP uploads inside VS Code. It is built for the common "ship these files to that server now" workflow: pick files, choose a saved connection, choose how to send them, and upload without leaving the editor.

It does not try to be a full sync client or remote file manager. The current scope is focused upload tooling: direct file upload, ZIP-based upload, grouped ZIP upload, remote destination selection, bookmarked remote paths, FileZilla preset import, and upload history.

## What's New In 0.2.2

- More reliable `Quick Upload` handling around last-used presets, cancel flow, and packaged-extension smoke validation.
- Better support for upload-only / drop-box SFTP targets that reject remote management operations.
- Safer remote-browse and connection behavior for cancelled browse sessions and slower SFTP handshakes.
- Cleaner release packaging with stricter VSIX content checks before publish.

## Why It Exists

Many teams still have SFTP-based deployment, intake, or handoff steps, but the day-to-day workflow usually lives in VS Code. SFTP Zip Gun exists to remove the friction between "I finished editing" and "I need these exact files on that exact server path."

The extension is built around three upload styles:

1. Send everything as one archive.
2. Send each file as-is.
3. Split files into groups and send one archive per group.

Those are exposed in the UI with the extension's mode names:

- `ZIP Canon`: bundle the current selection into one timestamped ZIP, then upload that archive.
- `Pistol File`: upload each selected file directly with no ZIP step.
- `ZIP Gun`: create file groups, build one ZIP per group, and upload the groups in sequence.

## What It Does

- Manages named SFTP connection presets inside VS Code.
- Supports password auth and SSH private-key auth.
- Stores passwords and SSH key passphrases in VS Code `SecretStorage`, not in settings.
- Lets you browse remote directories before uploading.
- Lets you pin a browsed folder as the preset's default remote directory.
- Lets you save extra remote path bookmarks per preset.
- Supports upload-only "drop-box" presets for servers that reject management operations.
- Imports compatible FileZilla Site Manager entries.
- Keeps upload history and last-used state across sessions.
- Offers a one-shot `Quick Upload` command for the active file or a file selected in Explorer.

## Install And Requirements

### Requirements

- VS Code `1.74+`
- Access to an SFTP server
- For key-based auth, a readable local private key file path

### Install

Use whichever path matches how you distribute extensions in your environment:

1. Install the published extension if you have it from a marketplace or internal feed.
2. Install a `.vsix` package built from this repository.
3. Build locally:

```bash
npm install
npm run package
```

That produces a VSIX you can install in VS Code with `Extensions: Install from VSIX...`.

## Quick Start

1. Run `SFTP Zip Gun: Open Upload Panel` (`sftpZipGun.openPanel`).
2. Open the `Manage` view and create a preset.
3. Choose your auth type:
   - `password`
   - `key`
4. Set the preset's default remote directory.
5. Test the connection from the panel.
6. Go back to the upload view, choose files and a mode, then upload.

If you only need to send the current file, use `SFTP Zip Gun: Quick Upload` (`sftpZipGun.quickUpload`) from:

- the Command Palette
- the Explorer context menu
- the editor context menu

`Quick Upload` uses `Pistol File` behavior for a single file and remembers the last preset you used.

## Core Workflows

### 1. Send one ZIP

Use this when the server expects a single archive or when you want one upload artifact.

- Choose `ZIP Canon`.
- Select files from the current folder or open editors.
- Optionally set an anchor file or archive base name.
- Upload to the preset default path or another selected remote path.

Result: one timestamped ZIP file uploaded to the chosen remote directory.

### 2. Send files directly

Use this when the remote side expects the original filenames and no archive step.

- Choose `Pistol File`.
- Select one or more files.
- Upload directly.

Result: each file is uploaded separately, preserving its filename.

### 3. Send grouped ZIPs

Use this when you need multiple archives in one run, such as separate payloads per feature area, customer, or deployment lane.

- Choose `ZIP Gun`.
- Create groups.
- Assign files to groups.
- Choose naming behavior for each group run.
- Upload all groups in sequence.

Result: one ZIP per group, uploaded in order.

## Upload Modes In Detail

### `ZIP Canon`

- One ZIP per upload run
- Best for "package this batch and send it"
- Archive naming is based on the chosen anchor/base name plus a timestamp

### `Pistol File`

- No ZIP creation
- Best for single-file fixes or small batches where raw filenames matter
- This is also the behavior behind `Quick Upload`

### `ZIP Gun`

- Multiple ZIPs in one upload run
- Each group has its own file list and anchor
- Supports grouped naming strategies such as anchor-based or custom base naming

## Managing Connections

Presets are stored under the `sftpZipGun.presets` setting, but only non-sensitive fields live there:

- preset name
- host
- port
- username
- default remote directory
- auth type
- key path
- read-only flag
- saved remote path bookmarks

Sensitive values do not go into settings:

- Passwords are stored in VS Code `SecretStorage`.
- SSH key passphrases are stored in VS Code `SecretStorage`.
- Private keys themselves are not copied into settings or SecretStorage; the extension reads the key file from the `keyPath` you configure.

### Auth Types

#### Password

- Store host, port, username, and default remote directory in settings
- Store the password in `SecretStorage`

#### Private key

- Store host, port, username, default remote directory, and `keyPath` in settings
- Read the private key from disk when connecting
- Store the optional key passphrase in `SecretStorage`

### Read-only / drop-box presets

Enable the preset `readOnly` flag for upload-only intake servers that reject management operations.

In that mode, the preset is treated as a drop-box target. The extension avoids the normal `stat` / existence / delete / `mkdir` style behavior that can fail on restricted servers. Use this when the server allows uploads but does not allow broader directory management.

## Remote Paths And Bookmarks

Each preset has:

- one default remote directory: `remoteDir`
- zero or more saved remote path bookmarks: `savedPaths`

From the upload panel you can:

- upload to the preset default path
- browse the remote server before uploading
- choose a bookmarked path
- add a one-off path for the current send
- bookmark that path for later
- pin a browsed folder as the new preset default

This keeps "where should this go?" inside the same flow as "what should I upload?"

## FileZilla Import

The extension can import presets from FileZilla Site Manager XML.

Entry points:

- `SFTP Zip Gun: Import Presets from FileZilla…` (`sftpZipGun.importFileZilla`)
- the import action inside the panel's `Manage` view

Current import scope:

- nested Site Manager folder structures
- duplicate filtering
- root-level `<Servers>` parsing support

Imported presets become SFTP Zip Gun presets. Review imported paths and auth details before using them for uploads.

## Commands And UI Entry Points

### Commands

- `sftpZipGun.openPanel` — `SFTP Zip Gun: Open Upload Panel`
- `sftpZipGun.quickUpload` — `SFTP Zip Gun: Quick Upload`
- `sftpZipGun.importFileZilla` — `SFTP Zip Gun: Import Presets from FileZilla…`

### Where They Show Up

- Command Palette
- Explorer context menu
- editor context menu
- editor title area
- keyboard shortcut for the panel: `Ctrl+Shift+U` / `Cmd+Shift+U`

### Panel surface

The panel is the main workflow surface. It covers:

- upload mode selection
- local file selection from a folder
- open-file pickup from current editors
- preset selection
- remote destination selection
- connection testing
- preset add/edit/delete
- FileZilla import
- live upload progress
- upload history

## Security Model

The extension is intentionally split between:

- a VS Code extension host side with filesystem, secrets, and network access
- a sandboxed webview UI

Important security boundaries:

- Passwords and passphrases are sent from the webview to the host only when saving a preset.
- Those secrets are immediately written to VS Code `SecretStorage`.
- Secrets are never sent back to the webview in host-to-webview messages.
- The webview receives only sanitized preset metadata.
- User-facing connection and upload errors are sanitized so local key paths and similar local details are not leaked into the UI.

## Current Scope And Limitations

Current scope is upload-first. The extension does not currently claim to provide:

- download workflows
- folder synchronization
- remote editing
- bidirectional diffing
- continuous watch-and-upload deployment

Other current limits to keep in mind:

- `Quick Upload` is for a single selected file and uses direct upload, not ZIP creation.
- Remote-path convenience is preset-centric: one default path plus saved bookmarks per preset.
- The webview is the main interface for richer workflows; context-menu commands are intentionally narrower.

## Local Development

```bash
npm install
npm run compile
npm run watch
npm run typecheck
npm test
npm run test:integration
npm run package
```

### Build scripts

- `npm run compile` — build webview assets and bundle the extension
- `npm run watch` — watch mode for extension and webview changes
- `npm run typecheck` — TypeScript check only
- `npm run package` — create a VSIX with `vsce package`

## Local QA

The repository includes both automated checks and a Docker-backed SFTP smoke environment.

### Automated checks

- `npm test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run debug:prep`

`test:integration` runs the VS Code smoke flow script in `scripts/qa/run-vscode-smoke.js`.

### Docker QA harness

```bash
npm run qa:docker:start
npm run qa:docker:status
npm run qa:docker:stop
npm run qa:docker:purge
npm run qa:smoke:dev
npm run qa:smoke:vsix
```

The harness gives you a repeatable local SFTP target for smoke testing panel flows, quick upload, packaging, and VSIX install behavior.

### Manual verification

For real UI checks, run the extension in the VS Code Extension Development Host (`F5`) and verify:

- create, edit, rename, and delete presets
- password auth and key auth
- read-only/drop-box preset behavior
- remote browsing, default-path pinning, and bookmarks
- `ZIP Canon`, `Pistol File`, and `ZIP Gun`
- abort/cancel behavior
- upload history persistence

## Changelog And Internal Docs

- Release notes: [CHANGELOG.md](CHANGELOG.md)
- Internal maintenance docs: [docs/internal/README.md](docs/internal/README.md)
- Internal repo guidance: [AGENTS.md](AGENTS.md)
- Architecture graph snapshot: [graphify-out/GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md)
- OpenSpec change history for this feature set: [openspec/changes/sftp-upload-vscode-extension](openspec/changes/sftp-upload-vscode-extension)

## Repository

- Source: [github.com/andrei191999/sftp-zip-gun](https://github.com/andrei191999/sftp-zip-gun)
- License: [MIT](LICENSE)
