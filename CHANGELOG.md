# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-04-22

### Added
- ZIP Canon, Pistol File, and ZIP Gun upload flows with per-file or per-group progress tracking
- Quick Upload from the active editor or Explorer when presets are available
- Remote directory browsing, default-path pinning, saved-path bookmarks, and upload history persistence
- FileZilla import with nested-folder traversal, duplicate filtering, and root-level `<Servers>` parsing support
- Keychain-backed password and passphrase storage via VS Code SecretStorage
- Read-only preset mode for drop-box servers that reject `stat`, `mkdir`, or cleanup calls

### Changed
- Promoted the full unreleased `0.2.x` feature set into the `0.2.1` release line
- Kept ZIP timestamp naming in the panel flow instead of inside the low-level ZIP builder
- Reduced packaging overhead by shipping an optimized extension icon asset

### Fixed
- Sanitized user-facing connection and upload failures so local key paths and filesystem details stay out of the webview
- Normalized legacy preset metadata that predates `readOnly` and saved remote paths
- Tightened SecretStorage rename/delete handling and preserved history/state persistence behavior through tests