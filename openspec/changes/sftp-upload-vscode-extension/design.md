## Context

A new VS Code extension (`sftp-upload`) is being built from scratch — there is no existing extension to extend or migrate. The extension lives at `vs-code-extensions/sftp-upload/` within a monorepo of utility scripts. No other files in the repo are touched.

The extension will be built by multiple parallel subagents working on independent leaf modules, then integrated by an orchestrating session. The message contract (`src/types/messages.ts`) is authored first to give all agents a shared interface before work begins.

Three review checkpoints are planned: after the parallel phase (interface alignment), after integration (panel wiring), and a final comprehensive review before publish (security, packaging, VS Code standards).

## Goals / Non-Goals

**Goals:**
- Right-click XML → upload panel in ≤2 clicks
- Named SFTP presets with credentials stored in OS-keychain-backed SecretStorage
- ZIP bundle mode and separate-files mode
- Remote SFTP folder browser with per-preset pinned destination
- Upload history (last 50 entries, persisted across restarts)
- FileZilla site manager XML import
- Animated status bar item + quick upload without opening the panel
- VS Code Marketplace publish (public extension)
- Works correctly in Remote SSH, WSL, and Dev Container environments

**Non-Goals:**
- Download from SFTP (upload only)
- Multi-server concurrent uploads
- FTP or FTPS support (SFTP only)
- Diff/sync workflows (no remote↔local comparison)
- Replacing the existing Python GUI tool — the extension handles the single-file/day-to-day path; the GUI handles bulk batch operations

## Decisions

### 1. Message contract as a shared TypeScript file (`src/types/messages.ts`)

**Decision:** All webview↔host message shapes are defined once in `src/types/messages.ts` as discriminated unions (`WebviewMessage`, `HostMessage`) and exported shared types (`PresetMeta`, `FileEntry`, `RemoteEntry`, `HistoryEntry`, `UiState`). No module defines message shapes inline.

**Why:** With three parallel agents building independent modules that all communicate through `SftpPanel.ts`, any inconsistency in message shape (e.g. `preset` vs `presetName`) becomes a runtime bug with no TypeScript error. A single contract file gives the TypeScript compiler full visibility across the boundary.

**Alternative considered:** Define message types inline in `SftpPanel.ts` and `panel.js`. Rejected — `panel.js` runs in the webview context where TypeScript is not available at runtime, so inline types would only exist on the host side, not the webview side, defeating the purpose.

---

### 2. No frontend framework in the webview (`panel.js` is vanilla JS)

**Decision:** The webview UI is built with plain HTML + CSS + vanilla JS. No React, Vue, or Lit.

**Why:** VS Code webviews require bundling any framework into the extension `.vsix`, adding to install size. The panel has three discrete views (upload, manage, remote browser) that swap via `display: none` — there is no complex reactive state that would justify a framework. The VS Code extension model already handles the "reactivity" through host→webview message pushes.

**Alternative considered:** React with esbuild. Rejected — adds ~40 KB to bundle and requires JSX transform configuration that complicates the build. The panel is not complex enough to need a component model.

---

### 3. `ssh2-sftp-client` over direct `ssh2`

**Decision:** Use `ssh2-sftp-client` (wraps `ssh2`) rather than using `ssh2` directly.

**Why:** `ssh2-sftp-client` provides a promise-based API with built-in connection retry, upload progress via `fastPut`, and SFTP-specific error messages. Using `ssh2` directly would require reimplementing SFTP session management. The existing Python tool also uses paramiko (same abstraction level), so parity is easier to verify.

**Alternative considered:** `node-ssh` — rejected, no fine-grained upload progress events.

---

### 4. `archiver` for ZIP creation over Node's built-in `zlib`

**Decision:** Use the `archiver` npm package to build ZIP archives.

**Why:** `archiver` provides a streaming archive API that supports adding multiple files by path without reading them all into memory first. Node's built-in `zlib` only provides deflate/gzip, not ZIP container format. The `jszip` alternative is synchronous and memory-bound — unsuitable for large PDF attachments.

**Alternative considered:** `jszip` — rejected, synchronous and loads all file contents into memory before writing.

---

### 5. `fast-xml-parser` for FileZilla XML import over `DOMParser`

**Decision:** Use `fast-xml-parser` to parse FileZilla's site manager XML.

**Why:** VS Code extension host code runs in Node.js, not a browser. `DOMParser` is not available in Node. `fast-xml-parser` is a zero-dependency, battle-tested XML parser that handles the FileZilla format reliably and is already used in the ecosystem for this purpose.

**Alternative considered:** Node's built-in `xml2js` — available but unmaintained; `fast-xml-parser` is actively maintained and has better TypeScript types.

---

### 6. `esbuild` for bundling over `webpack`

**Decision:** Use `esbuild` to bundle `src/` into `dist/extension.js`.

**Why:** `esbuild` is 10–100× faster than webpack, has a simple config (`--bundle --platform=node --external:vscode`), and is the current recommendation in VS Code extension templates. The extension has no unusual bundling requirements.

**Alternative considered:** `webpack` — used by older VS Code extension templates, significantly slower, more config. Rejected in favour of esbuild for build speed during development.

---

### 7. Single webview panel instance (reuse over recreate)

**Decision:** `SftpPanel.ts` enforces a single panel instance. If the panel is already open when `openPanel` is called, it reveals the existing panel rather than creating a new one.

**Why:** Multiple simultaneous panels would share the same SFTP connection pool and globalState, creating race conditions in upload history and progress events. Single-instance is simpler to reason about and matches user expectation (the panel is a persistent tool, not a modal).

**Alternative considered:** Allow multiple panels, one per file. Rejected — connection pool management complexity and history write conflicts are not worth the multi-file benefit, which can be achieved through the file list within one panel.

---

### 8. `vscode.workspace.fs` for local file listing

**Decision:** Directory listing for the local input folder uses `vscode.workspace.fs.readDirectory()` rather than Node's `fs.readdir()`.

**Why:** `vscode.workspace.fs` is VS Code's virtual file system API. It works transparently over Remote SSH, WSL, and Dev Container connections. Node's `fs` refers to the local filesystem of the process, which in a Remote SSH session is the remote machine — but `vscode.workspace.fs` follows the workspace's virtual filesystem. The ZIP creation step is an exception: `archiver` requires a real local writable path, which is always available since the ZIP is saved alongside the local XML.

---

### 9. Parallel build plan with orchestrated integration

**Decision:** The orchestrating session authors `src/types/messages.ts` first, then dispatches three parallel subagents for `preset-management`, `sftp-transport`, and `webview-ui`. The orchestrator then assembles `SftpPanel.ts` and `extension.ts` once all agents complete.

**Why:** The three leaf modules (`preset-management`, `sftp-transport`, `webview-ui`) have zero runtime dependencies on each other — they only meet inside `SftpPanel.ts`. Parallelising them reduces total build time. The message contract file, authored before dispatch, is the interface that guarantees they'll connect correctly.

**Review checkpoints:**
- **After parallel phase:** Subagent reviews that all module exports match the types defined in `messages.ts` and that no inline message shapes were introduced.
- **After integration phase:** Subagent reviews `SftpPanel.ts` message routing (every `WebviewMessage` handled, every `HostMessage` posted), disposable cleanup, and `retainContextWhenHidden` behaviour.
- **Final comprehensive review:** Subagent audits CSP nonce correctness, CSS for hardcoded hex values, SecretStorage usage (passwords never in settings), activation events (not `*`), all disposables in `context.subscriptions`, and a clean `vsce package` run.

---

### 10. Passwords excluded from the `presets` host→webview message

**Decision:** When the host posts a `presets` message to the webview, it sends `PresetMeta[]` — which contains no password or passphrase fields. Credentials are only accepted in the `savePreset` webview→host direction.

**Why:** The webview context is a sandboxed browser environment. Sending credentials into it would expose them to any JavaScript running in that context. VS Code's threat model treats webview JS as untrusted. Once a password is in SecretStorage, it is only ever read by the host process for the purpose of establishing an SFTP connection — never forwarded to the webview.

## Risks / Trade-offs

**ssh2 native bindings on some platforms** → `ssh2` may require native compilation on certain Node versions bundled with VS Code. Mitigation: pin to a version of `ssh2-sftp-client` known to work with pure-JS fallback; test on Windows (primary platform) and document Linux/Mac support status.

**FileZilla base64 password encoding** → FileZilla stores passwords as base64 (not encrypted) in the export XML. We decode and pass them directly to SecretStorage. Mitigation: import only on explicit user action; show a confirmation dialog listing the number of presets before importing; document in README that the source XML contains plaintext-equivalent credentials and should be deleted after import.

**Panel state loss on VS Code reload** → `retainContextWhenHidden` preserves state across tab switches but not across full VS Code window reloads. Mitigation: `getState`/`setState` messages persist the most important UI state (last folder, last preset, mode) to `globalState`, so the panel rehydrates correctly on reopen.

**Remote browser UX on slow connections** → browsing a remote SFTP directory with high latency may feel sluggish. Mitigation: show a spinner in the overlay immediately on `browseRemote`, and disable the breadcrumb links while loading. No pagination — if a directory has hundreds of entries, the full list is returned; this is acceptable for the intake server use case.

**`vsce package` fails if `publisher` not set** → Marketplace publishing requires a publisher ID that must be created in Azure DevOps before the first publish. Mitigation: document one-time setup steps in README; use a placeholder publisher ID during development that is replaced before the first `vsce publish`.

## Open Questions

- **Publisher ID**: Final publisher identifier for `package.json` — to be confirmed before first `vsce publish`. Development can proceed with a placeholder.
- **Icon**: A 128×128 `icon.png` is required for the marketplace listing. Source/design TBD — can be added as the last step before publish.
- **SSH key auth testing**: The SFTP accounts in use are password-authenticated. SSH key auth path (`authType: 'key'`) will be implemented per spec but may not be end-to-end tested against a real server in the initial release.
