import { _electron as electron, ElectronApplication, Frame, Locator, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

type PanelTarget = Frame | Page;
type UploadMode = 'pistol_file' | 'zip_canon' | 'zip_gun';

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
 * Returns `workspaceDir` — place test files there before calling
 * `openPanelAndFindWebview` so the extension finds them via the local
 * folder listing in the panel's `ready` handler.
 */
export async function launchVsCode(): Promise<{
  app: ElectronApplication;
  cleanup: () => void;
  workspaceDir: string;
}> {
  const extensionRoot = path.resolve(__dirname, '..', '..', '..');
  const workspaceDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-e2e-ws-'));
  const userDataDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-e2e-user-'));

  // Pre-write VS Code user settings to suppress dialogs that block test flow.
  const vscodeUserDir = path.join(userDataDir, 'User');
  fs.mkdirSync(vscodeUserDir, { recursive: true });
  fs.writeFileSync(path.join(vscodeUserDir, 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'extensions.ignoreRecommendations': true,
  }));

  const app = await electron.launch({
    executablePath: resolveCodeExe(),
    args: [
      `--extensionDevelopmentPath=${extensionRoot}`,
      '--disable-updates',
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      workspaceDir,
    ],
  });

  app.process().stderr?.once('data', (chunk: Buffer | string) => {
    if (chunk.toString().includes('Code is currently being updated')) {
      throw new Error(
        'VS Code rejected launch: update in progress.\n' +
        'Close VS Code, let it restart to finish the update, then re-run tests.'
      );
    }
  });

  const cleanup = (): void => {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  return { app, cleanup, workspaceDir };
}

/**
 * Launches VS Code once and opens the upload panel for suites that reuse the
 * same Extension Development Host across serial tests.
 */
export async function launchSharedVsCode(): Promise<{
  app: ElectronApplication;
  cleanup: () => void;
  workspaceDir: string;
  mainWindow: Page;
  panel: PanelTarget;
}> {
  const { app, cleanup, workspaceDir } = await launchVsCode();
  try {
    const mainWindow = await app.firstWindow();
    await mainWindow.waitForSelector('.monaco-workbench', { timeout: 30_000 });
    const panel = await openPanelAndFindWebview(app, mainWindow);
    return { app, cleanup, workspaceDir, mainWindow, panel };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    throw error;
  }
}

/** Creates a fresh local folder so the webview resets file/group state. */
export function makeTestFolder(workspaceDir: string, label: string): string {
  const dir = path.join(workspaceDir, `${label}-${Date.now()}`);
  fs.mkdirSync(dir);
  return dir;
}

/** Explicitly selects the requested upload mode in the shared panel. */
export async function switchMode(panel: PanelTarget, mode: UploadMode): Promise<void> {
  const selectorByMode: Record<UploadMode, string> = {
    pistol_file: '.mode-half-pistol-file',
    zip_canon: '.mode-half-zip-canon',
    zip_gun: '.mode-half-zip-gun',
  };
  await panel.click(selectorByMode[mode]);
}

/** Waits until the panel is ready to start another upload. */
export async function waitForUploadIdle(panel: PanelTarget): Promise<void> {
  await panel.waitForFunction(
    () => !(document.querySelector('.btn-fire') as HTMLButtonElement | null)?.disabled,
    { timeout: 30_000 }
  );
}

/**
 * Opens the SFTP Zip Gun panel via the command palette and returns the
 * webview Frame. Modern VS Code (1.70+) renders webview panels as iframes
 * inside the main BrowserWindow rather than as separate Electron windows,
 * so we poll mainWindow.frames() instead of waiting for a 'window' event.
 */
export async function openPanelAndFindWebview(
  app: ElectronApplication,
  mainWindow: Page
): Promise<Frame | Page> {
  // Wait for VS Code to settle before opening the command palette so
  // startup notifications don't steal focus from the palette input.
  await mainWindow.locator('.monaco-workbench').waitFor({ timeout: 30_000 });
  await new Promise(r => setTimeout(r, 1_500));

  // Use the command palette — bypasses the `when: resourceScheme == file`
  // guard on the keyboard shortcut, which blocks when no file editor is focused.
  await mainWindow.keyboard.press('Control+Shift+P');
  await mainWindow.locator('.quick-input-widget').waitFor({ timeout: 10_000 });
  await mainWindow.keyboard.type('Open Upload Panel');
  await mainWindow.keyboard.press('Enter');

  // VS Code may render the webview as:
  //   (a) a new Electron BrowserWindow / <webview> WebContents → check app.windows()
  //   (b) an <iframe> inside the main window               → check mainWindow.frames()
  // Poll both until #app is found.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // (a) separate windows
    for (const w of app.windows()) {
      if (w === mainWindow) continue;
      try {
        if ((await w.locator('#app').count()) > 0) return w;
      } catch { /* detached */ }
    }
    // (b) inline frames
    for (const frame of mainWindow.frames()) {
      try {
        if ((await frame.locator('#app').count()) > 0) return frame;
      } catch { /* detached */ }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error('SFTP Zip Gun webview (#app) not found within 30s');
}

/**
 * Adds a preset through the Manage Connections tab.
 * Returns to the Transfer Files tab when done.
 */
export async function addPreset(
  panel: PanelTarget,
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

  await panel.locator('.row:has(label:text-is("Name")) input').fill(preset.name);
  await panel.locator('.row:has(label:text-is("Host")) input').fill(preset.host);
  await panel.locator('.row:has(label:text-is("Port")) input').fill(String(preset.port));
  await panel.locator('.row:has(label:text-is("Username")) input').fill(preset.username);
  await panel.locator('.row:has(label:text-is("Default path")) input').fill(preset.remoteDir);

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
  await panel.waitForSelector(`.preset-card:has-text("${preset.name}")`, { timeout: 30_000 });

  // Return to Transfer tab
  await panel.click('.view-tab:has-text("Transfer files")');
}

/** Selects a preset from the Account dropdown. */
export async function selectPreset(panel: PanelTarget, presetName: string): Promise<void> {
  await panel.selectOption('#preset-select', { value: presetName });
}

/**
 * Injects a synthetic `filesListed` message into the webview so that file
 * rows appear without relying on vscode.workspace.workspaceFolders being set
 * in Extension Development Host mode.
 *
 * Call this after selectPreset and before selectFile.
 */
export async function loadFolder(panel: PanelTarget, folderPath: string): Promise<void> {
  const normalized = folderPath.replace(/\\/g, '/');
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => ({ name: e.name, size: 0, isDirectory: false }));
  await panel.evaluate(
    ({ fp, fs: fileList }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { kind: 'filesListed', payload: { folderPath: fp, files: fileList } },
        })
      );
    },
    { fp: normalized, fs: files }
  );
  // Wait for at least one file row to appear in the DOM.
  await panel.waitForSelector('tr[data-filepath]', { timeout: 10_000 });
}

/**
 * Checks the file row checkbox for the given absolute path.
 * The file must exist in the workspace dir so the extension lists it.
 */
export async function selectFile(panel: PanelTarget, absPath: string): Promise<void> {
  // data-filepath is always forward-slash normalized by the webview (normalizeFolderPath).
  const norm = absPath.replace(/\\/g, '/');
  const cb = panel.locator(`tr[data-filepath="${norm}"] input[type="checkbox"]`);
  // 30s — filesListed round-trip via Extension Development Host can be slow.
  await cb.waitFor({ timeout: 30_000 });
  if (!await cb.isChecked()) {
    await cb.check();
  }
}

/** Clicks the "Session Logs" tab button. */
export async function openLogTab(panel: PanelTarget): Promise<void> {
  await panel.click('button:has-text("Session Logs")');
}

/** Clicks the "Upload History" tab button. */
export async function openHistoryTab(panel: PanelTarget): Promise<void> {
  await panel.click('button:has-text("Upload History")');
}

/** Returns a locator for all .history-entry elements. */
export function getHistoryEntries(panel: PanelTarget): Locator {
  return panel.locator('.history-entry');
}

/** Sets history result + mode filters. Pass 'all' to reset each. */
export async function setHistoryFilter(
  panel: PanelTarget,
  result: 'all' | 'success' | 'error' = 'all',
  mode: 'all' | 'canon' | 'pistol' | 'gun' = 'all'
): Promise<void> {
  const resultLabel: Record<typeof result, string> = {
    all: 'All',
    success: '✓ Success',
    error: '✗ Errors',
  };
  await panel.click(`button:has-text("${resultLabel[result]}")`);

  // Mode filter buttons only render when histModes.length > 1
  const modeBar = await panel.locator('.breadcrumb').count();
  if (modeBar > 0) {
    if (mode === 'all') {
      await panel.click('button:has-text("All modes")');
    } else {
      await panel.click(`button:has-text("${mode}")`);
    }
  }
}

/** Injects a synthetic HostToWebview `log` message into the webview. */
export async function injectLog(
  panel: PanelTarget,
  text: string,
  level: 'info' | 'warn' | 'error' = 'info',
  category: 'upload' | 'conn' | 'import' | 'accounts' | 'sys' = 'sys'
): Promise<void> {
  await panel.evaluate(({ text, level, category }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { kind: 'log', payload: { text, level, category } }
    }));
  }, { text, level, category });
}

/** Sets the log category filter. 'all' enables all categories. */
export async function setLogCategoryFilter(
  panel: PanelTarget,
  category: 'upload' | 'conn' | 'import' | 'accounts' | 'sys' | 'all'
): Promise<void> {
  await panel.click(`button:has-text("${category}")`);
}

/** Selects an option in the #send-to-select dropdown. */
export async function selectSendTo(panel: PanelTarget, value: string): Promise<void> {
  await panel.selectOption('#send-to-select', { value });
}

/** Clicks the "Manage connections" view tab. */
export async function openManageTab(panel: PanelTarget): Promise<void> {
  await panel.click('.view-tab:has-text("Manage connections")');
}

/** Clicks the "Transfer files" view tab. */
export async function openTransferTab(panel: PanelTarget): Promise<void> {
  await panel.click('.view-tab:has-text("Transfer files")');
}
