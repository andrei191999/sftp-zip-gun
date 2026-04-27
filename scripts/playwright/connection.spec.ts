import { test, expect } from '@playwright/test';
import {
  launchSharedVsCode,
  addPreset,
  openManageTab,
  openTransferTab,
} from './helpers/launch-vscode';
import { assertDockerRunning } from './helpers/docker-check';

// ---------------------------------------------------------------------------
// Preset fixtures
// ---------------------------------------------------------------------------

const VALID_PRESET = {
  name: 'Conn Valid',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

const BAD_PRESET = {
  name: 'Conn Bad',
  host: '127.0.0.1',
  port: 9999, // nothing listening
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'wrongpass',
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial('connection and preset management', () => {
  let shared: Awaited<ReturnType<typeof launchSharedVsCode>> | undefined;

  test.beforeAll(async () => {
    assertDockerRunning();
    shared = await launchSharedVsCode();
  });

  test.afterAll(async () => {
    if (!shared) { return; }
    try { await shared.app.close(); } finally { shared.cleanup(); }
  });

  function session() {
    if (!shared) { throw new Error('session not initialized'); }
    return shared;
  }

  // -------------------------------------------------------------------------
  // Test 1 — successful connection shows ✓ indicator on the card
  // -------------------------------------------------------------------------
  test('connection test — success shows ✓ indicator on preset card', async () => {
    const { panel } = session();

    // addPreset navigates to Manage tab, adds preset, and returns to Transfer
    await addPreset(panel, VALID_PRESET);

    // Go back to Manage tab to see the card
    await openManageTab(panel);

    // After save, the extension auto-tests the connection. Wait for the
    // conn-ok indicator to appear on the VALID_PRESET card.
    await panel.waitForSelector(
      `.preset-card:has-text("${VALID_PRESET.name}") .conn-ok`,
      { timeout: 20_000 }
    );

    const count = await panel
      .locator(`.preset-card:has-text("${VALID_PRESET.name}") .conn-ok`)
      .count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 2 — failed connection shows ✗ indicator on the card
  // -------------------------------------------------------------------------
  test('connection test — failure shows ✗ indicator on preset card', async () => {
    const { panel } = session();

    await addPreset(panel, BAD_PRESET);
    await openManageTab(panel);

    // Bad preset auto-tests on save; port 9999 has nothing listening, so it
    // will fail fast. Allow 20 s for the host to time out and send the result.
    await panel.waitForSelector(
      `.preset-card:has-text("${BAD_PRESET.name}") .conn-fail`,
      { timeout: 20_000 }
    );

    const count = await panel
      .locator(`.preset-card:has-text("${BAD_PRESET.name}") .conn-fail`)
      .count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 3 — Transfer tab dropdown shows ⚠ prefix for the failed preset
  // -------------------------------------------------------------------------
  test('preset dropdown — warning icon shown for failed preset', async () => {
    const { panel } = session();

    // BAD_PRESET already failed in test 2; its connectionStatus is 'fail'
    await openTransferTab(panel);

    // The option text for a failed preset is prefixed with '⚠ ' (U+26A0 + space)
    const optionText = await panel
      .locator(`#preset-select option[value="${BAD_PRESET.name}"]`)
      .evaluate((el: HTMLOptionElement) => el.textContent ?? '');

    expect(optionText.startsWith('\u26A0 ')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4 — read-only badge (.badge-readonly) visible on preset card
  // -------------------------------------------------------------------------
  test('read-only badge visible on preset card', async () => {
    const { panel } = session();

    // Fill the preset form manually so we can tick the read-only checkbox.
    // addPreset does not expose that field, so we drive the form directly.
    await openManageTab(panel);
    await panel.click('button:has-text("+ Add Account")');

    await panel.locator('.row:has(label:text-is("Name")) input').fill('Conn ReadOnly');
    await panel.locator('.row:has(label:text-is("Host")) input').fill('127.0.0.1');
    await panel.locator('.row:has(label:text-is("Port")) input').fill('2222');
    await panel.locator('.row:has(label:text-is("Username")) input').fill('pwuser');
    await panel.locator('.row:has(label:text-is("Default path")) input').fill('/store');
    await panel.click('input[type="radio"][value="password"]');
    await panel.locator('#f-auth-fields input[type="password"]').fill('pwpass');

    // Tick the "Drop-box server (no stat/delete)" checkbox
    const readonlyCheckbox = panel.locator(
      '#preset-form-section label:has-text("Drop-box") input[type="checkbox"]'
    );
    await readonlyCheckbox.check();

    await panel.click('#preset-form-section button:has-text("Save")');
    await panel.waitForSelector('.preset-card:has-text("Conn ReadOnly")', { timeout: 30_000 });

    // The card should now contain a .badge-readonly element
    const badgeCount = await panel
      .locator('.preset-card:has-text("Conn ReadOnly") .badge-readonly')
      .count();
    expect(badgeCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 5 — read-only checkbox is pre-checked when editing a read-only preset
  // -------------------------------------------------------------------------
  test('read-only checkbox pre-checked on Edit of read-only preset', async () => {
    const { panel } = session();

    await openManageTab(panel);
    await panel.click('.preset-card:has-text("Conn ReadOnly") button:has-text("Edit")');

    const readonlyCheckbox = panel.locator(
      '#preset-form-section label:has-text("Drop-box") input[type="checkbox"]'
    );
    const isChecked = await readonlyCheckbox.isChecked();
    expect(isChecked).toBe(true);

    // Cancel the edit to avoid side effects
    await panel.click('#preset-form-section button:has-text("Cancel")');
    await panel.waitForSelector('button:has-text("+ Add Account")', { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Test 6 — preset list count increases after add
  // -------------------------------------------------------------------------
  test('preset list count increases after add', async () => {
    const { panel } = session();

    await openManageTab(panel);
    const countBefore = await panel.locator('.preset-card').count();

    await addPreset(panel, {
      name: 'Conn Temp',
      host: '127.0.0.1',
      port: 2222,
      username: 'pwuser',
      remoteDir: '/store',
      authType: 'password' as const,
      password: 'pwpass',
    });

    await openManageTab(panel);
    const countAfter = await panel.locator('.preset-card').count();
    expect(countAfter).toBe(countBefore + 1);
  });

  // -------------------------------------------------------------------------
  // Test 7 — preset list count decreases after delete
  // -------------------------------------------------------------------------
  test('preset list count decreases after delete', async () => {
    const { panel } = session();

    await openManageTab(panel);
    const countBefore = await panel.locator('.preset-card').count();

    // Click Delete, then confirm
    await panel.click('.preset-card:has-text("Conn Temp") button:has-text("Delete")');
    await panel.click('button:has-text("Yes, delete")');

    await expect(
      panel.locator('.preset-card:has-text("Conn Temp")')
    ).toHaveCount(0, { timeout: 10_000 });

    const countAfter = await panel.locator('.preset-card').count();
    expect(countAfter).toBe(countBefore - 1);
  });

  // -------------------------------------------------------------------------
  // Test 8 — NEW badge visible immediately after adding a preset
  // -------------------------------------------------------------------------
  test('NEW badge visible immediately after adding preset', async () => {
    const { panel } = session();

    await addPreset(panel, {
      name: 'Conn New Badge',
      host: '127.0.0.1',
      port: 2222,
      username: 'pwuser',
      remoteDir: '/store',
      authType: 'password' as const,
      password: 'pwpass',
    });

    await openManageTab(panel);

    // The NEW badge should be present immediately after add
    await panel.waitForSelector(
      '.preset-card:has-text("Conn New Badge") .badge-new',
      { timeout: 10_000 }
    );

    const count = await panel
      .locator('.preset-card:has-text("Conn New Badge") .badge-new')
      .count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 9 — NEW badge removed after editing the preset
  // -------------------------------------------------------------------------
  test('NEW badge removed after editing preset', async () => {
    const { panel } = session();

    await openManageTab(panel);

    // Click Edit on the Conn New Badge card (this also clears the badge in state)
    await panel.click('.preset-card:has-text("Conn New Badge") button:has-text("Edit")');

    // Rename the preset to confirm save is required to clear the badge
    const nameField = panel.locator('.row:has(label:text-is("Name")) input');
    await nameField.clear();
    await nameField.fill('Conn New Badge 2');

    await panel.click('#preset-form-section button:has-text("Save")');
    await panel.waitForSelector('.preset-card:has-text("Conn New Badge 2")', { timeout: 30_000 });

    // Ensure the renamed card has no .badge-new
    const count = await panel
      .locator('.preset-card:has-text("Conn New Badge 2") .badge-new')
      .count();
    expect(count).toBe(0);
  });
});
