---
name: vs-code-ext-creator
description: Use when creating, scaffolding, or extending a VS Code extension, especially AndreiMacovei desktop extensions with webviews, packaged smoke checks, and Playwright-backed verification
---

# VS Code Extension Creator

Use this skill for TypeScript-first VS Code desktop extensions, especially repos intended for the `AndreiMacovei` publisher.

## Defaults

- Prefer TypeScript, desktop-first behavior, and narrow `activationEvents`.
- Use `publisher: "AndreiMacovei"` only in `package.json`; command IDs and config keys need an extension-specific namespace.
- Use esbuild for the host bundle and keep `tsc --noEmit` for type-checking.
- Store secrets in `ExtensionContext.secrets`. Never put passwords, tokens, or passphrases in settings, `globalState`, workspace files, or host→webview messages.
- Favor native VS Code UX: commands, context menus, status bar items, diagnostics, and webviews only when justified.

## Project Shape

- Host code belongs under `src/**`.
- Webview source belongs under `src/webview/panel/**` and `src/webview/panel-styles/**`.
- `npm run build:webview` generates `media/panel.js` and `media/panel.css`.
- Keep generated assets and source clearly separated; edit `src/webview/**`, not `media/panel.js`.

## Webview And Security Rules

- Generate a fresh CSP nonce per panel creation.
- Use `webview.asWebviewUri(...)` for local assets.
- Call `acquireVsCodeApi()` exactly once.
- Do not use inline handlers.
- Do not send secrets from host to webview.
- Keep placeholders generic; do not ship personal local-path examples in UI or fixtures.

## Verification Stack

1. `npm run typecheck`
2. `npm run test:unit`
3. `npm run compile`
4. `npm run qa:vsix:contents`
5. `npm run package`
6. `npm run qa:docker:start`
7. `npm run qa:smoke:dev`
8. `npm run qa:smoke:vsix`
9. Focused Playwright first, then broader `npm run test:e2e:headless` or `npm run test:e2e:headed` only when needed

## Testing Lessons From This Repo

- Run the smallest reproducer first. Use spec paths plus `--grep` before broad matrix reruns.
- All Playwright commands should use the repo wrapper `scripts/playwright/run-with-cleanup.mjs`.
- Cleanup must be targeted to repo-specific Extension Development Hosts before and after runs. Do not broad-kill unrelated VS Code windows.
- Headed panel open flow is more reliable through status bar or command palette fallback than through the keybinding alone.
- Headed reopen flows should close the SFTP editor tab deterministically and verify the old webview disappeared before reopening.
- Use isolated `user-data-dir` and `extensions-dir` for smoke and packaged VSIX checks to avoid local extension/sign-in noise.

## Packaging Rules

- Keep `ssh2-sftp-client` external in the bundle and present in the VSIX at runtime.
- Use `.vscodeignore` plus `scripts/qa/assert-vsix-contents.js` as release gates.
- Internal AI docs, trackers, scripts, sources, and local artifacts may live in git, but they must not ship in the VSIX.
- Validate packaged behavior with `npm run qa:smoke:vsix`, not just `vsce package`.

## Extension-Specific Behavior To Respect

- Route preset-backed connections through centralized credential resolution helpers.
- Treat `readOnly` presets as upload-only/drop-box targets and avoid management operations in those flows.
- Publish only from a clean, validated branch tip after the package and smoke checks pass.
