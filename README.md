# SFTP Zip Gun

Developer-first SFTP uploads inside VS Code.

SFTP Zip Gun keeps the whole workflow in the editor: manage connection presets, switch between three upload modes, browse remote destinations, bookmark paths, and review upload history without leaving the panel.

## What It Ships

- Three upload modes:
  - `ZIP Canon` bundles the current selection into one timestamped archive.
  - `Pistol File` uploads each selected file directly, one by one.
  - `ZIP Gun` lets you build file groups, generate one archive per group, and upload them in sequence.
- Local workflow controls:
  - pick a local folder
  - pull in currently open editor files
  - pin anchor files for naming
  - build and clear ZIP Gun groups
- Remote workflow controls:
  - set a preset default path
  - browse the remote server before sending files
  - bookmark frequently used remote paths
  - pin a browsed path as the new default
- Preset management:
  - password and SSH key authentication
  - connection testing from the Manage tab
  - FileZilla import
  - drop-box/read-only server mode
- Upload feedback:
  - live progress
  - per-row and per-group status icons
  - filtered logs
  - upload history

## Requirements

- VS Code `1.74+`
- Access to an SFTP server

## Getting Started

1. Open any local file in VS Code.
2. Run `SFTP Zip Gun: Open Upload Panel`.
3. Open the `Manage` tab and add an account preset.
4. Test the connection before uploading.
5. Return to `Upload`, choose a local folder, select a destination path, then fire.

## Upload Modes

### ZIP Canon

Use this when a server expects one archive per transfer. The panel builds a timestamped ZIP from the current selection and uploads that archive.

### Pistol File

Use this when the server should receive the original files unchanged. This mode skips archiving and uploads each selected file directly.

### ZIP Gun

Use this when one batch needs multiple archives. Assign files into groups, choose the naming strategy, pin per-group anchors, and upload each group archive in sequence.

## Paths, Bookmarks, and Defaults

Each preset has a default remote directory. That default is used automatically unless you choose a different send-to path for the current upload.

You can also:

- browse the remote server from the panel
- bookmark remote paths for reuse
- pin a browsed path as the preset's new default
- send to a one-off path without changing the preset

## Presets and Authentication

Presets store non-sensitive connection metadata in VS Code settings under `sftpZipGun.presets`.

- Passwords are stored in the OS keychain through VS Code `SecretStorage`.
- SSH key passphrases are also stored in `SecretStorage`.
- Sensitive values are never written back to `settings.json` or sent to the webview.

## FileZilla Import

Use `Import from FileZilla…` in the Manage tab to bring over SFTP sites from a FileZilla Site Manager XML export.

## Commands

| Command | Title | Shortcut |
| --- | --- | --- |
| `sftpZipGun.openPanel` | SFTP Zip Gun: Open Upload Panel | `Ctrl+Shift+U` / `Cmd+Shift+U` |
| `sftpZipGun.quickUpload` | SFTP Zip Gun: Quick Upload | Context menus |
| `sftpZipGun.importFileZilla` | SFTP Zip Gun: Import Presets from FileZilla… | None |

The main panel command is available from the editor title bar plus Explorer and editor context menus for local files.

Quick Upload appears in context menus once at least one preset is saved.
