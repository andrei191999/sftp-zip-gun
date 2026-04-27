import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { storeDir, listFiles, waitFor } from './helpers/sftp-verify';
import {
  launchSharedVsCode,
  makeTestFolder,
  addPreset,
  selectPreset,
  selectFile,
  loadFolder,
  switchMode,
  waitForUploadIdle,
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

test.describe.serial('upload history', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PW_PRESET);
  });

  test.afterAll(async () => {
    if (!shared) { return; }
    try {
      await shared.app.close();
    } finally {
      shared.cleanup();
    }
  });

  function session(): Awaited<ReturnType<typeof launchSharedVsCode>> {
    if (!shared) { throw new Error('Shared VS Code session was not initialized'); }
    return shared;
  }

  test('successful upload creates history entry with account, mode, file, and timestamp', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'history');
    const localFile = path.join(folder, `e2e-hist-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:history:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');

    const dir  = storeDir('pwuser');
    const name = path.basename(localFile);
    await waitFor(() => listFiles(dir).includes(name), `${name} not in pwuser/store`);
    await waitForUploadIdle(panel);

    await panel.click('button:has-text("Upload History")');
    await panel.waitForSelector('.history-entry.success', { timeout: 10_000 });

    const entry = panel.locator('.history-entry.success').first();

    const account = await entry.locator('.hentry-account').textContent();
    expect(account?.trim()).toBe(PW_PRESET.name);

    const mode = await entry.locator('.hentry-mode').textContent();
    expect(mode?.trim()).toBe('pistol');

    const files = await entry.locator('.hentry-files').textContent();
    expect(files).toContain(name);

    const ts = await entry.locator('.hentry-ts').textContent();
    expect(ts?.trim().length).toBeGreaterThan(0);
  });
});
