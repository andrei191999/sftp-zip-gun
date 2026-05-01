---
name: sftp-e2e
description: Use when verifying or debugging SFTP Zip Gun Playwright, Docker QA, or packaged smoke flows, especially headed/headless differences, panel open or reopen failures, and VS Code cleanup issues
---

# SFTP Zip Gun E2E

Use this skill for repo-local verification of uploads, presets, bookmarks, history, quick upload, and packaged install flows.

## Start Here

1. `npm run qa:docker:status`
2. If Docker is down: `npm run qa:docker:start`
3. `npm run compile`
4. For packaged flows: `npm run qa:vsix:contents` then `npm run package`

## Verification Ladder

- Fast sanity:
  - `npm run test:e2e:cleanup:test`
  - `npm run test:e2e:upload`
  - `npm run qa:smoke:dev`
  - `npm run qa:smoke:vsix`
- Focused Playwright:
  - `npm run test:e2e:headless -- <spec> --grep "<case>"`
  - `npm run test:e2e:headed -- <spec> --grep "<case>"`
- Broad reruns:
  - `npm run test:e2e:headless`
  - `npm run test:e2e:headed`
  - `npm run test:e2e:parallel:headed`

## Harness Facts

- All Playwright runs go through `scripts/playwright/run-with-cleanup.mjs`.
- That wrapper performs targeted cleanup before and after each run for this repo's Extension Development Hosts only. Do not broad-kill `Code.exe` unless a human explicitly approves it.
- Headed panel open order is status bar, then keybinding, then command palette. The keybinding alone is not reliable because it depends on `resourceScheme == file`.
- Headed panel reopen closes via editor-tab chrome first, falls back to `Ctrl/Cmd+W`, and verifies the previous webview disappeared before reopening.
- Fresh temp `--user-data-dir` and `--extensions-dir` are part of the harness. Account or sign-in popups are environment noise unless they block the panel.
- Headed multi-worker tiling uses the primary screen working area. If windows look oversized on a small screen, inspect `getScreenSize()` and `computeTile()` in `scripts/playwright/helpers/launch-vscode.ts`.
- Never assert against the drop-box `drop/` directory. Files may auto-delete after upload; assert in `store/` or another preserved path.

## Debugging Rules

- Start with the smallest reproducer, not the full matrix.
- If agent-run Playwright hits `spawn EPERM`, rerun outside the sandbox and classify it as environment noise.
- For panel-open or reopen failures, inspect headed diagnostics from `launch-vscode.ts` and `test-results/**/error-context.md` before changing code.
- Prefer durable assertions: wait for stable roles, values, or final state instead of racing display text.
- If a failure moves between adjacent persistence tests, treat it as sequence or timing sensitive until proven otherwise.

## Useful Commands

- `npm run test:e2e:state`
- `npm run test:e2e:bookmarks`
- `npm run test:e2e:conn`
- `npm run test:e2e:filezilla`
- `npm run test:e2e:cleanup:test`
