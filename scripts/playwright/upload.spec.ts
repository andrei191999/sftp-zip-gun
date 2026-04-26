import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { storeDir, assertFileExists, listFiles, waitFor } from './helpers/sftp-verify';
import {
  launchVsCode, openPanelAndFindWebview, addPreset, selectPreset, selectFile,
} from './helpers/launch-vscode';

const KEY_PATH = path.join(os.tmpdir(), 'sftp-zip-gun-qa', 'keys', 'qa_ed25519');

const PW_PRESET = {
  name: 'E2E PW',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

const KEY_PRESET = {
  name: 'E2E Key',
  host: '127.0.0.1',
  port: 2222,
  username: 'keyuser',
  remoteDir: '/store',
  authType: 'key' as const,
  keyPath: KEY_PATH,
};

test.describe('upload — Pistol File', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('uploads single file via password auth', async () => {
    const localFile = path.join(os.tmpdir(), `e2e-pistol-pw-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:pistol-pw:${Date.now()}`);

    const app = await launchVsCode([localFile]);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await selectFile(panel, localFile);
      await panel.click('.btn-fire');

      const dir  = storeDir('pwuser');
      const name = path.basename(localFile);
      await waitFor(() => listFiles(dir).includes(name), `${name} not found in pwuser/store`);
      assertFileExists(dir, name);
    } finally {
      await app.close();
    }
  });

  test('uploads single file via key auth', async () => {
    const localFile = path.join(os.tmpdir(), `e2e-pistol-key-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:pistol-key:${Date.now()}`);

    const app = await launchVsCode([localFile]);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, KEY_PRESET);
      await selectPreset(panel, KEY_PRESET.name);
      await selectFile(panel, localFile);
      await panel.click('.btn-fire');

      const dir  = storeDir('keyuser');
      const name = path.basename(localFile);
      await waitFor(() => listFiles(dir).includes(name), `${name} not found in keyuser/store`);
      assertFileExists(dir, name);
    } finally {
      await app.close();
    }
  });
});
