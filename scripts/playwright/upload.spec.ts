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

    const { app, cleanup } = await launchVsCode([localFile]);
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
      cleanup();
      await app.close();
    }
  });

  test('uploads single file via key auth', async () => {
    const localFile = path.join(os.tmpdir(), `e2e-pistol-key-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:pistol-key:${Date.now()}`);

    const { app, cleanup } = await launchVsCode([localFile]);
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
      cleanup();
      await app.close();
    }
  });
});

test.describe('upload — ZIP Canon', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('zips 3 files into one archive and uploads it', async () => {
    const files = [1, 2, 3].map(i => {
      const p = path.join(os.tmpdir(), `e2e-canon-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:canon:${i}:${Date.now()}`);
      return p;
    });

    const { app, cleanup } = await launchVsCode(files);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await panel.click('.mode-half-zip-canon');
      for (const f of files) { await selectFile(panel, f); }

      const dir    = storeDir('pwuser');
      const before = new Set(listFiles(dir));
      await panel.click('.btn-fire');

      await waitFor(
        () => listFiles(dir).some(n => n.endsWith('.zip') && !before.has(n)),
        'zip archive not found in pwuser/store'
      );
      const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
      expect(zips).toHaveLength(1);
    } finally {
      cleanup();
      await app.close();
    }
  });
});

test.describe('upload — ZIP Gun', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('groups 3 files into 2 zips and uploads both', async () => {
    const files = [1, 2, 3].map(i => {
      const p = path.join(os.tmpdir(), `e2e-gun-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gun:${i}:${Date.now()}`);
      return p;
    });

    const { app, cleanup } = await launchVsCode(files);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await panel.click('.mode-half-zip-gun');

      // Create two groups
      await panel.click('button:has-text("→ New Group")');
      await panel.click('button:has-text("→ New Group")');

      // Assign via the group <select> in each file row
      const groupSel = (fp: string) => {
        const norm = fp.replace(/\\/g, '/');
        return `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm}"] select`;
      };
      await panel.locator(groupSel(files[0])).selectOption('1');
      await panel.locator(groupSel(files[1])).selectOption('1');
      await panel.locator(groupSel(files[2])).selectOption('2');

      const dir    = storeDir('pwuser');
      const before = new Set(listFiles(dir));
      await panel.click('.btn-fire');

      await waitFor(
        () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 2,
        '2 zip archives not found in pwuser/store'
      );
      const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
      expect(zips).toHaveLength(2);
    } finally {
      cleanup();
      await app.close();
    }
  });
});
