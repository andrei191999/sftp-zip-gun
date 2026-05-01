# Changelog

All notable changes to this project will be documented in this file.

Note: entries before `0.2.1` were reconstructed from repository history, shipped VSIX artifacts in the repo root, package metadata, maintainer notes, and current code/spec evidence where commit history was incomplete. Dates and scope for those early releases should be read as best-effort release history unless a date is explicitly confirmed below.

## [0.2.3] - 2026-04-30

This release is a public-surface cleanup of `0.2.2`. It keeps the same extension feature set while stripping internal repo artifacts and unnecessary dependency clutter from the published package.

### Changed
- Removed internal planning, agent, and verification artifacts from the public repository surface.
- Sanitized public docs and test fixtures so the repo no longer points at internal maintenance material or local-machine-shaped sample paths.
- Tightened `.vscodeignore` and the VSIX audit gate to exclude dependency test/example/CI/docs clutter from the shipped extension package.

### Fixed
- Stopped shipping third-party dependency test and example files in the published VSIX.
- Removed internal-doc references from the packaged README.
- Normalized sample key-path and local-path fixtures to clearly synthetic placeholders.

## [0.2.2] - 2026-04-30

This release turns the post-`0.2.1` stabilization work into a cleaner publishable line with stronger upload reliability, better restricted-server handling, and a stricter packaged-release gate.

### Added
- An owned-content VSIX verification gate plus isolated development-host and installed-VSIX smoke validation before publish.
- Targeted Quick Upload, read-only drop-box, and settings-defined preset coverage around the most common daily upload paths.

### Changed
- Tightened `.vscodeignore` and release packaging so internal planning, agent, and test-output files stay out of the shipped VSIX.
- Hardened Playwright/QA helpers around panel reopen, preset-form opening, cleanup, and drop-box fixture startup so release verification better matches real extension behavior.

### Fixed
- Prevented stale remote-browse responses from resurrecting a cancelled overlay after the user had already closed or changed the browse session.
- Increased the explicit SFTP connection `readyTimeout` to better tolerate slower server handshakes without failing early.
- Preserved read-only/drop-box upload behavior for restricted servers by avoiding remote-management cleanup paths those servers reject.
- Improved Quick Upload resilience around last-preset reuse, cancellation, and packaged-build smoke coverage.

## [0.2.1] - 2026-04-22

This is the current published release line and the point where the broader `0.2.x` work was consolidated into a cleaner package/update story.

### Changed
- Reframed the `0.2.x` line as a published `0.2.1` release in package metadata and shipped artifacts.
- Kept ZIP timestamp naming in the panel flow instead of inside the low-level ZIP builder, which better matches the current message contract and upload flow.
- Continued the post-`0.2.0` architecture cleanup and packaging pass reflected in the release metadata update.
- Tightened the release-facing docs and metadata around the renamed `SFTP Zip Gun` identity.

### Fixed
- Sanitized user-facing connection and upload errors so sensitive local path details do not leak into the webview.
- Tightened SecretStorage rename and delete handling for preset credentials.
- Normalized older preset metadata that predated newer fields such as `readOnly` and saved remote paths.
- Addressed follow-up correctness, cleanup, and regression issues in the `0.2.0` feature line, including message-contract and post-refactor fixes.
- Smoothed out post-refactor rough edges in the panel/upload flow so the shipped `0.2.x` experience matched the newer modular architecture more closely.

## [0.2.0] - Reconstructed from April 2026 history

This entry reconstructs the feature set that formed the `0.2.0` line before `0.2.1`. The defining change was the addition of the third upload mode plus a broad refactor of the file-table, file-control, history/log, and backend orchestration layers.

### Added
- ZIP Gun grouping mode with group assignment, auto-detection by filename stem, per-group anchor selection, and multiple output naming strategies.
- A unified file table that brought recent, open, and local files into one panel with collapsible sections.
- Hover-pin anchor selection and related anchor UX improvements for choosing the file that drives bundle naming.
- One-time migration from legacy `sftpUpload.presets` settings to the current `sftpZipGun.presets` namespace.
- More explicit grouping-aware status handling so grouped uploads could surface per-group progress and outcomes instead of behaving like a thin wrapper around the older ZIP flow.

### Changed
- Renamed and cleaned up the panel upload modes into the current `zip_canon`, `pistol_file`, and `zip_gun` model.
- Refactored the file table and related file controls so selection, grouping, anchors, and source sections could be handled in a more coherent UI model.
- Reworked log and history presentation so upload feedback felt more like a first-class panel feature instead of a side output.
- Streamlined backend upload orchestration and message flow toward the more modular `SftpPanel` / upload-session / runner split reflected in the current codebase.
- Polished the webview interaction model with clearer button states, grouping controls, tooltips, and layout cleanup.
- Continued the transition from the earlier `SFTP Upload` naming toward the `SFTP Zip Gun` product identity already reflected in current package metadata and artifacts.

### Fixed
- Shipped a first broad pass of `0.2.0` bug fixes covering selection counts, anchor behavior, file controls, button state handling, and related panel regressions.
- Applied a later code-review pass focused on performance, correctness, and cleanup before the release line rolled into `0.2.1`.
- Reduced the coupling between UI behavior and backend transfer logic enough to make follow-up fixes more targeted instead of panel-wide.

## [0.1.1] - 2026-04-14

Date confirmed by maintainer. Scope is still partly reconstructed, but this appears to have been the first published line after `0.1.0`, focused on polishing the initial UI and fixing early post-release issues rather than expanding the feature set significantly.

### Changed
- Corrected the extension publisher in `package.json` to `AndreiMacovei`, which likely required the publish/update flow used for the first public release line.
- Smoothed out the first-generation panel experience after the initial `0.1.0` release.

### Fixed
- Ironed out early UI rough edges and follow-up bugs in the initial upload and preset-management experience.
- Stabilized the first release line before the larger `0.2.0` feature and refactor wave.

## [0.1.0] - Reconstructed initial release

This entry is based on the initial release commit, the original proposal/spec material, and shipped `0.1.0` VSIX artifacts present in the repository root.

### Added
- Initial VS Code extension release for SFTP uploads with a dedicated webview panel and typed host/webview message contract.
- Preset management backed by VS Code settings plus SecretStorage for passwords and SSH key passphrases.
- ZIP upload flow and separate-file upload flow, including quick upload from the active XML file.
- FileZilla site-manager import support for bringing existing SFTP presets into the extension.
- Upload history persistence, status-bar integration, and packaged release assets including README, license, icon, and VSIX output.
- Unit test coverage for `fileZillaImporter`, `stateManager`, and `zipBuilder`.

### Changed
- Renamed the extension from the earlier `sftp-upload` identity to `sftp-zip-gun` during release preparation; both naming traces still appear in repository artifacts.

### Fixed
- Included early UX and reliability fixes called out in the release merge summary, including cancel/abort behavior and partial-upload cleanup.
