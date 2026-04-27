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
  openPanelAndFindWebview,
} from './helpers/launch-vscode';
import type { Frame, Page } from '@playwright/test';

const PRESET = {
  name: 'StateTest',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

type SharedSession = Awaited<ReturnType<typeof launchSharedVsCode>>;

test.describe.serial('ui-state', () => {
  let shared: SharedSession | undefined;

  test.beforeAll(async () => {
    shared = await launchSharedVsCode();
    await addPreset(shared.panel, PRESET);
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

  /** Helper: create N .txt files in a fresh test folder and return the folder path. */
  function makeFilledFolder(workspaceDir: string, label: string, names: string[]): string {
    const folder = makeTestFolder(workspaceDir, label);
    for (const name of names) {
      fs.writeFileSync(path.join(folder, name), name);
    }
    return folder;
  }

  // ---------------------------------------------------------------------------
  // State persistence (panel close / reopen)
  // ---------------------------------------------------------------------------

  test('mode persists after panel close/reopen', async () => {
    const { app, mainWindow, workspaceDir } = session();
    let { panel } = session();

    const folder = makeFilledFolder(workspaceDir, 'persist-mode', ['a.txt', 'b.txt']);
    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    // Close the panel tab
    await mainWindow.keyboard.press('Control+W');
    await new Promise(r => setTimeout(r, 800));

    // Reopen
    panel = await openPanelAndFindWebview(app, mainWindow);
    shared!.panel = panel;  // keep shared reference in sync

    // Mode is restored from vscode.setState — wait for mode buttons to render
    // (they're only in the Transfer tab, not Manage, so ensure Transfer is active)
    await panel.waitForSelector('.mode-half', { timeout: 10_000 });
    const active = panel.locator('.mode-half-zip-canon');
    await expect(active).toHaveClass(/active/);
  });

  test('last preset persists after panel close/reopen', async () => {
    const { app, mainWindow, workspaceDir } = session();
    let { panel } = session();

    // Ensure the preset is selected before closing
    await selectPreset(panel, PRESET.name);

    // Close the panel tab
    await mainWindow.keyboard.press('Control+W');
    await new Promise(r => setTimeout(r, 800));

    // Reopen
    panel = await openPanelAndFindWebview(app, mainWindow);
    shared!.panel = panel;

    // #preset-select value should be the preset name
    const value = await panel.locator('#preset-select').inputValue();
    expect(value).toBe(PRESET.name);
  });

  test('section collapse persists', async () => {
    const { app, mainWindow, workspaceDir } = session();
    let { panel } = session();

    const folder = makeFilledFolder(workspaceDir, 'persist-collapse', ['x.txt', 'y.txt']);
    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Collapse the files section via the section header toggle button
    const toggleBtn = panel.locator('#section-files .section-header button.section-toggle');
    await toggleBtn.click();
    // Wait for DOM to update (section-body should disappear)
    await panel.waitForSelector('#section-files .section-body', { state: 'detached', timeout: 5_000 });

    // Close and reopen panel
    await mainWindow.keyboard.press('Control+W');
    await new Promise(r => setTimeout(r, 800));
    panel = await openPanelAndFindWebview(app, mainWindow);
    shared!.panel = panel;

    await selectPreset(panel, PRESET.name);

    // Section body should still be collapsed (not in DOM)
    const bodyCount = await panel.locator('#section-files .section-body').count();
    expect(bodyCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Mode selection snapshots
  // ---------------------------------------------------------------------------

  test('mode selection snapshot preserves checked files across mode switch', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'mode-snapshot', ['f1.txt', 'f2.txt', 'f3.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Normalize paths as the webview does
    const norm = (name: string) => (folder + '/' + name).replace(/\\/g, '/');

    // Select f1 and f2
    await panel.locator(`tr[data-filepath="${norm('f1.txt')}"] input[type="checkbox"]`).check();
    await panel.locator(`tr[data-filepath="${norm('f2.txt')}"] input[type="checkbox"]`).check();

    // Switch to zip_canon, then back to pistol_file
    await switchMode(panel, 'zip_canon');
    await switchMode(panel, 'pistol_file');

    // f1 and f2 should still be checked
    await expect(panel.locator(`tr[data-filepath="${norm('f1.txt')}"] input[type="checkbox"]`)).toBeChecked();
    await expect(panel.locator(`tr[data-filepath="${norm('f2.txt')}"] input[type="checkbox"]`)).toBeChecked();
    await expect(panel.locator(`tr[data-filepath="${norm('f3.txt')}"] input[type="checkbox"]`)).not.toBeChecked();
  });

  test('zipGunMemory restore: groups intact after leaving and returning to zip_gun', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'zip-gun-mem', ['g1.txt', 'g2.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    const norm = (name: string) => (folder + '/' + name).replace(/\\/g, '/');

    // Select g1.txt and assign it to a new group via dropdown
    const groupSel = `tr[data-filepath="${norm('g1.txt')}"] select.group-select`;
    await panel.locator(groupSel).selectOption('__new__');

    // Verify group 1 row exists (G1 was created)
    await panel.waitForSelector('tr.group-header-row[data-groupid="1"]', { timeout: 5_000 });

    // Leave zip_gun
    await switchMode(panel, 'pistol_file');
    // Return to zip_gun — zipGunMemory should restore the group
    await switchMode(panel, 'zip_gun');

    // G1 header should still be present
    const groupHeaderCount = await panel.locator('tr.group-header-row[data-groupid="1"]').count();
    expect(groupHeaderCount).toBe(1);

    // g1.txt should still be in group 1
    const fileGroupSel = await panel.locator(`tr[data-filepath="${norm('g1.txt')}"] select.group-select`).inputValue();
    expect(fileGroupSel).toBe('1');
  });

  // ---------------------------------------------------------------------------
  // File filter
  // ---------------------------------------------------------------------------

  test('file filter narrows visible rows', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'filter-narrow', [
      'filter-alpha.txt',
      'filter-beta.txt',
      'other-gamma.txt',
    ]);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    const norm = (name: string) => (folder + '/' + name).replace(/\\/g, '/');

    // Type 'filter' into the filter input
    await panel.locator('input[placeholder="Filter files\u2026"]').fill('filter');

    // other-gamma.txt row should not be visible
    await expect(panel.locator(`tr[data-filepath="${norm('other-gamma.txt')}"]`)).not.toBeVisible();
    // filter-alpha.txt row should be visible
    await expect(panel.locator(`tr[data-filepath="${norm('filter-alpha.txt')}"]`)).toBeVisible();
  });

  test('file filter clear restores all rows', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'filter-clear', [
      'filter-alpha.txt',
      'filter-beta.txt',
      'other-gamma.txt',
    ]);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    const norm = (name: string) => (folder + '/' + name).replace(/\\/g, '/');
    const filterInput = panel.locator('input[placeholder="Filter files\u2026"]');

    // Apply filter, then clear it
    await filterInput.fill('filter');
    await filterInput.fill('');

    // All 3 rows should be visible again
    await expect(panel.locator(`tr[data-filepath="${norm('filter-alpha.txt')}"]`)).toBeVisible();
    await expect(panel.locator(`tr[data-filepath="${norm('filter-beta.txt')}"]`)).toBeVisible();
    await expect(panel.locator(`tr[data-filepath="${norm('other-gamma.txt')}"]`)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Reset local state
  // ---------------------------------------------------------------------------

  test('reset local state clears selections', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'reset', ['r1.txt', 'r2.txt', 'r3.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Check all checkboxes manually via the select-all button
    const toggleBtn = panel.locator('.file-controls button.secondary', { hasText: 'Select all' });
    await toggleBtn.first().click();

    // All should be checked now
    const allChecked = await panel.locator('tr[data-filepath] input[type="checkbox"]').all();
    for (const cb of allChecked) {
      await expect(cb).toBeChecked();
    }

    // Click Reset
    await panel.locator('button:has-text("Reset local state")').click();

    // All checkboxes should now be unchecked
    const afterReset = await panel.locator('tr[data-filepath] input[type="checkbox"]').all();
    for (const cb of afterReset) {
      await expect(cb).not.toBeChecked();
    }
  });

  // ---------------------------------------------------------------------------
  // Select-all / deselect-all
  // ---------------------------------------------------------------------------

  test('select-all checks all checkboxes', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'sel-all', ['s1.txt', 's2.txt', 's3.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Click the select-all toggle (label starts with ☑ or ⊟)
    const toggleBtn = panel.locator('.file-controls button.secondary').first();
    await toggleBtn.click();

    const checkboxes = panel.locator('tr[data-filepath] input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('deselect-all unchecks all checkboxes', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'desel-all', ['d1.txt', 'd2.txt', 'd3.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    const toggleBtn = panel.locator('.file-controls button.secondary').first();
    // First click: select all
    await toggleBtn.click();
    // Second click: deselect all
    await toggleBtn.click();

    const checkboxes = panel.locator('tr[data-filepath] input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
  });

  // ---------------------------------------------------------------------------
  // FIRE button state
  // ---------------------------------------------------------------------------

  test('FIRE disabled with no files selected', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'fire-disabled', ['a.txt', 'b.txt', 'c.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // No checkboxes checked — FIRE must be disabled
    await expect(panel.locator('.btn-fire')).toBeDisabled();
  });

  test('FIRE enabled after selecting one file', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'fire-enabled', ['a.txt', 'b.txt', 'c.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Check the first file row checkbox
    const firstCb = panel.locator('tr[data-filepath] input[type="checkbox"]').first();
    await firstCb.check();

    await expect(panel.locator('.btn-fire')).not.toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // sectionCollapsed state field
  // ---------------------------------------------------------------------------

  test('sectionCollapsed state field saved when section collapsed', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeFilledFolder(workspaceDir, 'sec-collapsed', ['a.txt', 'b.txt']);

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'pistol_file');

    // Collapse the section
    const toggleBtn = panel.locator('#section-files .section-header button.section-toggle');
    await toggleBtn.click();

    // Verify DOM collapsed (section-body gone)
    await panel.waitForSelector('#section-files .section-body', { state: 'detached', timeout: 5_000 });

    // Reload same folder — section should stay collapsed
    await loadFolder(panel, folder);
    const bodyCount = await panel.locator('#section-files .section-body').count();
    expect(bodyCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // groupCollapsed persists
  // ---------------------------------------------------------------------------

  test('groupCollapsed persists after collapse', async () => {
    const { app, mainWindow, workspaceDir } = session();
    let { panel } = session();

    const folder = makeFilledFolder(workspaceDir, 'grp-collapsed', ['gc1.txt', 'gc2.txt']);
    const norm = (name: string) => (folder + '/' + name).replace(/\\/g, '/');

    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Assign gc1.txt to a new group
    await panel.locator(`tr[data-filepath="${norm('gc1.txt')}"] select.group-select`).selectOption('__new__');
    await panel.waitForSelector('tr.group-header-row[data-groupid="1"]', { timeout: 5_000 });

    // Click the group header to collapse it (no files selected)
    await panel.locator('tr.group-header-row[data-groupid="1"]').click();
    // Wait for the file row to be hidden (collapsed)
    await panel.waitForFunction(() => {
      const hdr = document.querySelector('tr.group-header-row[data-groupid="1"]');
      if (!hdr) { return false; }
      // Next sibling should either not exist or be another header/separator
      const sibling = hdr.nextElementSibling;
      if (!sibling) { return true; }
      return !sibling.classList.contains('group-color-1') && !sibling.hasAttribute('data-groupid');
    }, { timeout: 5_000 });

    // Close and reopen panel
    await mainWindow.keyboard.press('Control+W');
    await new Promise(r => setTimeout(r, 800));
    panel = await openPanelAndFindWebview(app, mainWindow);
    shared!.panel = panel;

    // Reload folder
    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Inject zipGunMemory state so group shows up — zipGunMemory is session-only,
    // but groupCollapsed is persisted. After reopen, groups themselves are not
    // persisted, so we verify groupCollapsed via its effect: re-assign gc1 to G1
    // (which recreates it) and the header should start collapsed.
    // NOTE: groupCollapsed IS persisted via persistState() → setState message →
    // stateManager. The group structure itself is NOT persisted. So after reopen,
    // we re-create the group and the collapsed state should be remembered.
    await panel.locator(`tr[data-filepath="${norm('gc1.txt')}"] select.group-select`).selectOption('__new__');
    await panel.waitForSelector('tr.group-header-row[data-groupid="1"]', { timeout: 5_000 });

    // The group header caret should show the collapsed glyph (▸ = U+25B8)
    const caretText = await panel.locator('tr.group-header-row[data-groupid="1"] .group-header-content span').first().textContent();
    expect(caretText?.trim().startsWith('\u25b8')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // pickFolder message flow
  // ---------------------------------------------------------------------------

  test('pickFolder: injecting filesListed from new path populates file rows', async () => {
    const { panel, workspaceDir } = session();

    // First folder
    const folder1 = makeFilledFolder(workspaceDir, 'pick-folder-1', ['old-file.txt']);
    await selectPreset(panel, PRESET.name);
    await loadFolder(panel, folder1);
    await switchMode(panel, 'pistol_file');

    // Second folder with different files
    const folder2 = makeFilledFolder(workspaceDir, 'pick-folder-2', ['new-file.txt']);
    await loadFolder(panel, folder2);

    const norm2 = (name: string) => (folder2 + '/' + name).replace(/\\/g, '/');
    const norm1 = (name: string) => (folder1 + '/' + name).replace(/\\/g, '/');

    // New file should appear
    await expect(panel.locator(`tr[data-filepath="${norm2('new-file.txt')}"]`)).toBeVisible();

    // Old file should not be visible (different folder path)
    const oldCount = await panel.locator(`tr[data-filepath="${norm1('old-file.txt')}"]`).count();
    expect(oldCount).toBe(0);
  });
});
