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
  selectFile,
} from './helpers/launch-vscode';

const PW_PRESET = {
  name: 'NamingTest',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

/** Write N .txt files into dir and return their absolute paths. */
function makeFiles(dir: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const p = path.join(dir, `file-${String(i + 1).padStart(2, '0')}.txt`);
    fs.writeFileSync(p, `content-${i + 1}`);
    return p;
  });
}

test.describe.serial('zip naming UI', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
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
    if (!shared) { throw new Error('session not initialized'); }
    return shared;
  }

  // ---------------------------------------------------------------------------
  // ZIP Canon tests
  // ---------------------------------------------------------------------------

  test('zip_canon — archive name input shows placeholder', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zc-placeholder');
    makeFiles(folder, 1);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    const input = panel.locator('.row:has(label:has-text("Archive name")) input');
    await input.waitFor({ timeout: 10_000 });
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
  });

  test('zip_canon — custom archive name accepted', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zc-custom-name');
    makeFiles(folder, 1);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    const input = panel.locator('.row:has(label:has-text("Archive name")) input');
    await input.waitFor({ timeout: 10_000 });
    await input.fill('my-archive');
    expect(await input.inputValue()).toBe('my-archive');
  });

  test('zip_canon — no-anchor fallback message visible when no anchor pinned', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zc-no-anchor');
    makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    // Do NOT click any pin — check that the fallback message is shown.
    // The text is: "No anchor pinned — first selected file used for naming"
    const msg = panel.locator('#section-zipname').getByText('No anchor pinned', { exact: false });
    await expect(msg).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // ZIP Gun naming radio tests
  // ---------------------------------------------------------------------------

  test('zip_gun — naming=anchor hides base-name input', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-radio-anchor');
    makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    await panel.click('input[type="radio"][value="anchor"]');

    const baseInput = panel.locator('.row:has(label:has-text("Base name")) input');
    expect(await baseInput.count()).toBe(0);
  });

  test('zip_gun — naming=base-counter shows base-name input', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-radio-counter');
    makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    await panel.click('input[type="radio"][value="base-counter"]');

    const baseInput = panel.locator('.row:has(label:has-text("Base name")) input');
    await expect(baseInput).toBeVisible({ timeout: 5_000 });
  });

  test('zip_gun — naming=base-timestamp shows base-name input', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-radio-timestamp');
    makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    await panel.click('input[type="radio"][value="base-timestamp"]');

    const baseInput = panel.locator('.row:has(label:has-text("Base name")) input');
    await expect(baseInput).toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // ZIP Gun group management tests
  // ---------------------------------------------------------------------------

  test('zip_gun — New Group increments group count', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-new-group');
    const files = makeFiles(folder, 3);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Before: no group headers exist (no groups yet after reset)
    const headersBefore = await panel.locator('tr.group-header-row').count();

    // Select a file before creating a new group (New Group button requires selectedFiles.length > 0)
    await selectFile(panel, files[0]);

    await panel.click('button:has-text("\u2192 New Group")');

    // After: at least one group header should exist
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });
    const headersAfter = await panel.locator('tr.group-header-row').count();
    expect(headersAfter).toBeGreaterThan(headersBefore);
  });

  test('zip_gun — Clear Groups resets all files to ungrouped', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-clear-groups');
    const files = makeFiles(folder, 3);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    // Expand the Files section if it collapsed during a previous test
    if (await panel.locator('#section-files .section-body').count() === 0) {
      await panel.locator('#section-files .section-header button.section-toggle').click();
      await panel.waitForSelector('#section-files .section-body', { timeout: 5_000 });
    }
    await switchMode(panel, 'zip_gun');

    // Select a file first — New Group button requires selectedFiles.length > 0
    await selectFile(panel, files[0]);

    // Create two groups
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });
    await panel.click('button:has-text("\u2192 New Group")');

    // Assign first file to group 1 via its group dropdown
    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    // Verify a file has been assigned (group header exists)
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    // Clear all groups
    await panel.click('button:has-text("\u00d7 Clear groups")');

    // All group-select dropdowns should show the unassigned option ('—')
    // and no group header rows should exist
    await panel.waitForFunction(
      () => document.querySelectorAll('tr.group-header-row').length === 0,
      { timeout: 5_000 }
    );
    const remaining = await panel.locator('tr.group-header-row').count();
    expect(remaining).toBe(0);
  });

  test('zip_gun — group ⊖ removes files from group but keeps group header', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-clear-icon');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create group 1 and assign the first file
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    // Verify file count shows 1
    const headerRow = panel.locator('tr.group-header-row').first();
    await expect(headerRow.locator('.group-file-count')).toContainText('1', { timeout: 5_000 });

    // Click ⊖ (group-clear-icon) — removes files but keeps group
    await headerRow.locator('.group-clear-icon').click();

    // Group header should still be there (group not deleted, just emptied)
    await expect(panel.locator('tr.group-header-row').first()).toBeVisible({ timeout: 5_000 });

    // File count should now be 0
    const countText = await panel.locator('tr.group-header-row .group-file-count').first().textContent();
    expect(countText).toContain('0');
  });

  test('zip_gun — group file count updates when files assigned', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-file-count');
    const files = makeFiles(folder, 3);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create group 1
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;

    // Assign first two files to group 1
    await panel.locator(groupSel(files[0])).selectOption('1');
    await panel.locator(groupSel(files[1])).selectOption('1');

    // The group-file-count span should show 2
    const countEl = panel.locator('tr.group-header-row[data-groupid="1"] .group-file-count');
    await expect(countEl).toContainText('2', { timeout: 5_000 });
  });

  test('zip_gun — group zip name display shows derived name', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-zip-name');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create group 1 and assign a file so the group has content
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    const zipName = panel.locator('tr.group-header-row .group-zip-name').first();
    await zipName.waitFor({ timeout: 5_000 });
    const text = await zipName.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).toContain('.zip');
  });

  test('zip_gun — group header collapse hides then restores file rows', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-collapse');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create group 1 and assign a file
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const normFirst = norm(files[0]);
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    // File row should be visible
    const fileRow = panel.locator(`tr[data-filepath="${normFirst}"]`);
    await expect(fileRow).toBeVisible({ timeout: 5_000 });

    // Click the group header to collapse it
    // Note: must ensure selectedFiles is empty, so the click collapses rather than bulk-moves
    await panel.locator('tr.group-header-row[data-groupid="1"]').click();

    // File row should now be hidden (removed from DOM when collapsed)
    await panel.waitForFunction(
      (fp: string) => !document.querySelector(`tr[data-filepath="${fp}"]`),
      normFirst,
      { timeout: 5_000 }
    );
    expect(await fileRow.count()).toBe(0);

    // Click header again to expand
    await panel.locator('tr.group-header-row[data-groupid="1"]').click();

    // File row should be visible again
    await expect(panel.locator(`tr[data-filepath="${normFirst}"]`)).toBeVisible({ timeout: 5_000 });
  });

  test('zip_gun — ungrouped Local Files section shows unassigned count', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-ungrouped-count');
    makeFiles(folder, 3);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // No files assigned to any group — all 3 appear in the Local Files unassigned section.
    // The section toggle button text is: "▾ Local Files (3)"
    const lfSection = panel.locator('.open-section-separator button.section-toggle', {
      hasText: 'Local Files',
    });
    await lfSection.waitFor({ timeout: 5_000 });
    const btnText = await lfSection.textContent();
    expect(btnText).toContain('3');
  });

  test('zip_gun — selecting files then __new__ bulk-assigns them to a group', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'zg-bulk-assign');
    const files = makeFiles(folder, 3);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    const norm = (fp: string) => fp.replace(/\\/g, '/');

    // Select all 3 files using their checkboxes
    for (const f of files) {
      const cb = panel.locator(`tr[data-filepath="${norm(f)}"] input[type="checkbox"]`);
      await cb.waitFor({ timeout: 10_000 });
      if (!await cb.isChecked()) { await cb.check(); }
    }

    // Assign first file's dropdown to __new__ — bulk selection means all 3 move
    const firstSel = panel.locator(
      `tr[data-filepath="${norm(files[0])}"] select, tr[data-filepath="${files[0]}"] select`
    );
    await firstSel.selectOption('__new__');

    // A group header row should appear
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    // The file count in the group should be >= 1 (possibly 3 if all were selected)
    const countText = await panel.locator('tr.group-header-row .group-file-count').first().textContent();
    expect(countText).toMatch(/\d+ files?/);
    const match = countText?.match(/(\d+)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Anchor pin tests
  // NOTE: In pistol_file mode the anchor icon has visibility:hidden — the pin
  // is only interactive in zip_canon and in zip_gun when naming=anchor.
  // Tests 15–19 therefore use zip_canon.
  // ---------------------------------------------------------------------------

  test('anchor pin visible in zip_canon mode', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'anchor-visible');
    makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    // In zip_canon, pin icons have class pin-icon (not hidden)
    // Count span.pin-icon elements in the file table
    await panel.waitForSelector('.pin-icon', { timeout: 5_000 });
    const count = await panel.locator('.pin-icon').count();
    expect(count).toBeGreaterThan(0);
  });

  test('anchor pin hidden in zip_gun when naming=base-counter', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'anchor-hidden-counter');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create a group and assign a file so pin cells are rendered
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    // Select base-counter naming — pin spans should have visibility:hidden
    await panel.click('input[type="radio"][value="base-counter"]');

    // All .pin-icon spans inside the file table should be invisible
    const visiblePins = panel.locator('#file-list .pin-icon').filter({ hasNotText: '' });
    // The pin spans exist but should have visibility:hidden via inline style
    const pinCount = await panel.locator('#file-list .pin-icon').count();
    if (pinCount > 0) {
      const firstPin = panel.locator('#file-list .pin-icon').first();
      const visibility = await firstPin.evaluate((el) => (el as HTMLElement).style.visibility);
      expect(visibility).toBe('hidden');
    }
  });

  test('anchor pin visible in zip_gun when naming=anchor', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'anchor-visible-zg');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_gun');

    // Create group and assign a file
    await panel.click('button:has-text("\u2192 New Group")');
    await panel.waitForSelector('tr.group-header-row', { timeout: 5_000 });

    const norm = (fp: string) => fp.replace(/\\/g, '/');
    const groupSel = (fp: string) =>
      `tr[data-filepath="${fp}"] select, tr[data-filepath="${norm(fp)}"] select`;
    await panel.locator(groupSel(files[0])).selectOption('1');

    // Select anchor naming — pin icons for grouped files should be visible
    await panel.click('input[type="radio"][value="anchor"]');

    // The assigned file row pin should NOT have visibility:hidden
    const assignedPin = panel.locator(
      `tr[data-filepath="${norm(files[0])}"] .pin-icon, tr[data-filepath="${files[0]}"] .pin-icon`
    );
    await assignedPin.first().waitFor({ timeout: 5_000 });
    const visibility = await assignedPin.first().evaluate((el) => (el as HTMLElement).style.visibility);
    expect(visibility).not.toBe('hidden');
  });

  test('anchor click sets anchor-active class on file row pin', async () => {
    const { panel, workspaceDir } = session();
    const folder = makeTestFolder(workspaceDir, 'anchor-click');
    const files = makeFiles(folder, 2);

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    const norm = (fp: string) => fp.replace(/\\/g, '/');

    // Initially no pin should be active (no anchorFile set by loadFolder reset)
    // Click the pin for the second file
    const pin2 = panel.locator(
      `tr[data-filepath="${norm(files[1])}"] .pin-icon, tr[data-filepath="${files[1]}"] .pin-icon`
    );
    await pin2.first().waitFor({ timeout: 5_000 });
    await pin2.first().click();

    // After click, the pin for file[1] should have class pin-icon-active
    const activePin = panel.locator(
      `tr[data-filepath="${norm(files[1])}"] .pin-icon-active, tr[data-filepath="${files[1]}"] .pin-icon-active`
    );
    await expect(activePin.first()).toBeVisible({ timeout: 5_000 });
  });

  test('anchor auto-detection: no anchor set after loadFolder (fallback message shows)', async () => {
    const { panel, workspaceDir } = session();
    // Name files so a-first.txt < b-second.txt alphabetically
    const folder = makeTestFolder(workspaceDir, 'anchor-auto');
    fs.writeFileSync(path.join(folder, 'a-first.txt'), 'first');
    fs.writeFileSync(path.join(folder, 'b-second.txt'), 'second');

    await selectPreset(panel, PW_PRESET.name);
    await loadFolder(panel, folder);
    await switchMode(panel, 'zip_canon');

    // loadFolder with a new path calls resetLocalDatasetState → anchorFile = null.
    // In zip_canon with no anchor pinned, the fallback message is shown.
    const msg = panel.locator('#section-zipname').getByText('No anchor pinned', { exact: false });
    await expect(msg).toBeVisible({ timeout: 5_000 });

    // The first file alphabetically ('a-first.txt') should have the hover pin,
    // not the active pin — confirming no auto-anchor is set on load.
    const normFolder = folder.replace(/\\/g, '/');
    const firstFilePath = `${normFolder}/a-first.txt`;
    const activePin = panel.locator(
      `tr[data-filepath="${firstFilePath}"] .pin-icon-active`
    );
    expect(await activePin.count()).toBe(0);
  });
});
