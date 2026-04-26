import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { storeDir, listFiles } from './helpers/sftp-verify';
import {
  launchVsCode, openPanelAndFindWebview, addPreset, selectPreset, selectFile,
} from './helpers/launch-vscode';

const PW_PRESET = {
  name: 'E2E PW',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

/** 50 MB binary file — ensures upload takes >2 s on localhost SFTP. */
function createLargeFile(tag: string): string {
  const p = path.join(os.tmpdir(), `e2e-large-${tag}-${Date.now()}.bin`);
  fs.writeFileSync(p, Buffer.alloc(50 * 1024 * 1024, 0x42));
  return p;
}

/** Clicks FIRE, waits for HOLD to become enabled, then clicks HOLD. */
async function startAndCancel(panel: any): Promise<void> {
  await panel.click('.btn-fire');
  await panel.waitForFunction(
    () => !(document.querySelector('.btn-hold') as HTMLButtonElement | null)?.disabled,
    { timeout: 15_000 }
  );
  await panel.click('.btn-hold');
}

test.describe('cancel — Pistol File', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('cancel mid-upload leaves no file on server', async () => {
    const localFile = createLargeFile('pistol');
    const app = await launchVsCode([localFile]);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await selectFile(panel, localFile);

      const before = new Set(listFiles(storeDir('pwuser')));
      await startAndCancel(panel);

      await new Promise(r => setTimeout(r, 3_000));
      const newFiles = listFiles(storeDir('pwuser')).filter(n => !before.has(n));
      expect(newFiles).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

test.describe('cancel — ZIP Canon', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('cancel during ZIP Canon leaves no zip on server', async () => {
    const files = [1, 2, 3].map(i => {
      const p = path.join(os.tmpdir(), `e2e-cancel-canon-${Date.now()}-${i}.bin`);
      fs.writeFileSync(p, Buffer.alloc(17 * 1024 * 1024, 0x43)); // 17 MB each = 51 MB total
      return p;
    });

    const app = await launchVsCode(files);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await panel.click('.mode-half-zip-canon');
      for (const f of files) { await selectFile(panel, f); }

      const before = new Set(listFiles(storeDir('pwuser')));
      await startAndCancel(panel);

      await new Promise(r => setTimeout(r, 3_000));
      const newZips = listFiles(storeDir('pwuser')).filter(n => n.endsWith('.zip') && !before.has(n));
      expect(newZips).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

test.describe('cancel — ZIP Gun', () => {
  test.beforeEach(() => { assertDockerRunning(); });

  test('cancel during ZIP Gun leaves no zips on server', async () => {
    const files = [1, 2].map(i => {
      const p = path.join(os.tmpdir(), `e2e-cancel-gun-${Date.now()}-${i}.bin`);
      fs.writeFileSync(p, Buffer.alloc(25 * 1024 * 1024, 0x44)); // 25 MB each
      return p;
    });

    const app = await launchVsCode(files);
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, PW_PRESET);
      await selectPreset(panel, PW_PRESET.name);
      await panel.click('.mode-half-zip-gun');

      await panel.click('button:has-text("→ New Group")');
      const norm = (fp: string) => fp.replace(/\\/g, '/');
      const groupSel = (fp: string) =>
        `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
      await panel.locator(groupSel(files[0])).selectOption('1');
      await panel.locator(groupSel(files[1])).selectOption('1');

      const before = new Set(listFiles(storeDir('pwuser')));
      await startAndCancel(panel);

      await new Promise(r => setTimeout(r, 3_000));
      const newZips = listFiles(storeDir('pwuser')).filter(n => n.endsWith('.zip') && !before.has(n));
      expect(newZips).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
