import { test } from '@playwright/test';
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
  name: 'E2E PW',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

/** 50 MB binary file — ensures upload takes >2 s on localhost SFTP. */
function createLargeFile(dir: string, tag: string): string {
  const p = path.join(dir, `e2e-large-${tag}-${Date.now()}.bin`);
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

test.describe.serial('cancel flows', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PW_PRESET);
  });

  test.afterEach(async () => {
    if (shared) {
      await waitForUploadIdle(shared.panel);
    }
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

  test('cancel mid-upload leaves no file on server', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'cancel-pistol');
    const localFile = createLargeFile(folder, 'pistol');

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);

    const before = new Set(listFiles(storeDir('pwuser')));
    await startAndCancel(panel);

    await waitFor(
      () => listFiles(storeDir('pwuser')).filter(n => !before.has(n)).length === 0,
      'unexpected files appeared after cancel',
      8_000
    );
    await waitForUploadIdle(panel);
  });

  test('cancel during ZIP Canon leaves no zip on server', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'cancel-canon');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-cancel-canon-${Date.now()}-${i}.bin`);
      fs.writeFileSync(p, Buffer.alloc(17 * 1024 * 1024, 0x43)); // 17 MB each = 51 MB total
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');
    for (const f of files) { await selectFile(panel, f); }

    const before = new Set(listFiles(storeDir('pwuser')));
    await startAndCancel(panel);

    await waitFor(
      () => listFiles(storeDir('pwuser')).filter(n => n.endsWith('.zip') && !before.has(n)).length === 0,
      'unexpected zip appeared after cancel',
      8_000
    );
    await waitForUploadIdle(panel);
  });

  test('cancel during ZIP Gun leaves no zips on server', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'cancel-gun');
    const files = [1, 2].map(i => {
      const p = path.join(folder, `e2e-cancel-gun-${Date.now()}-${i}.bin`);
      fs.writeFileSync(p, Buffer.alloc(25 * 1024 * 1024, 0x44)); // 25 MB each
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('1');

    const before = new Set(listFiles(storeDir('pwuser')));
    await startAndCancel(panel);

    await waitFor(
      () => listFiles(storeDir('pwuser')).filter(n => n.endsWith('.zip') && !before.has(n)).length === 0,
      'unexpected zip appeared after cancel',
      8_000
    );
    await waitForUploadIdle(panel);
  });
});
