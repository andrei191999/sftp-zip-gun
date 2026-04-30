# SFTP Zip Gun Marketplace Listing Source

Audience: VS Code Marketplace listing copy and future `package.json` metadata refinement.

## Title

SFTP Zip Gun

## Listing Summary

SFTP Zip Gun keeps SFTP uploads inside VS Code instead of pushing you out to a separate client. Save secure connection presets, pick the upload style that matches the job, browse and bookmark remote paths, import existing FileZilla sites, and review upload history from one panel.

This extension targets developers who need to ship files quickly without turning VS Code into a full deployment platform. It is focused on manual, developer-driven uploads over SFTP with explicit control over what gets sent and where it lands.

## Long Description

SFTP Zip Gun is a developer-first SFTP upload extension for VS Code. It is built for the common case where you already know which files need to move and you want to send them from the editor with less friction, better repeatability, and fewer context switches.

### Why use it

- Stay inside VS Code for preset management, upload execution, remote path selection, and upload history.
- Choose the upload mode that fits the task instead of forcing every transfer into the same flow.
- Reuse named presets with password or SSH key authentication.
- Keep common remote destinations close at hand with pinned defaults and saved remote paths.
- Import existing FileZilla server definitions instead of rebuilding them manually.

### Core workflows

- Open the upload panel to manage presets, choose files, browse remote destinations, and run uploads from the webview UI.
- Use Quick Upload when you already have presets configured and want a faster file-to-server path from the editor or Explorer.
- Browse the remote server before sending files, then pin that destination as the preset default if it should become the new normal target.
- Bookmark remote paths for repeat uploads to multiple known destinations.
- Review upload history after the fact instead of guessing what was sent.

### Upload modes in plain language

- ZIP Canon: bundle the current selection into one timestamped ZIP archive and upload that single archive.
- Pistol File: upload each selected file directly, one by one, without zipping them first.
- ZIP Gun: split files into groups, build one ZIP per group, and upload those archives in sequence.

These names are distinctive in-product labels, but the underlying value is straightforward: one archive, direct file upload, or multiple grouped archives.

### Commands and entry points

Commands currently contributed by the extension:

- `SFTP Zip Gun: Open Upload Panel`
- `SFTP Zip Gun: Quick Upload`
- `SFTP Zip Gun: Import Presets from FileZilla...`

Current entry points in VS Code:

- Command Palette
- Explorer context menu
- Editor context menu
- Editor title area
- Keyboard shortcut for opening the panel: `Ctrl+Shift+U` on Windows/Linux, `Cmd+Shift+U` on macOS

`Quick Upload` is conditionally surfaced when presets already exist. The panel remains the main entry point for the broader workflow.

### Security story

Preset metadata is split between non-sensitive configuration and secrets:

- Non-sensitive preset fields such as host, port, username, remote directory, auth type, read-only flag, and saved remote paths are stored in VS Code settings.
- Passwords and SSH passphrases are stored through VS Code SecretStorage, which uses the OS keychain/credential store.
- For key-based authentication, the extension reads the SSH private key from the configured absolute file path at connection time.

The host and webview contract is structured so secrets do not need to be echoed back into normal UI state. That is the right story to tell in the listing: secure preset handling with VS Code SecretStorage, not custom crypto claims.

### FileZilla import

If your team already has FileZilla site-manager exports, SFTP Zip Gun can import presets from FileZilla instead of requiring manual re-entry. This lowers adoption friction for existing SFTP workflows and makes the extension easier to trial on real servers.

### Read-only and drop-box server behavior

Some intake servers accept uploads but reject management commands such as `stat`, `delete`, or `mkdir`. SFTP Zip Gun includes a `readOnly` preset flag specifically for these drop-box style servers.

When enabled, the preset is treated as upload-only and avoids those management operations. This is important to call out in the listing because it is a practical compatibility feature, not marketing garnish.

### Minimum VS Code version

The current manifest requires VS Code `^1.74.0`.

## Suggested Screenshots

Use screenshots that match the actual shipped UI and focus on decision points a Marketplace visitor will care about:

1. Main upload panel with a preset selected, local file list visible, and remote destination area in view.
2. Upload mode selector showing ZIP Canon, Pistol File, and ZIP Gun side by side.
3. Preset management view showing password vs key auth fields and the read-only/drop-box option.
4. Remote path browsing or saved path/bookmark workflow.
5. Upload progress plus upload history after a successful run.
6. FileZilla import flow or imported preset list if the UI makes that visible cleanly.

Recommended caption themes:

- "Upload to SFTP without leaving VS Code"
- "Choose direct upload, one ZIP, or grouped ZIP batches"
- "Save secure presets with password or SSH key auth"
- "Support drop-box servers that reject management commands"
- "Import existing FileZilla sites and start faster"

## Suggested Metadata Improvements

These are recommendations only. They are intentionally limited to what the extension already does today.

### Description

Current manifest description:

`Developer-first SFTP uploads for VS Code with ZIP Canon, Pistol File, ZIP Gun, remote path bookmarks, and upload history.`

Recommended replacement:

`Upload files to SFTP from VS Code with saved presets, Quick Upload, zip-or-direct transfer modes, remote path bookmarks, FileZilla import, and upload history.`

Why this is better:

- Leads with the outcome: upload files to SFTP from VS Code.
- Keeps one branded term set but explains the practical behavior in plain language.
- Adds Quick Upload and FileZilla import, which are real differentiators.
- Avoids sounding like the visitor already knows what "ZIP Gun" means.

### Keywords

Current keywords:

- `sftp`
- `upload`
- `ftp`
- `ssh`
- `file transfer`

Recommended keyword set:

- `sftp`
- `sftp upload`
- `ssh`
- `ssh key`
- `filezilla`
- `filezilla import`
- `zip upload`
- `quick upload`
- `remote path`
- `upload history`

Notes:

- Remove `ftp` unless real FTP support is added. The extension is SFTP-focused, and broad protocol keywords can attract the wrong audience.
- Prefer concrete workflow keywords over generic terms where possible.

### Categories

Recommended category approach:

- Keep `Other` for now.

Reasoning:

- The current VS Code Marketplace taxonomy does not have a clean, obviously better category for a focused SFTP workflow tool.
- Adding unrelated categories for reach would reduce listing accuracy.

### Optional homepage and bugs metadata

Recommended additions to `package.json` later:

- `homepage`: point to the repository README or a dedicated documentation page once the Marketplace copy and screenshots are stable.
- `bugs`: point to the GitHub issues URL for the repository.

Suggested targets:

- Homepage: `https://github.com/andrei191999/sftp-zip-gun`
- Bugs: `https://github.com/andrei191999/sftp-zip-gun/issues`

## Notes for Future Listing Updates

- Keep Marketplace copy aligned with the manifest and the shipped command surface. If command titles change, update this document first and then refine metadata.
- If the README stays broad and implementation-oriented, keep this page sharper and more conversion-focused, but do not claim automation, sync, deployment orchestration, or protocol support that does not exist.
- Refresh screenshots whenever the panel layout, preset form, or upload mode presentation changes.
- Revisit the short description if branded mode names become more or less prominent in the UI.
- Keep the security section disciplined: SecretStorage, OS keychain-backed secrets, and key-file path usage are accurate; broader security claims are not needed.
- If Marketplace assets are upgraded later, verify that the listing icon, screenshot set, and summary text still feel consistent with the current brand and command names.
