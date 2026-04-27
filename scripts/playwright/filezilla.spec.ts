import { test, expect } from '@playwright/test';
import path from 'path';
import { launchVsCode, openPanelAndFindWebview } from './helpers/launch-vscode';
import type { PresetMeta } from '../../src/types/messages';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const ALICE: PresetMeta = {
  name: 'Alice SFTP',
  host: 'sftp.example.com',
  port: 22,
  username: 'alice',
  remoteDir: '/uploads/alice',
  savedPaths: [],
  authType: 'password',
  keyPath: '',
  readOnly: false,
};

const BOB: PresetMeta = {
  name: 'Bob Backup',
  host: 'backup.example.org',
  port: 2222,
  username: 'bob',
  remoteDir: '/home/bob',
  savedPaths: [],
  authType: 'password',
  keyPath: '',
  readOnly: false,
};

/**
 * Dispatch a synthetic `fileZillaImported` message into the webview, mimicking
 * what the host sends after a successful XML parse.
 */
async function injectFileZillaImported(
  panel: Awaited<ReturnType<typeof openPanelAndFindWebview>>,
  payload: {
    added: number;
    duplicates: number;
    skipped: number;
    total: number;
    presets: PresetMeta[];
    newPresetNames: string[];
  }
): Promise<void> {
  await panel.evaluate((p) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'fileZillaImported', payload: p },
      })
    );
  }, payload);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('FileZilla import', () => {
  test('spinner visible immediately after clicking Import from FileZilla', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.click('.view-tab:has-text("Manage connections")');

      // The click handler sets state.importPending = true synchronously and
      // calls render() before posting the host message, so the spinner should
      // appear in the DOM immediately (before any OS dialog opens).
      await panel.click('button:has-text("Import from FileZilla")');

      // Spinner is a span.spinner appended to the action row when importPending.
      await expect(panel.locator('.spinner').first()).toBeVisible({ timeout: 5_000 });

      // The import button itself is also disabled while pending.
      const importBtn = panel.locator('button:has-text("Import from FileZilla")');
      await expect(importBtn).toBeDisabled({ timeout: 5_000 });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });

  test('adds expected preset count from synthetic import', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.click('.view-tab:has-text("Manage connections")');

      // Confirm no preset cards initially.
      await expect(panel.locator('.preset-card')).toHaveCount(0, { timeout: 5_000 });

      await injectFileZillaImported(panel, {
        added: 2,
        duplicates: 0,
        skipped: 1,
        total: 3,
        presets: [ALICE, BOB],
        newPresetNames: ['Alice SFTP', 'Bob Backup'],
      });

      await expect(panel.locator('.preset-card')).toHaveCount(2, { timeout: 10_000 });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });

  test('NEW badge appears on each imported preset', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.click('.view-tab:has-text("Manage connections")');

      await injectFileZillaImported(panel, {
        added: 2,
        duplicates: 0,
        skipped: 1,
        total: 3,
        presets: [ALICE, BOB],
        newPresetNames: ['Alice SFTP', 'Bob Backup'],
      });

      await panel.waitForSelector('.preset-card', { timeout: 10_000 });

      // Each imported preset card should contain a .badge-new element.
      const aliceCard = panel.locator('.preset-card:has-text("Alice SFTP")');
      const bobCard   = panel.locator('.preset-card:has-text("Bob Backup")');

      await expect(aliceCard.locator('.badge-new')).toHaveCount(1, { timeout: 5_000 });
      await expect(bobCard.locator('.badge-new')).toHaveCount(1, { timeout: 5_000 });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });

  test('duplicate import shows duplicate count in session log', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.click('.view-tab:has-text("Manage connections")');

      // First import — 2 presets added.
      await injectFileZillaImported(panel, {
        added: 2,
        duplicates: 0,
        skipped: 0,
        total: 2,
        presets: [ALICE, BOB],
        newPresetNames: ['Alice SFTP', 'Bob Backup'],
      });
      await panel.waitForSelector('.preset-card', { timeout: 10_000 });

      // Second import — same presets, now all duplicates.
      await injectFileZillaImported(panel, {
        added: 0,
        duplicates: 2,
        skipped: 0,
        total: 2,
        presets: [ALICE, BOB],
        newPresetNames: [],
      });

      // The import result is pushed to the session log. pushLog() auto-opens
      // the log pane (logActiveTab = 'log'), so .log-box is rendered.
      // Entries are shown newest-first; the latest log line is the first div
      // in .log-box that contains the result text.
      await expect(
        panel.locator('.log-box').getByText('2 duplicate(s)', { exact: false })
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });

  test('skipped count shown in session log', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.click('.view-tab:has-text("Manage connections")');

      // 2 valid + 1 unnamed entry = skipped=1, total=3.
      await injectFileZillaImported(panel, {
        added: 2,
        duplicates: 0,
        skipped: 1,
        total: 3,
        presets: [ALICE, BOB],
        newPresetNames: ['Alice SFTP', 'Bob Backup'],
      });

      // The log message format is:
      //   "FileZilla import: N added, N duplicate(s), N skipped (of N found)."
      await expect(
        panel.locator('.log-box').getByText('1 skipped', { exact: false })
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });
});
