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
- **Selector not found / timeout**: webview DOM changed — search `renderers.js` for the updated element
- **Docker error**: run `npm run qa:docker:start`
- **Launch timeout**: VS Code took too long — increase `timeout` in `playwright.config.ts`

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
