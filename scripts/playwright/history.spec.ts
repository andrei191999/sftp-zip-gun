import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { storeDir, listFiles, waitFor } from './helpers/sftp-verify';
import {
  launchVsCode, openPanelAndFindWebview, addPreset, selectPreset, selectFile,
} from './helpers/launch-vscode';

const PW_PRESET = {
  name: 'History PW',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

test.describe('upload history', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('successful upload creates history entry with correct badge and account', async () => {
    const localFile = path.join(os.tmpdir(), `e2e-hist-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:history:${Date.now()}`);

    const { app, cleanup } = await launchVsCode([localFile]);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await selectFile(panel, localFile);
      await panel.click('.btn-fire');

      // Wait for file on SFTP server
      const dir  = storeDir('pwuser');
      const name = path.basename(localFile);
      await waitFor(() => listFiles(dir).includes(name), `${name} not in pwuser/store`);

      // Wait for FIRE to re-enable (upload complete)
      await panel.waitForFunction(
        () => !(document.querySelector('.btn-fire') as HTMLButtonElement | null)?.disabled,
        { timeout: 30_000 }
      );

      // Open history tab
      await panel.click('button:has-text("Upload History")');
      await panel.waitForSelector('.history-entry.success', { timeout: 10_000 });

      const entry = panel.locator('.history-entry.success').first();

      // Account name
      const account = await entry.locator('.hentry-account').textContent();
      expect(account?.trim()).toBe(PW_PRESET.name);

      // Mode badge — default mode is pistol_file → badge text is 'pistol'
      const mode = await entry.locator('.hentry-mode').textContent();
      expect(mode?.trim()).toBe('pistol');

      // Filename in entry
      const files = await entry.locator('.hentry-files').textContent();
      expect(files).toContain(name);
    } finally {
      cleanup();
      await app.close();
    }
  });

  test('history entry timestamp is non-empty', async () => {
    const localFile = path.join(os.tmpdir(), `e2e-hist-ts-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:history-ts:${Date.now()}`);

    const { app, cleanup } = await launchVsCode([localFile]);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await selectFile(panel, localFile);
      await panel.click('.btn-fire');

      await panel.waitForFunction(
        () => !(document.querySelector('.btn-fire') as HTMLButtonElement | null)?.disabled,
        { timeout: 30_000 }
      );

      await panel.click('button:has-text("Upload History")');
      await panel.waitForSelector('.history-entry.success', { timeout: 10_000 });

      const ts = await panel
        .locator('.history-entry.success .hentry-ts')
        .first()
        .textContent();
      expect(ts?.trim().length).toBeGreaterThan(0);
    } finally {
      cleanup();
      await app.close();
    }
  });
});
