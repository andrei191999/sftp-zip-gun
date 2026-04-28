import { test, expect } from '@playwright/test';
import path from 'path';
import { launchVsCode, openLogTab, openPanelAndFindWebview } from './helpers/launch-vscode';
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
    const restoreTransport = (() => {
      try {
        const webviewHost = (window as Window & {
          chrome?: { webview?: { postMessage?: (message: unknown) => void } };
        }).chrome?.webview;
        if (webviewHost && typeof webviewHost.postMessage === 'function') {
          const originalPostMessage = webviewHost.postMessage.bind(webviewHost);
          webviewHost.postMessage = () => undefined;
          return () => { webviewHost.postMessage = originalPostMessage; };
        }
      } catch { /* fall through */ }

      try {
        const parentWindow = window.parent as Window & {
          postMessage?: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => void;
        };
        if (typeof parentWindow.postMessage === 'function') {
          const originalPostMessage = parentWindow.postMessage.bind(parentWindow);
          parentWindow.postMessage = () => undefined;
          return () => { parentWindow.postMessage = originalPostMessage; };
        }
      } catch { /* ignore */ }

      return () => {};
    })();

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { kind: 'fileZillaImported', payload: p },
        })
      );
    } finally {
      restoreTransport();
    }
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
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 45_000 });
      await new Promise(r => setTimeout(r, 2_000));
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await panel.locator('.view-tab:has-text("Manage connections")').evaluate((button: HTMLElement) => button.click());
      await expect(panel.locator('button:has-text("Import from FileZilla")')).toBeVisible({ timeout: 10_000 });

      // The click handler sets state.importPending = true synchronously and
      // calls render() before posting the host message. Capture that immediate
      // DOM state in-page so this assertion is not held hostage by the native
      // file picker flow after the click.
      const importPendingState = await panel.evaluate(() => {
        const restoreTransport = (() => {
          try {
            const webviewHost = (window as Window & {
              chrome?: { webview?: { postMessage?: (message: unknown) => void } };
            }).chrome?.webview;
            if (webviewHost && typeof webviewHost.postMessage === 'function') {
              const originalPostMessage = webviewHost.postMessage.bind(webviewHost);
              webviewHost.postMessage = () => undefined;
              return () => { webviewHost.postMessage = originalPostMessage; };
            }
          } catch { /* fall through */ }

          try {
            const parentWindow = window.parent as Window & {
              postMessage?: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => void;
            };
            if (typeof parentWindow.postMessage === 'function') {
              const originalPostMessage = parentWindow.postMessage.bind(parentWindow);
              parentWindow.postMessage = () => undefined;
              return () => { parentWindow.postMessage = originalPostMessage; };
            }
          } catch { /* ignore */ }

          return () => {};
        })();

        const findImportButton = (): HTMLButtonElement | null => {
          return Array.from(document.querySelectorAll('button')).find(
            (button): button is HTMLButtonElement => button.textContent?.includes('Import from FileZilla') ?? false
          ) ?? null;
        };

        try {
          const importButton = findImportButton();
          if (!importButton) {
            return { found: false, disabled: false, spinnerVisible: false };
          }

          importButton.click();

          const currentButton = findImportButton();
          return {
            found: true,
            disabled: currentButton?.disabled ?? false,
            spinnerVisible: !!document.querySelector('.spinner'),
          };
        } finally {
          restoreTransport();
        }
      });

      expect(importPendingState).toEqual({
        found: true,
        disabled: true,
        spinnerVisible: true,
      });
    } finally {
      try { await app.close(); } catch { /* ignore */ }
      cleanup();
    }
  });

  test('adds expected preset count from synthetic import', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 45_000 });
      await new Promise(r => setTimeout(r, 2_000));  // Extra settle time after workbench ready
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

      await openLogTab(panel);
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
