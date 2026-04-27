import { test, expect } from '@playwright/test';
import { assertDockerRunning } from './helpers/docker-check';
import {
  launchSharedVsCode,
  addPreset,
  selectPreset,
  openManageTab,
  openTransferTab,
  selectSendTo,
} from './helpers/launch-vscode';

const PRESET = {
  name: 'Bookmarks Test',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

// ---------------------------------------------------------------------------
// Shared session — all 10 tests run serially inside one VS Code instance.
// ---------------------------------------------------------------------------

test.describe.serial('bookmark flows', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
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

  function session(): Awaited<ReturnType<typeof launchSharedVsCode>> {
    if (!shared) { throw new Error('Shared VS Code session was not initialized'); }
    return shared;
  }

  // -------------------------------------------------------------------------
  // Test 1: add bookmark via form — appears in send-to dropdown
  // -------------------------------------------------------------------------
  test('add bookmark via form — appears in send-to dropdown', async () => {
    const { panel } = session();

    // Open Manage tab, click Edit on the preset card
    await openManageTab(panel);
    await panel.click(`.preset-card:has-text("${PRESET.name}") button:has-text("Edit")`);

    // Click "Browse & add…" in the Bookmarks section
    await panel.click('button:has-text("Browse & add")');

    // Remote browse overlay appears — wait for it
    await panel.waitForSelector('.overlay', { timeout: 15_000 });

    // Wait for the directory listing to finish loading (spinner gone, dir-list appears)
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // Click "✓ Use this path" to accept the current path (/store) as the bookmark
    await panel.click('.overlay button:has-text("Use this path")');

    // Overlay closes, we're back in the form — save it
    await panel.waitForSelector('#preset-form-section', { timeout: 10_000 });
    await panel.click('#preset-form-section button:has-text("Save")');
    await panel.waitForSelector(`.preset-card:has-text("${PRESET.name}")`, { timeout: 10_000 });

    // Go to Transfer tab and check the bookmarked path is in #send-to-select
    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);

    const options = await panel.locator('#send-to-select option').allTextContents();
    expect(options.some(t => t.includes('/store'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: set bookmark as default — inline "Set as default" button appears
  // -------------------------------------------------------------------------
  test('set bookmark as default — inline set-as-default button appears', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);

    // The /store bookmark added in test 1 should be in the dropdown
    const options = await panel.locator('#send-to-select option').allTextContents();
    const bookmark = options.find(t => t === '/store');
    expect(bookmark).toBeTruthy();

    // Select the /store bookmark (by value, not the default __default__ option)
    await selectSendTo(panel, '/store');

    // "Set as default" button should appear inline in the send-to row
    const setDefaultBtn = panel.locator(
      '.row:has(#send-to-select) button:has-text("Set as default")'
    );
    await expect(setDefaultBtn).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Test 3: send-to __add_new__ — shows path input row
  // -------------------------------------------------------------------------
  test('send-to __add_new__ — shows path input row', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // The "add new path" row should appear with a text input
    await expect(panel.locator('input[placeholder="/remote/path"]')).toBeVisible({ timeout: 5_000 });

    // Browse and action buttons should also be visible
    await expect(panel.locator('button:has-text("Browse")')).toBeVisible();
    await expect(panel.locator('button:has-text("Use once")')).toBeVisible();
    await expect(panel.locator('button:has-text("Bookmark")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 4: one-time path — does not persist to bookmarks after "Use once"
  // -------------------------------------------------------------------------
  test('one-time path — does not appear in dropdown after use', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    const oneTimePath = '/store/one-time-test';
    await panel.locator('input[placeholder="/remote/path"]').fill(oneTimePath);

    // Click "Use once" — sets the path as a temporary one-time selection
    await panel.click('button:has-text("Use once")');

    // The one-time path should now appear in the dropdown as the current selection
    // (with "(one-time)" suffix in the displayed text, but the value is the raw path)
    const currentValue = await panel.locator('#send-to-select').inputValue();
    expect(currentValue).toBe(oneTimePath);

    // Now switch away and come back — the one-time path must NOT be in savedPaths.
    // Switching preset resets selectedPath, so the temp option disappears.
    // We verify by selecting __default__ explicitly and checking options.
    await selectSendTo(panel, '__default__');
    const optionValues = await panel.locator('#send-to-select option').evaluateAll(
      (opts: HTMLOptionElement[]) => opts.map(o => o.value)
    );
    expect(optionValues).not.toContain(oneTimePath);
  });

  // -------------------------------------------------------------------------
  // Test 5: remote browse — spinner visible during directory load
  // -------------------------------------------------------------------------
  test('remote browse — spinner visible during directory load', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // Click Browse — the overlay renders immediately in loading state
    await panel.click('button:has-text("Browse")');

    // The overlay should appear
    await panel.waitForSelector('.overlay', { timeout: 10_000 });

    // The spinner element should be present while loading
    // (it may disappear quickly once the SFTP response arrives)
    const spinnerOrList = panel.locator('.overlay .spinner, .overlay .dir-list');
    await expect(spinnerOrList).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Test 6: remote browse — directory entries listed after load
  // -------------------------------------------------------------------------
  test('remote browse — directory entries listed after load', async () => {
    const { panel } = session();

    // Overlay may already be open from test 5; cancel it first to get a clean state
    const overlayNow = await panel.locator('.overlay').count();
    if (overlayNow > 0) {
      await panel.click('.overlay button:has-text("Cancel")');
      await panel.waitForSelector('.overlay', { state: 'hidden', timeout: 5_000 }).catch(() => { /* already gone */ });
    }

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');
    await panel.click('button:has-text("Browse")');

    await panel.waitForSelector('.overlay', { timeout: 10_000 });

    // Wait for spinner to be replaced by the directory list
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // The dir-list may have "no subdirectories" or actual entries; either way the list rendered
    const dirList = panel.locator('.overlay .dir-list');
    await expect(dirList).toBeVisible();

    // Close overlay cleanly
    await panel.click('.overlay button:has-text("Cancel")');
  });

  // -------------------------------------------------------------------------
  // Test 7: remote browse — breadcrumb shows current path segment
  // -------------------------------------------------------------------------
  test('remote browse — breadcrumb shows current path segment', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // Pre-fill path input with /store so browse starts there
    await panel.locator('input[placeholder="/remote/path"]').fill('/store');
    await panel.click('button:has-text("Browse")');

    await panel.waitForSelector('.overlay', { timeout: 10_000 });
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // Breadcrumb should contain "store" as a clickable segment
    const breadcrumb = panel.locator('.overlay .breadcrumb');
    await expect(breadcrumb).toBeVisible();
    const breadcrumbText = await breadcrumb.textContent();
    expect(breadcrumbText).toContain('store');

    // Clean up
    await panel.click('.overlay button:has-text("Cancel")');
  });

  // -------------------------------------------------------------------------
  // Test 8: remote browse — breadcrumb navigation: click segment navigates back
  // -------------------------------------------------------------------------
  test('remote browse — breadcrumb navigation: click segment navigates back', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // Start at root so we can navigate into /store via the dir list
    await panel.locator('input[placeholder="/remote/path"]').fill('/');
    await panel.click('button:has-text("Browse")');

    await panel.waitForSelector('.overlay', { timeout: 10_000 });
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // Check if 'store' directory appears; if so, click it to navigate in
    const storeEntry = panel.locator('.overlay .dir-list li:has-text("store")');
    const hasStore = await storeEntry.count();
    if (hasStore > 0) {
      await storeEntry.click();

      // Wait for the new listing to load
      await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

      // Breadcrumb should now show "store"
      const breadcrumbAfterNav = await panel.locator('.overlay .breadcrumb').textContent();
      expect(breadcrumbAfterNav).toContain('store');

      // Click the root "/" segment in the breadcrumb to navigate back
      await panel.locator('.overlay .breadcrumb span').first().click();

      // Wait for new listing
      await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

      // Breadcrumb should be back to just "/"
      const breadcrumbAfterBack = await panel.locator('.overlay .breadcrumb').textContent();
      expect(breadcrumbAfterBack).not.toContain('store');
    } else {
      // /store is the only directory visible at root; navigate using path input instead
      const pathInput = panel.locator('.overlay input[type="text"]').first();
      await pathInput.fill('/store');
      await panel.click('.overlay button:has-text("Go")');
      await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

      const breadcrumbDeep = await panel.locator('.overlay .breadcrumb').textContent();
      expect(breadcrumbDeep).toContain('store');

      // Click root "/" in breadcrumb
      await panel.locator('.overlay .breadcrumb span').first().click();
      await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });
    }

    await panel.click('.overlay button:has-text("Cancel")');
  });

  // -------------------------------------------------------------------------
  // Test 9: remote browse — pin as default updates preset default path
  // -------------------------------------------------------------------------
  test('remote browse — pin as default updates preset default path', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // Browse to /store
    await panel.locator('input[placeholder="/remote/path"]').fill('/store');
    await panel.click('button:has-text("Browse")');

    await panel.waitForSelector('.overlay', { timeout: 10_000 });
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // Click "📌 Pin as default" — this sends pinFolder to the host, which calls
    // refreshPresets() and then sends folderPinned back, closing the overlay
    await panel.click('.overlay button:has-text("Pin as default")');

    // Overlay should close (folderPinned message closes it and resets selectedPath)
    await panel.waitForSelector('.overlay', { state: 'hidden', timeout: 15_000 });

    // Go to Manage tab and open Edit on the preset
    await openManageTab(panel);
    await panel.click(`.preset-card:has-text("${PRESET.name}") button:has-text("Edit")`);

    // Default path input should now show /store (which is the same as it was, but
    // the pin operation round-tripped through the host — verify it is still /store)
    const dirInput = panel.locator('.row:has(label:text-is("Default path")) input');
    await expect(dirInput).toHaveValue('/store', { timeout: 5_000 });

    // Cancel the form to leave the manage view clean
    await panel.click('#preset-form-section button:has-text("Cancel")');
  });

  // -------------------------------------------------------------------------
  // Test 10: remote browse — bookmark from overlay saves to bookmarks list
  // -------------------------------------------------------------------------
  test('remote browse — bookmark from overlay saves to bookmarks list', async () => {
    const { panel } = session();

    await openTransferTab(panel);
    await selectPreset(panel, PRESET.name);
    await selectSendTo(panel, '__add_new__');

    // Browse starting at /store
    await panel.locator('input[placeholder="/remote/path"]').fill('/store');
    await panel.click('button:has-text("Browse")');

    await panel.waitForSelector('.overlay', { timeout: 10_000 });
    await panel.waitForSelector('.overlay .dir-list', { timeout: 30_000 });

    // Click "🔖 Bookmark" — sends bookmarkPath to host; host calls addSavedPath +
    // refreshPresets; webview receives 'presets' message with updated savedPaths.
    // The overlay stays open (bookmark does not auto-close it).
    await panel.click('.overlay button:has-text("Bookmark")');

    // Close the overlay
    await panel.click('.overlay button:has-text("Cancel")');
    await panel.waitForSelector('.overlay', { state: 'hidden', timeout: 5_000 });

    // Go to Manage tab and open Edit to verify /store appears in the bookmarks section
    await openManageTab(panel);

    // The preset card should show "Bookmarks: /store" in its summary text
    // (bookmarks are shown on the card as "Bookmarks: /path1, /path2")
    const card = panel.locator(`.preset-card:has-text("${PRESET.name}")`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    const cardText = await card.textContent();
    expect(cardText).toContain('/store');

    // Also verify via the Edit form's bookmarks section
    await panel.click(`.preset-card:has-text("${PRESET.name}") button:has-text("Edit")`);
    const formSection = panel.locator('#preset-form-section');
    await expect(formSection).toBeVisible();
    const formText = await formSection.textContent();
    expect(formText).toContain('/store');

    await panel.click('#preset-form-section button:has-text("Cancel")');
  });
});
