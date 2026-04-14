# SFTP Zip Gun

Upload files to SFTP servers without leaving VS Code. Manage server presets, browse remote directories, and track upload history — all from a dedicated panel.

## Features

- Manage multiple SFTP server presets (name, host, port, username, auth type, remote directory)
- Upload in **ZIP mode** (bundles selected files into a timestamped ZIP) or **separate-files mode**
- Import presets from **FileZilla Site Manager** exports
- Real-time progress log with category filters (upload, connection, import, accounts, system)
- Upload history (last 50 uploads)
- Remote folder browser — navigate and pin a remote directory per preset
- Test connection button per preset
- Cancel/abort upload in progress
- Status bar with upload state and quick-switch between presets

## Requirements

- VS Code 1.74 or later
- Access to an SFTP server

## Getting Started

1. Open any file in VS Code.
2. Right-click in the Explorer or editor → **SFTP Zip Gun: Open Upload Panel** (or press `Ctrl+Shift+U` / `Cmd+Shift+U` on Mac).
3. In the panel, click the **⚙ Manage** tab and add a preset (host, port, username, auth type, remote directory).
4. Return to the **Upload** tab, select your preset and files, then click **Upload**.

## FileZilla Import

1. In FileZilla: **File → Export → Export configuration** — saves an XML file.
2. In the extension: **Manage** tab → **Import from FileZilla…** → select the exported XML.

Imported sites with SFTP protocol are added as presets. Passwords are stored in the OS keychain.

## Authentication

- **Password** — enter your password in the Manage form; it is stored in the OS keychain via VS Code SecretStorage and never written to `settings.json`.
- **SSH private key** — enter the absolute path to your key file; an optional passphrase is also stored in the OS keychain.

## Settings

Presets (host, port, username, remote directory, auth type) are stored in VS Code global settings under `sftpZipGun.presets`. Passwords and SSH passphrases are stored exclusively in the OS keychain — they never appear in `settings.json`.

Use the **⚙ Manage** tab in the panel for a guided preset editor. You can also edit non-sensitive fields directly in `settings.json`.

## Commands

| Command | Title | Shortcut |
|---------|-------|----------|
| `sftpZipGun.openPanel` | SFTP Zip Gun: Open Upload Panel | `Ctrl+Shift+U` / `Cmd+Shift+U` |
| `sftpZipGun.quickUpload` | SFTP Zip Gun: Quick Upload | — (context menu, requires a preset) |
| `sftpZipGun.importFileZilla` | SFTP Zip Gun: Import Presets from FileZilla… | — |

The **Open Upload Panel** command is available from the editor title bar, and from Explorer and editor context menus for any file.
