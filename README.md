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

## Local QA Harness

This repo includes a Docker-backed local QA fixture for repeatable smoke runs and manual panel testing on Windows + PowerShell.

### Commands

- `npm run qa:docker:start`
- `npm run qa:docker:status`
- `npm run qa:docker:stop`
- `npm run qa:docker:purge`
- `npm run qa:smoke:dev`
- `npm run qa:smoke:vsix`

### Fixture Root

The harness keeps its persistent state under `%TEMP%\sftp-zip-gun-qa`.

- Container name: `sftp-zip-gun-qa`
- Host endpoint: `127.0.0.1:2222`
- Private key: `%TEMP%\sftp-zip-gun-qa\keys\qa_ed25519`
- Uploaded files remain in `%TEMP%\sftp-zip-gun-qa\data\...` until you explicitly run `qa:docker:purge`

### Presets

Password preset:

- Name: `QA Password`
- Host: `127.0.0.1`
- Port: `2222`
- Username: `pwuser`
- Password: `pwpass`
- Default remote dir: `/upload`

Key preset:

- Name: `QA Key`
- Host: `127.0.0.1`
- Port: `2222`
- Username: `keyuser`
- Private key: `%TEMP%\sftp-zip-gun-qa\keys\qa_ed25519`
- Default remote dir: `/archive`

Both users expose `/upload`, `/archive`, `/branch-a`, and `/branch-b`. Each remote directory is bind-mounted to a separate host folder so uploads stay inspectable even after `qa:docker:stop`.

### Automated Smoke Scope

`qa:smoke:dev` compiles the extension and drives the real `sftpZipGun.quickUpload` command against the live Docker fixture.

`qa:smoke:vsix` packages the extension, installs the VSIX into isolated temp VS Code profile directories, then runs the same quick-upload smoke against the packaged payload.

The automated suite intentionally stays narrow:

- password-auth `quickUpload`
- key-auth `quickUpload`
- upload history assertions
- packaged VSIX package/install smoke

Full panel interaction remains manual. Use the Docker fixture to exercise add/edit/delete presets, remote browsing, bookmarks, default-path pinning, `ZIP Canon`, `Pistol File`, `ZIP Gun`, abort behavior, and history persistence.

## Getting Started

1. Open any local file in VS Code.