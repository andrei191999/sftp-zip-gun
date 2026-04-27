import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  launchSharedVsCode,
  makeTestFolder,
  addPreset,
  selectPreset,
  loadFolder,
  switchMode,
} from './helpers/launch-vscode';
import type { Frame, Page } from '@playwright/test';

const PRESET = {
  name: 'OpenFilesTest',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

type SharedSession = Awaited<ReturnType<typeof launchSharedVsCode>>;
type PanelTarget = Frame | Page;

/**
 * Injects a synthetic `openFiles` message into the webview, simulating what the
 * extension host sends when VS Code tabs change. This lets us test the open-files
 * rendering path without relying on actual tab events in the Extension Development Host.
 */
async function injectOpenFiles(
  panel: PanelTarget,
  files: { path: string; name: string }[]
): Promise<void> {
  await panel.evaluate((fileList) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'openFiles', payload: { files: fileList } },
      })
    );
  }, files);
  // Give the render cycle a moment to process
  await new Promise(r => setTimeout(r, 300));
}

test.describe.serial('open-files', () => {
  let shared: SharedSession | undefined;
  let testFilePath: string;
  let testFileName: string;

  test.beforeAll(async () => {
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PRESET);

    // Create a test file that will be "opened" in the editor
    testFileName = 'open-file-test.ts';
    testFilePath = path.join(shared.workspaceDir, testFileName).replace(/\\/g, '/');
    fs.writeFileSync(testFilePath.replace(/\//g, path.sep), 'export const x = 1;');
  });

  test.afterAll(async () => {
    if (!shared) { return; }
    try {
      await shared.app.close();
    } finally {
      shared.cleanup();
    }
  });

  function session(): SharedSession {
    if (!shared) { throw new Error('Shared VS Code session was not initialized'); }
    return shared;
  }

  // ---------------------------------------------------------------------------
  // Test 1: open file appears in Open Files section
  // ---------------------------------------------------------------------------

  test('open file appears in Open files section after opening in editor', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'open-files-appear');
    // No local files in this folder — the open file comes from a different path

    await selectPreset(panel, PRESET.name);

    // Inject the openFiles message
    await injectOpenFiles(panel, [{ path: testFilePath, name: testFileName }]);

    // The open file row should now appear in the file table
    const row = panel.locator(`tr.open-file-row[data-filepath="${testFilePath}"]`);
    // Build the table by loading a (possibly empty) folder so the section renders
    // First inject filesListed so state.files is set and section renders
    await panel.evaluate(({ fp }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { kind: 'filesListed', payload: { folderPath: fp, files: [] } },
        })
      );
    }, { fp: folder.replace(/\\/g, '/') });

    // Reinject openFiles after the render
    await injectOpenFiles(panel, [{ path: testFilePath, name: testFileName }]);

    await panel.waitForSelector(`tr.open-file-row[data-filepath="${testFilePath}"]`, { timeout: 10_000 });
    await expect(row).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Test 2: deduplication — file in local folder and open in editor appears once
  // ---------------------------------------------------------------------------

  test('open file deduplication: file in local folder and open in editor appears once', async () => {
    const { panel, workspaceDir } = session();

    // Create a local folder that contains the test file
    const folder = makeTestFolder(workspaceDir, 'open-files-dedup');
    const localFileName = 'open-file-test.ts';
    const localFilePath = path.join(folder, localFileName);
    fs.writeFileSync(localFilePath, 'export const y = 2;');

    const normalizedFolder = folder.replace(/\\/g, '/');
    const normalizedFilePath = (normalizedFolder + '/' + localFileName);

    await selectPreset(panel, PRESET.name);
    await switchMode(panel, 'pistol_file');

    // Load the folder (file appears in local section)
    await loadFolder(panel, folder);

    // Inject openFiles with the same file path
    await injectOpenFiles(panel, [{ path: normalizedFilePath, name: localFileName }]);

    // Count ALL tr rows with a filepath matching this file
    const rows = panel.locator(`tr[data-filepath*="open-file-test"]`);
    const count = await rows.count();
    // Should be exactly 1 (deduped: open-file row replaces local row)
    expect(count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 3: folder switch icon visible in open-file row from a different directory
  // ---------------------------------------------------------------------------

  test('folder switch icon visible in open-file row from different directory', async () => {
    const { panel, workspaceDir } = session();

    // Set local folder to a subdirectory different from where testFilePath lives
    const localFolder = makeTestFolder(workspaceDir, 'open-files-switch-icon');
    fs.writeFileSync(path.join(localFolder, 'local.txt'), 'local');

    await selectPreset(panel, PRESET.name);
    await switchMode(panel, 'pistol_file');
    await loadFolder(panel, localFolder);

    // testFilePath is in workspaceDir (not localFolder), so it's from a different directory
    await injectOpenFiles(panel, [{ path: testFilePath, name: testFileName }]);
    await panel.waitForSelector(`tr.open-file-row[data-filepath="${testFilePath}"]`, { timeout: 10_000 });

    // The hover-icon (folder switch) should exist in the row
    const hoverIcon = panel.locator(
      `tr.open-file-row[data-filepath="${testFilePath}"] .hover-icon`
    );
    await expect(hoverIcon).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Test 4: selecting open-file row checkbox enables FIRE
  // ---------------------------------------------------------------------------

  test('select open-file row checkbox enables FIRE', async () => {
    const { panel, workspaceDir } = session();

    const localFolder = makeTestFolder(workspaceDir, 'open-files-fire');
    // No local files — rely entirely on open file

    await selectPreset(panel, PRESET.name);
    await switchMode(panel, 'pistol_file');

    // Load empty local folder so the panel renders
    await panel.evaluate(({ fp }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { kind: 'filesListed', payload: { folderPath: fp, files: [] } },
        })
      );
    }, { fp: localFolder.replace(/\\/g, '/') });

    // Inject open file
    await injectOpenFiles(panel, [{ path: testFilePath, name: testFileName }]);
    await panel.waitForSelector(`tr.open-file-row[data-filepath="${testFilePath}"]`, { timeout: 10_000 });

    // FIRE should start disabled (nothing selected)
    await expect(panel.locator('.btn-fire')).toBeDisabled();

    // Check the open file's checkbox
    const cb = panel.locator(`tr.open-file-row[data-filepath="${testFilePath}"] input[type="checkbox"]`);
    await cb.check();

    // FIRE should now be enabled
    await expect(panel.locator('.btn-fire')).not.toBeDisabled();
  });
});
