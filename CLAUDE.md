# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

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

Prefer focused Playwright commands before broad reruns, for example:

```bash
npm run test:e2e:headless -- scripts/playwright/bookmarks.spec.ts --grep "set bookmark as default"
```

## Architecture

This extension has two execution contexts that communicate through typed messages.

### Host side (`src/`)

- `src/extension.ts` registers commands, status bar state, and lifecycle wiring.
- `src/config/presetManager.ts` stores preset metadata in settings and secrets in `ExtensionContext.secrets`.
- `src/config/stateManager.ts` persists panel UI state and capped history.
- `src/sftp/sftpClient.ts` wraps `ssh2-sftp-client`.
- `src/webview/SftpPanel.ts` owns the panel singleton and host↔webview bridge.

### Webview side

- Webview source is in `src/webview/panel/**` and `src/webview/panel-styles/**`.
- `npm run build:webview` generates `media/panel.js` and `media/panel.css`.
- `media/panel.html` is the shell with nonce and resource placeholders.

### Message contract

- Message types live in `src/types/messages.ts`.
- Webview startup sends only `{ kind: 'ready' }`.
- Host startup response includes presets, persisted state, and history.
- Secrets must never be sent from host to webview.

## Constraints And Guardrails

- Keep `ssh2-sftp-client` external at bundle time and present at runtime.
- Route all preset-backed connect flows through `resolveConnectOptions()`.
- `readOnly` presets model upload-only/drop-box servers; do not assume management operations are available.
- CSP uses a fresh nonce per panel creation.
- Keep UI placeholders and fixtures generic; do not ship personal path examples.
- `persistState()` belongs on user-triggered state changes only, not render/progress loops.

## QA Harness Notes

- Playwright commands are wrapped by `scripts/playwright/run-with-cleanup.mjs`.
- Cleanup is targeted to orphaned repo-specific Extension Development Hosts before and after a run. Do not broad-kill unrelated VS Code windows.
- Headed panel open fallback order is status bar, then keybinding, then command palette.
- Headed panel reopen closes via tab chrome first and verifies the old webview disappeared before reopening.
- Release verification requires `npm run qa:vsix:contents` plus `npm run qa:smoke:vsix`, not just `npm run package`.
