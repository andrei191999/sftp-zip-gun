import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { assertDockerRunning } from './helpers/docker-check';
import { listFiles, makeRemoteTestDir, waitFor } from './helpers/sftp-verify';
import {
  launchSharedVsCode,
  makeTestFolder,
  addPreset,
  selectPreset,
  selectOneTimeRemotePath,
  selectFile,
  loadFolder,
  switchMode,
  waitForUploadIdle,
  openHistoryTab,
  openLogTab,
  setHistoryFilter,
  getHistoryEntries,
  injectLog,
  setLogCategoryFilter,
  openTransferTab,
} from './helpers/launch-vscode';

const PW_PRESET = {
  name: 'Filter PW',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

const BAD_PRESET = {
  name: 'Filter Bad',
  host: '127.0.0.1',
  port: 9999,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'wrongpass',
};

test.describe.serial('history filters and log tab', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PW_PRESET);
    await addPreset(shared.panel, BAD_PRESET);
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

  // ---------------------------------------------------------------------------
  // Test 1: empty state on fresh session
  // Must run BEFORE any upload creates history entries.
  // ---------------------------------------------------------------------------
  test('history — empty state on fresh session', async () => {
    const { panel } = session();

    await openHistoryTab(panel);
    await expect(panel.locator('.history-empty')).toBeVisible({ timeout: 5_000 });
    const text = await panel.locator('.history-empty').textContent();
    expect(text?.trim()).toBe('No history yet.');
  });

  // ---------------------------------------------------------------------------
  // Test 2: successful upload creates entry with success badge
  // ---------------------------------------------------------------------------
  test('history — successful upload creates entry with success badge', async ({}, testInfo) => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'hf-success');
    const localFile = path.join(folder, `hf-success-${Date.now()}.txt`);
    const remote = makeRemoteTestDir(testInfo, 'pwuser', 'hf-success');
    fs.writeFileSync(localFile, `hf:success:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remote.remoteDir);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');

    const name = path.basename(localFile);
    await waitFor(() => listFiles(remote.hostDir).includes(name), `${name} not in ${remote.hostDir}`);
    await waitForUploadIdle(panel);

    await openHistoryTab(panel);
    // Reset result filter (mode buttons may not exist yet — skip mode reset)
    await setHistoryFilter(panel, 'all', 'all');

    await panel.waitForSelector('.history-entry.success', { timeout: 10_000 });
    const entry = panel.locator('.history-entry.success').first();
    const account = await entry.locator('.hentry-account').textContent();
    expect(account?.trim()).toBe(PW_PRESET.name);
  });

  // ---------------------------------------------------------------------------
  // Test 3: newest entry appears at top
  // ---------------------------------------------------------------------------
  test('history — newest entry appears at top', async ({}, testInfo) => {
    const { panel, workspaceDir } = session();

    // Upload file A
    const folderA = makeTestFolder(workspaceDir, 'hf-order-a');
    const fileA = path.join(folderA, `hf-order-a-${Date.now()}.txt`);
    const remoteA = makeRemoteTestDir(testInfo, 'pwuser', 'hf-order-a');
    fs.writeFileSync(fileA, `hf:order-a:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remoteA.remoteDir);
    await loadFolder(panel, folderA);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, fileA);
    await panel.click('.btn-fire');
    await waitFor(
      () => listFiles(remoteA.hostDir).includes(path.basename(fileA)),
      `${path.basename(fileA)} not in ${remoteA.hostDir}`
    );
    await waitForUploadIdle(panel);

    // Upload file B
    const folderB = makeTestFolder(workspaceDir, 'hf-order-b');
    const fileB = path.join(folderB, `hf-order-b-${Date.now()}.txt`);
    const remoteB = makeRemoteTestDir(testInfo, 'pwuser', 'hf-order-b');
    fs.writeFileSync(fileB, `hf:order-b:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remoteB.remoteDir);
    await loadFolder(panel, folderB);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, fileB);
    await panel.click('.btn-fire');
    await waitFor(
      () => listFiles(remoteB.hostDir).includes(path.basename(fileB)),
      `${path.basename(fileB)} not in ${remoteB.hostDir}`
    );
    await waitForUploadIdle(panel);

    await openHistoryTab(panel);
    // Reset result filter; mode buttons absent (all entries are pistol), skip mode reset
    await setHistoryFilter(panel, 'all', 'all');

    await panel.waitForSelector('.history-entry', { timeout: 10_000 });
    const entries = getHistoryEntries(panel);
    const firstFiles = await entries.first().locator('.hentry-files').textContent();
    expect(firstFiles).toContain(path.basename(fileB));
  });

  // ---------------------------------------------------------------------------
  // Test 4: result filter Success hides error entries
  // Creates 1 success + 1 error entry for tests 4, 5, and 6.
  // ---------------------------------------------------------------------------
  test('history — result filter Success hides error entries', async ({}, testInfo) => {
    const { panel, workspaceDir } = session();

    // 1 success entry
    const folder = makeTestFolder(workspaceDir, 'hf-filter-ok');
    const localFile = path.join(folder, `hf-fok-${Date.now()}.txt`);
    const remote = makeRemoteTestDir(testInfo, 'pwuser', 'hf-filter-ok');
    fs.writeFileSync(localFile, `hf:filter-ok:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remote.remoteDir);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, localFile);
    await panel.click('.btn-fire');
    await waitFor(
      () => listFiles(remote.hostDir).includes(path.basename(localFile)),
      `${path.basename(localFile)} not in ${remote.hostDir}`
    );
    await waitForUploadIdle(panel);

    // 1 error entry — BAD_PRESET connects to port 9999 (nothing listening)
    // No files needed — the folder is irrelevant; connection fails immediately
    const folderBad = makeTestFolder(workspaceDir, 'hf-filter-err');
    const badFile = path.join(folderBad, `hf-ferr-${Date.now()}.txt`);
    fs.writeFileSync(badFile, `hf:filter-err:${Date.now()}`);

    await selectPreset(panel, BAD_PRESET.name);
    await loadFolder(panel, folderBad);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, badFile);
    await panel.click('.btn-fire');

    // Port 9999 is closed — error arrives quickly; wait for error entry
    await openHistoryTab(panel);
    await panel.waitForSelector('.history-entry.error', { timeout: 20_000 });

    // Now apply Success filter
    await setHistoryFilter(panel, 'success', 'all');

    const errorCount = await panel.locator('.history-entry.error').count();
    expect(errorCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: result filter Error hides success entries
  // Reuses the history state from test 4 (both entry types are present).
  // ---------------------------------------------------------------------------
  test('history — result filter Error hides success entries', async () => {
    const { panel } = session();

    await openHistoryTab(panel);
    // Reset to all first, then apply error filter
    await setHistoryFilter(panel, 'all', 'all');
    await setHistoryFilter(panel, 'error', 'all');

    const successCount = await panel.locator('.history-entry.success').count();
    expect(successCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 6: result filter All shows all entries
  // ---------------------------------------------------------------------------
  test('history — result filter All shows all entries', async () => {
    const { panel } = session();

    await openHistoryTab(panel);
    await setHistoryFilter(panel, 'all', 'all');

    await expect(panel.locator('.history-entry.success').first()).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('.history-entry.error').first()).toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Test 7: mode filter canon hides pistol entry
  // Requires both pistol and canon entries in history so the mode bar appears.
  // ---------------------------------------------------------------------------
  test('history — mode filter canon hides pistol entry', async ({}, testInfo) => {
    const { panel, workspaceDir } = session();

    // pistol_file entry
    const folderP = makeTestFolder(workspaceDir, 'hf-mode-pistol');
    const fileP = path.join(folderP, `hf-mode-pistol-${Date.now()}.txt`);
    const remoteP = makeRemoteTestDir(testInfo, 'pwuser', 'hf-mode-pistol');
    fs.writeFileSync(fileP, `hf:mode-pistol:${Date.now()}`);

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remoteP.remoteDir);
    await loadFolder(panel, folderP);
    await switchMode(panel, 'pistol_file');
    await selectFile(panel, fileP);
    await panel.click('.btn-fire');
    await waitFor(
      () => listFiles(remoteP.hostDir).includes(path.basename(fileP)),
      `${path.basename(fileP)} not in ${remoteP.hostDir}`
    );
    await waitForUploadIdle(panel);

    // zip_canon entry
    const folderC = makeTestFolder(workspaceDir, 'hf-mode-canon');
    const remoteC = makeRemoteTestDir(testInfo, 'pwuser', 'hf-mode-canon');
    const canonFiles = [1, 2, 3].map(i => {
      const p = path.join(folderC, `hf-canon-${Date.now()}-${i}.txt`);
      fs.writeFileSync(p, `hf:canon:${i}:${Date.now()}`);
      return p;
    });

    await selectPreset(panel, PW_PRESET.name);
    await selectOneTimeRemotePath(panel, remoteC.remoteDir);
    await loadFolder(panel, folderC);
    await switchMode(panel, 'zip_canon');
    for (const f of canonFiles) { await selectFile(panel, f); }

    const dirBefore = new Set(listFiles(remoteC.hostDir));
    await panel.click('.btn-fire');
    await waitFor(
      () => listFiles(remoteC.hostDir).some(n => n.endsWith('.zip') && !dirBefore.has(n)),
      `canon zip not in ${remoteC.hostDir}`
    );
    await waitForUploadIdle(panel);

    await openHistoryTab(panel);
    // Reset result filter to all; mode buttons now exist (pistol + canon)
    await setHistoryFilter(panel, 'all', 'all');

    // Verify mode filter bar is present (pistol AND canon modes in history)
    await panel.waitForSelector('button:has-text("All modes")', { timeout: 5_000 });

    // Apply canon mode filter
    await setHistoryFilter(panel, 'all', 'canon');

    // No pistol-mode entries should be visible
    await expect(panel.locator('.history-entry .hentry-mode-pistol_file')).toHaveCount(0, { timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Test 8: mode filter all restores all entries
  // ---------------------------------------------------------------------------
  test('history — mode filter all restores all entries', async () => {
    const { panel } = session();

    await openHistoryTab(panel);
    // Mode bar is present (from test 7 state)
    await setHistoryFilter(panel, 'all', 'all');

    await expect(panel.locator('.history-entry .hentry-mode-pistol_file').first()).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('.history-entry .hentry-mode-zip_canon').first()).toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Test 9: filtered empty state when no entries match
  // ---------------------------------------------------------------------------
  test('history — filtered empty state when no entries match', async () => {
    const { panel, workspaceDir } = session();

    // Create a fresh isolated VS Code session snapshot by injecting history
    // via the synthetic historyUpdate message, so we control exactly what is present.
    // Inject a history array with only 1 success entry, then filter to error.
    await panel.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          kind: 'history',
          payload: {
            entries: [
              {
                id: 'test-empty-state-1',
                presetName: 'Filter PW',
                mode: 'pistol_file',
                result: 'success',
                files: ['dummy.txt'],
                remoteFile: '/store/dummy.txt',
                timestamp: Date.now(),
              },
            ],
          },
        },
      }));
    });

    await openHistoryTab(panel);
    // Reset result filter (mode bar absent — only one entry, one mode)
    await setHistoryFilter(panel, 'all', 'all');

    // Now filter to error — no error entries exist
    await setHistoryFilter(panel, 'error', 'all');

    await expect(panel.locator('.history-empty')).toBeVisible({ timeout: 5_000 });
    const text = await panel.locator('.history-empty').textContent();
    expect(text?.trim()).toBe('No matching entries.');

    // Switch away from history tab so subsequent tests start from the transfer view.
    await openTransferTab(panel);
  });

  // ---------------------------------------------------------------------------
  // Test 10: log tab — messages appear newest at top
  // ---------------------------------------------------------------------------
  test('log tab — messages appear newest at top', async () => {
    const { panel } = session();

    await openLogTab(panel);

    await injectLog(panel, 'log-order-first',  'info', 'sys');
    await injectLog(panel, 'log-order-second', 'info', 'sys');
    await injectLog(panel, 'log-order-third',  'info', 'sys');

    // The log box renders newest-first (.slice().reverse()):
    // first visible non-separator div should contain 'log-order-third'
    const logBox = panel.locator('.log-box');
    await expect(logBox).toBeVisible({ timeout: 5_000 });

    const allLines = logBox.locator('div');
    const count = await allLines.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Find the first div that contains one of our injected texts
    let foundFirstText: string | null = null;
    for (let i = 0; i < count; i++) {
      const text = await allLines.nth(i).textContent();
      if (text && (
        text.includes('log-order-third') ||
        text.includes('log-order-second') ||
        text.includes('log-order-first')
      )) {
        foundFirstText = text;
        break;
      }
    }
    expect(foundFirstText).toContain('log-order-third');

    // Find the last div that contains one of our injected texts
    let foundLastText: string | null = null;
    for (let i = count - 1; i >= 0; i--) {
      const text = await allLines.nth(i).textContent();
      if (text && (
        text.includes('log-order-third') ||
        text.includes('log-order-second') ||
        text.includes('log-order-first')
      )) {
        foundLastText = text;
        break;
      }
    }
    expect(foundLastText).toContain('log-order-first');
  });

  // ---------------------------------------------------------------------------
  // Test 11: log category filter — shows only selected category
  // ---------------------------------------------------------------------------
  test('log category filter — shows only selected category', async () => {
    const { panel } = session();

    await openLogTab(panel);

    // Reset to all categories
    await setLogCategoryFilter(panel, 'all');

    await injectLog(panel, 'hf-upload-msg', 'info', 'upload');
    await injectLog(panel, 'hf-conn-msg',   'info', 'conn');

    // Both should be visible with all filter active
    await expect(panel.locator('.log-box')).toBeVisible({ timeout: 5_000 });

    // Apply 'conn' filter — only conn category shown
    await setLogCategoryFilter(panel, 'conn');

    // The upload-msg line should not be visible (its category is filtered out)
    // We check the text content of the entire log box
    const logBoxText = await panel.locator('.log-box').textContent();
    expect(logBoxText).not.toContain('hf-upload-msg');
    expect(logBoxText).toContain('hf-conn-msg');

    // Reset to all categories
    await setLogCategoryFilter(panel, 'all');
  });
});
