# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-13

### Added
- Initial release
- Manage multiple named SFTP server presets with host, port, username, remote directory, and auth type
- Upload in ZIP mode (timestamped ZIP bundle) or separate-files mode
- Import presets from FileZilla Site Manager XML exports
- Real-time progress log with category filters (upload, connection, import, accounts, system)
- Upload history tracking with last 50 uploads persisted across sessions
- Remote folder browser — navigate the SFTP server and pin a remote directory per preset
- Test connection button per preset to verify credentials before uploading
- Cancel/abort support to interrupt an upload in progress
- Status bar item showing upload state and active preset, with animated spinner during upload
- Quick Upload command for one-click upload of the active file using the last-used preset
- Passwords and SSH passphrases stored exclusively in the OS keychain via VS Code SecretStorage
- Read-only preset flag for drop-box/intake servers that reject management commands
