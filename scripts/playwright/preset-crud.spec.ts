import { test, expect } from '@playwright/test';
import { launchVsCode, openPanelAndFindWebview, addPreset } from './helpers/launch-vscode';

const BASE_PRESET = {
  name: 'CRUD Test',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/store',
  authType: 'password' as const,
  password: 'pwpass',
};

test.describe('preset CRUD', () => {
  test('add preset — appears in dropdown', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, BASE_PRESET);

      const options = await panel.locator('#preset-select option').allTextContents();
      expect(options.some(t => t.includes(BASE_PRESET.name))).toBe(true);
    } finally {
      cleanup();
      await app.close();
    }
  });

  test('edit preset name — renamed entry appears in dropdown', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, BASE_PRESET);
      await panel.click('.view-tab:has-text("Manage connections")');
      await panel.click(`.preset-card:has-text("${BASE_PRESET.name}") button:has-text("Edit")`);

      const nameField = panel.locator('.row:has(label:text-is("Name")) input');
      await nameField.clear();
      await nameField.fill('CRUD Test Renamed');

      await panel.click('#preset-form-section button:has-text("Save")');
      await panel.waitForSelector('.preset-card:has-text("CRUD Test Renamed")', { timeout: 10_000 });

      await panel.click('.view-tab:has-text("Transfer files")');
      const options = await panel.locator('#preset-select option').allTextContents();
      expect(options.some(t => t.includes('CRUD Test Renamed'))).toBe(true);
      expect(options.some(t => t.trim() === BASE_PRESET.name)).toBe(false);
    } finally {
      cleanup();
      await app.close();
    }
  });

  test('delete preset — dropdown shows "No accounts configured"', async () => {
    const { app, cleanup } = await launchVsCode();
    try {
      const mainWindow = await app.firstWindow();
      await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
      const panel = await openPanelAndFindWebview(app, mainWindow);

      await addPreset(panel, BASE_PRESET);
      await panel.click('.view-tab:has-text("Manage connections")');
      await panel.click(`.preset-card:has-text("${BASE_PRESET.name}") button:has-text("Delete")`);
      await panel.click('button:has-text("Yes, delete")');

      await expect(
        panel.locator(`.preset-card:has-text("${BASE_PRESET.name}")`)
      ).toHaveCount(0, { timeout: 10_000 });

      await panel.click('.view-tab:has-text("Transfer files")');
      const selectText = await panel.locator('#preset-select').textContent();
      expect(selectText).toContain('No accounts configured');
    } finally {
      cleanup();
      await app.close();
    }
  });
});
