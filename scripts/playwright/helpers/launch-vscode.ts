import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** Resolves the VS Code CLI executable path on Windows. */
function resolveCodeExe(): string {
  try {
    // execFileSync with 'where' — no shell, no injection risk
    const out = execFileSync('where', ['code'], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch { /* fall through */ }

  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(local, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'VS Code executable not found. Ensure VS Code is installed and `code` is on PATH.'
  );
}

/**
 * Launches the Extension Development Host.
 *
 * @param testFiles - Absolute paths to files VS Code should open in editors.
 *   These appear in the webview's "open files" list without requiring native dialogs.
 */
export async function launchVsCode(
  testFiles: string[] = []
): Promise<{ app: ElectronApplication; cleanup: () => void }> {
  const extensionRoot = path.resolve(__dirname, '..', '..', '..');
  const workspaceDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-e2e-ws-'));
  const userDataDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-e2e-user-'));

  const app = await electron.launch({
    executablePath: resolveCodeExe(),
    args: [
      `--extensionDevelopmentPath=${extensionRoot}`,
      '--disable-extensions',
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      workspaceDir,
      ...testFiles,
    ],
  });

  const cleanup = (): void => {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  return { app, cleanup };
}

/**
 * Opens the SFTP Zip Gun panel via keyboard shortcut (Ctrl+Shift+U)
 * and returns the webview BrowserWindow Page.
 */
export async function openPanelAndFindWebview(
  app: ElectronApplication,
  mainWindow: Page
): Promise<Page> {
  const [firstWindow] = await Promise.all([
    app.waitForEvent('window'),
    mainWindow.keyboard.press('Control+Shift+U'),
  ]);

  // Verify this is the webview; if VS Code opened a different window first,
  // scan all windows to find the one containing #app.
  const isWebview = await firstWindow.locator('#app').waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  if (isWebview) return firstWindow;

  for (const w of app.windows()) {
    const has = await w.locator('#app').waitFor({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (has) return w;
  }

  throw new Error('SFTP Zip Gun webview window (#app) not found after Ctrl+Shift+U');
}

/**
 * Adds a preset through the Manage Connections tab.
 * Returns to the Transfer Files tab when done.
 */
export async function addPreset(
  panel: Page,
  preset: {
    name: string;
    host: string;
    port: number;
    username: string;
    remoteDir: string;
    authType: 'password' | 'key';
    keyPath?: string;
    password?: string;
  }
): Promise<void> {
  await panel.click('.view-tab:has-text("Manage connections")');
  await panel.click('button:has-text("+ Add Account")');

  await panel.locator('.row:has(label:has-text("Name")) input').fill(preset.name);
  await panel.locator('.row:has(label:has-text("Host")) input').fill(preset.host);
  await panel.locator('.row:has(label:has-text("Port")) input').fill(String(preset.port));
  await panel.locator('.row:has(label:has-text("Username")) input').fill(preset.username);
  await panel.locator('.row:has(label:has-text("Default path")) input').fill(preset.remoteDir);

  if (preset.authType === 'key') {
    await panel.click('input[type="radio"][value="key"]');
    await panel.locator('#f-auth-fields input[type="text"]').fill(preset.keyPath ?? '');
  } else {
    await panel.click('input[type="radio"][value="password"]');
    if (preset.password) {
      await panel.locator('#f-auth-fields input[type="password"]').fill(preset.password);
    }
  }

  await panel.click('#preset-form-section button:has-text("Save")');
  await panel.waitForSelector(`.preset-card:has-text("${preset.name}")`, { timeout: 15_000 });

  // Return to Transfer tab
  await panel.click('.view-tab:has-text("Transfer files")');
}

/** Selects a preset from the Account dropdown. */
export async function selectPreset(panel: Page, presetName: string): Promise<void> {
  await panel.selectOption('#preset-select', { label: new RegExp(presetName) });
}

/**
 * Checks the file row checkbox for the given absolute path.
 * The file must have been launched as a VS Code CLI arg (open in an editor).
 */
export async function selectFile(panel: Page, absPath: string): Promise<void> {
  const norm = absPath.replace(/\\/g, '/');
  // Try Windows path first, then forward-slash normalized
  let cb = panel.locator(`tr[data-filepath="${absPath}"] input[type="checkbox"]`);
  if ((await cb.count()) === 0) {
    cb = panel.locator(`tr[data-filepath="${norm}"] input[type="checkbox"]`);
  }
  await cb.waitFor({ timeout: 10_000 });
  if (!await cb.isChecked()) {
    await cb.check();
  }
}
