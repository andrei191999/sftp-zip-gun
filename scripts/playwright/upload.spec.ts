import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { storeDir, assertFileExists, listFiles, waitFor } from './helpers/sftp-verify';
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

test.describe.serial('upload flows', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PW_PRESET);
    await addPreset(shared.panel, KEY_PRESET);
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

  test('uploads single file via password auth', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'pistol-pw');
    const localFile = path.join(folder, `e2e-pistol-pw-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:pistol-pw:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');

    const dir  = storeDir('pwuser');
    const name = path.basename(localFile);
    await waitFor(() => listFiles(dir).includes(name), `${name} not found in pwuser/store`);
    assertFileExists(dir, name);
    await waitForUploadIdle(panel);
  });

  test('uploads single file via key auth', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'pistol-key');
    const localFile = path.join(folder, `e2e-pistol-key-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:pistol-key:${Date.now()}`);

    await selectPreset(panel, KEY_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');

    const dir  = storeDir('keyuser');
    const name = path.basename(localFile);
    await waitFor(() => listFiles(dir).includes(name), `${name} not found in keyuser/store`);
    assertFileExists(dir, name);
    await waitForUploadIdle(panel);
  });

  test('zips 3 files into one archive and uploads it', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zip-canon');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-canon-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:canon:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');
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
    await waitForUploadIdle(panel);
  });

  test('groups 3 files into 2 zips and uploads both', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zip-gun');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-gun-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gun:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    const groupSel = (fp: string) => {
      const norm = fp.replace(/\\/g, '/');
      return `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm}"] select`;
    };
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('1');
    await panel.locator(groupSel(files[2])).selectOption('__new__');

    const dir    = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 2,
      '2 zip archives not found in pwuser/store'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips).toHaveLength(2);
    await waitForUploadIdle(panel);
  });

  // ── New tests (5–15) ────────────────────────────────────────────────────────

  /** Clicks FIRE, waits for HOLD to become enabled, then clicks HOLD. */
  async function startAndCancel(panel: import('@playwright/test').Frame | import('@playwright/test').Page): Promise<void> {
    await panel.click('.btn-fire');
    await panel.waitForFunction(
      () => !(document.querySelector('.btn-hold') as HTMLButtonElement | null)?.disabled,
      { timeout: 15_000 }
    );
    await panel.click('.btn-hold');
  }

  /** Helper: normalised data-filepath attribute value (forward slashes). */
  function normPath(fp: string): string {
    return fp.replace(/\\/g, '/');
  }

  /** Selector for the group dropdown of a given file row. */
  function groupSel(fp: string): string {
    const norm = normPath(fp);
    return `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm}"] select`;
  }

  test('pistol_file — uploads 3 files as separate transfers', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'pistol-3files');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-pistol3-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:pistol3:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    for (const f of files) { await selectFile(panel, f); }

    const dir = storeDir('pwuser');
    await panel.click('.btn-fire');

    await waitFor(
      () => files.every(f => listFiles(dir).includes(path.basename(f))),
      'not all 3 pistol files appeared in pwuser/store'
    );
    for (const f of files) {
      assertFileExists(dir, path.basename(f));
    }
    await waitForUploadIdle(panel);
  });

  test('zip_gun — 3 groups produce 3 zip files on server', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-3groups');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-gun3g-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gun3g:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Each file gets its own new group (3 separate groups)
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('__new__');
    await panel.locator(groupSel(files[2])).selectOption('__new__');

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 3,
      '3 zip archives not found in pwuser/store'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips).toHaveLength(3);
    await waitForUploadIdle(panel);
  });

  test('zip_gun — clear groups, reassign, re-upload produces 2 zips', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-regroup');
    const files = [1, 2, 3].map(i => {
      const p = path.join(folder, `e2e-gunrg-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gunrg:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Clear any existing groups first
    await panel.click('button:has-text("\u00d7 Clear groups")');

    // Assign file 1 and file 2 to group 1
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('1');
    // Assign file 3 to group 2
    await panel.locator(groupSel(files[2])).selectOption('__new__');

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 2,
      '2 zip archives not found in pwuser/store after re-group'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips).toHaveLength(2);
    await waitForUploadIdle(panel);
  });

  test('zip_canon — custom archive name used in uploaded filename', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'canon-custom-name');
    const files = [1, 2].map(i => {
      const p = path.join(folder, `e2e-canon-name-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:canon-name:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');
    // Wait for mode switch to fully render before selecting files
    await panel.waitForSelector('.mode-half-zip-canon.active', { timeout: 5_000 });
    for (const f of files) { await selectFile(panel, f); }

    // Set a custom archive name
    const archiveName = 'custom-e2e-archive';
    await panel.locator('.row:has(label:text-is("Archive name")) input').fill(archiveName);

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).some(n => n.startsWith(archiveName) && n.endsWith('.zip') && !before.has(n)),
      `zip starting with '${archiveName}' not found in pwuser/store`
    );
    const zips = listFiles(dir).filter(n => n.startsWith(archiveName) && n.endsWith('.zip') && !before.has(n));
    expect(zips.length).toBeGreaterThanOrEqual(1);
    await waitForUploadIdle(panel);
  });

  test('zip_gun — base-counter naming produces numbered zip files', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-base-counter');
    const files = [1, 2].map(i => {
      const p = path.join(folder, `e2e-gunctr-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gunctr:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Select base-counter naming
    await panel.locator('input[type="radio"][name="groupNaming"][value="base-counter"]').check();
    // Fill base name
    const baseName = `myarchive-${Date.now()}`;
    await panel.locator('.row:has(label:text-is("Base name")) input').fill(baseName);

    // Each file in its own group
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('__new__');

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 2,
      'base-counter: 2 zip archives not found in pwuser/store'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips.length).toBeGreaterThanOrEqual(2);
    expect(zips.some(n => n.includes(baseName))).toBe(true);
    await waitForUploadIdle(panel);
  });

  test('zip_gun — base-timestamp naming produces zip files with base name', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-base-timestamp');
    const files = [1, 2].map(i => {
      const p = path.join(folder, `e2e-guntsp-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:guntsp:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Select base-timestamp naming
    await panel.locator('input[type="radio"][name="groupNaming"][value="base-timestamp"]').check();
    // Fill base name
    await panel.locator('.row:has(label:text-is("Base name")) input').fill('tsarchive');

    // Each file in its own group
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('__new__');

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 2,
      'base-timestamp: 2 zip archives not found in pwuser/store'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips.length).toBeGreaterThanOrEqual(2);
    expect(zips.some(n => n.includes('tsarchive'))).toBe(true);
    await waitForUploadIdle(panel);
  });

  test('zip_gun — anchor naming: zip named after anchor file', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-anchor');
    const ts = Date.now();
    const anchorFile = path.join(folder, `anchor-file-${ts}.txt`);
    const otherFile  = path.join(folder, `other-file-${ts}.txt`);
    fs.writeFileSync(anchorFile, `e2e:anchor:${ts}`);
    fs.writeFileSync(otherFile,  `e2e:other:${ts}`);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Select anchor naming
    await panel.locator('input[type="radio"][name="groupNaming"][value="anchor"]').check();

    // Assign both files to group 1
    await panel.locator(groupSel(anchorFile)).selectOption('__new__');
    await panel.locator(groupSel(otherFile)).selectOption('1');

    // Click the pin icon on anchor-file.txt to set it as the group anchor
    const anchorNorm = normPath(anchorFile);
    await panel.locator(
      `tr[data-filepath="${anchorFile}"] .pin-icon, tr[data-filepath="${anchorNorm}"] .pin-icon`
    ).first().click();

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 1,
      'anchor-named zip not found in pwuser/store'
    );
    const zips = listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n));
    expect(zips.length).toBeGreaterThanOrEqual(1);
    expect(zips.some(n => n.includes('anchor-file'))).toBe(true);
    await waitForUploadIdle(panel);
  });

  test('successful upload — file rows show done status badge', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'pistol-status-badge');
    const localFile = path.join(folder, `e2e-badge-${Date.now()}.txt`);
    fs.writeFileSync(localFile, `e2e:badge:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');
    await waitForUploadIdle(panel);

    // Status icon for the file row should have the done class
    const norm = normPath(localFile);
    const doneIcon = panel.locator(
      `tr[data-filepath="${localFile}"] .file-status-cell .status-icon-done, ` +
      `tr[data-filepath="${norm}"] .file-status-cell .status-icon-done`
    ).first();
    expect(await doneIcon.count()).toBeGreaterThan(0);
  });

  test('zip_gun upload — group header shows done status after upload', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'gun-group-status');
    const files = [1, 2].map(i => {
      const p = path.join(folder, `e2e-gunst-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `e2e:gunst:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Put both files in a single group
    await panel.locator(groupSel(files[0])).selectOption('__new__');
    await panel.locator(groupSel(files[1])).selectOption('1');

    const dir = storeDir('pwuser');
    const before = new Set(listFiles(dir));
    await panel.click('.btn-fire');

    await waitFor(
      () => listFiles(dir).filter(n => n.endsWith('.zip') && !before.has(n)).length >= 1,
      'zip not found in pwuser/store for group-status test'
    );
    await waitForUploadIdle(panel);

    // The group header's status icon should have the done class
    const doneIcon = panel.locator('tr.group-header-row .group-status-icon .status-icon-done').first();
    expect(await doneIcon.count()).toBeGreaterThan(0);
  });

  test('cancelled upload — history entry appears', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'cancel-history');
    const largeFile = path.join(folder, `e2e-cancel-hist-${Date.now()}.bin`);
    fs.writeFileSync(largeFile, Buffer.alloc(50 * 1024 * 1024, 0x42));

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, largeFile);

    await startAndCancel(panel);
    await waitForUploadIdle(panel);

    // Open history tab and wait for an entry to appear
    await panel.click('button:has-text("Upload History")');
    await panel.waitForSelector('.history-entry', { timeout: 10_000 });
    const entries = panel.locator('.history-entry');
    expect(await entries.count()).toBeGreaterThan(0);
  });

  test('folder change guard — warning logged when folder changed during upload', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'folder-guard');
    const largeFile = path.join(folder, `e2e-fguard-${Date.now()}.bin`);
    fs.writeFileSync(largeFile, Buffer.alloc(50 * 1024 * 1024, 0x42));

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, largeFile);

    // Fire and immediately try to trigger folder change (button is disabled, use force)
    await panel.click('.btn-fire');
    // Give the upload a moment to start, then click folder-btn with force to bypass disabled
    await panel.waitForFunction(
      () => (document.querySelector('.btn-hold') as HTMLButtonElement | null) !== null,
      { timeout: 10_000 }
    );
    await panel.locator('.folder-btn').click({ force: true });

    // Wait for upload to finish
    await waitForUploadIdle(panel);

    // Open log tab and check for the guard message
    await panel.click('button:has-text("Session Logs")');
    await panel.waitForSelector('.log-box', { state: 'attached', timeout: 15_000 });
    const logText = await panel.locator('.log-box').textContent();
    expect(logText).toContain('Cannot change');
  });
});
