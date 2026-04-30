---
name: sftp-e2e
description: >
  Run E2E tests for the SFTP Zip Gun VS Code extension via Playwright + Docker.
  Covers upload (Pistol/Canon/Gun), cancel, preset CRUD, and history.
  Use for verifying extension behavior after code changes.
  Use `npm run test:e2e:ui` for interactive debugging.
---

# SFTP Zip Gun — E2E Test Skill

## Prerequisites (check FIRST)

Run before any test command. Fix failures before running tests.

```bash
npm run qa:docker:status   # must show: running on 127.0.0.1:2222
npm run compile            # must exit 0
```

If docker is not running: `npm run qa:docker:start`

**VS Code must not have a pending update.** If VS Code exits immediately during tests
with "Code is currently being updated", open VS Code normally, let it restart, then retry.

## Command Map

| Scenario | Command |
|---|---|
| All suites headless | `npm run test:e2e` |
| All suites headed | `npm run test:e2e:headed` |
| Interactive (Playwright UI) | `npm run test:e2e:ui` |
| Upload — all 3 modes | `npm run test:e2e:upload` |
| Cancel — all 3 modes | `npm run test:e2e:cancel` |
| Preset add/edit/delete | `npm run test:e2e:presets` |
| History panel | `npm run test:e2e:history` |

## Result Interpretation

- **Exit 0** = all tests passed
- **Exit 1** = read stdout for the failed assertion

Common failures:

| Error | Cause | Fix |
|---|---|---|
| `#app not found within 30s` | Extension not activating or panel not opening | Check extension compiled (`npm run compile`); verify VS Code is not mid-update |
| `Selector not found / timeout` | Webview DOM changed | Search `media/panel.js` for the updated element |
| `strict mode violation: resolved to N elements` | Selector too broad (substring match) | Use `:text-is("...")` instead of `:has-text("...")` for exact label matching |
| Docker error | Container not running | `npm run qa:docker:start` |
| Launch timeout | VS Code slow to start | Increase `timeout` in `playwright.config.ts` |

## Architecture Notes

- **Webview detection**: Modern VS Code (1.70+) renders extension panels as `<iframe>` inside the main window, not as a new Electron `BrowserWindow`. `launchVsCode` polls both `app.windows()` and `mainWindow.frames()` until `#app` is found.
- **Panel activation**: Tests open the panel via command palette (`Ctrl+Shift+P` → "Open Upload Panel") rather than the `Ctrl+Shift+U` keybinding, which has a `when: resourceScheme == file` guard that fails when no editor is open.
- **Workspace trust**: Disabled via `settings.json` pre-written into the temp `--user-data-dir` so the trust dialog never blocks the test flow.
- **Updates**: `--disable-updates` prevents VS Code from auto-updating during test runs.

## Docker Fixture Reference

| User | Auth | Password | Safe assertion dir |
|---|---|---|---|
| `pwuser` | password | `pwpass` | `%TEMP%\sftp-zip-gun-qa\data\pwuser\store\` |
| `keyuser` | SSH key | — | `%TEMP%\sftp-zip-gun-qa\data\keyuser\store\` |

**Never assert against the `drop/` dir — files are deleted ~1 s after upload.**

SSH key: `%TEMP%\sftp-zip-gun-qa\keys\qa_ed25519`

## Key Selectors

| Element | Selector |
|---|---|
| Upload (FIRE) | `.btn-fire` |
| Cancel (HOLD) | `.btn-hold` |
| Preset dropdown | `#preset-select` |
| Mode: Pistol File | `.mode-half-pistol-file` |
| Mode: ZIP Canon | `.mode-half-zip-canon` |
| Mode: ZIP Gun | `.mode-half-zip-gun` |
| History tab | `button:has-text("Upload History")` |
| History success entry | `.history-entry.success` |

Full selector table: `docs/superpowers/plans/2026-04-26-sftp-playwright-e2e-skill.md`

## Model Assignment

| Task | Model |
|---|---|
| Run suite, report pass/fail | **haiku** |
| Debug failing test | **codex** |
| Write new spec | **sonnet** |
| Research Playwright/VS Code internals | **codex (xhigh)** |
