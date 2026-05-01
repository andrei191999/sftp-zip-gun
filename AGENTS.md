# AGENTS.md

This file provides guidance to Codex when working in this repository.

## Build And Verification

```bash
# Build and type-check
npm run compile
npm run watch
npm run typecheck

# Automated verification
npm run test:unit
npm run qa:vsix:contents
npm run package
npm run qa:docker:start
npm run qa:smoke:dev
npm run qa:smoke:vsix

# Focused or broad Playwright runs
npm run test:e2e:cleanup:test
npm run test:e2e:headless
npm run test:e2e:headed
```

Use focused Playwright commands before broad reruns, for example:

```bash
npm run test:e2e:headed -- scripts/playwright/ui-state.spec.ts --grep "section collapse persists"
```

## Architecture

This is a VS Code extension with a host-side TypeScript runtime and a sandboxed webview UI.

### Host side (`src/`)

- `src/extension.ts` wires commands, status bar state, managers, and the panel host.
- `src/config/presetManager.ts` stores non-sensitive preset metadata in settings and all secrets in `ExtensionContext.secrets`.
- `src/config/stateManager.ts` persists panel state and capped upload history.
- `src/config/fileZillaImporter.ts` parses FileZilla exports.
- `src/sftp/sftpClient.ts` wraps `ssh2-sftp-client` and owns connection/upload behavior.
- `src/webview/SftpPanel.ts` owns the singleton panel lifecycle and host↔webview message routing.

### Webview side

- Source lives under `src/webview/panel/**` and `src/webview/panel-styles/**`.
- `npm run build:webview` generates `media/panel.js` and `media/panel.css`.
- `media/panel.html` is the shell populated by `src/webview/panelHtml.ts`.

### Message contract

- Host↔webview messages are typed in `src/types/messages.ts`.
- The webview sends only `{ kind: 'ready' }` on startup.
- The host responds with presets, persisted state, and history in one shot.
- Secrets must never appear in `HostToWebview` messages.

## Constraints And Guardrails

- Keep `ssh2-sftp-client` as a runtime dependency; it is intentionally not bundled into `dist/extension.js`.
- Use `resolveConnectOptions()` for all preset-backed connections so password, key, and passphrase resolution stays centralized.
- Treat `readOnly` presets as drop-box style servers: avoid `stat`/`exists`/`mkdir`/`delete` assumptions.
- Generate a fresh CSP nonce per panel and never add inline handlers to the webview.
- Call `persistState()` only from user-triggered changes, not from progress/render loops.
- Keep placeholders generic. Do not ship personal path examples in UI text or fixtures.

## QA Harness Notes

- All Playwright commands run through `scripts/playwright/run-with-cleanup.mjs`.
- The cleanup wrapper removes only orphaned repo-specific Extension Development Hosts before and after a run. Do not broad-kill unrelated VS Code windows.
- Headed panel open fallback order is: status bar, keybinding, then command palette.
- Headed panel reopen closes via editor-tab chrome first, then keyboard fallback, and verifies the previous webview disappeared before reopening.
- Packaged release validation is not just `vsce package`; always run `npm run qa:vsix:contents` and `npm run qa:smoke:vsix`.
