import { _electron as electron, expect, ElectronApplication, Frame, Locator, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { installHighlight } from './visual-debug';

type PanelTarget = Frame | Page;
type UploadMode = 'pistol_file' | 'zip_canon' | 'zip_gun';
type PanelView = 'manage' | 'transfer';
const VSCODE_CLOSE_TIMEOUT_MS = 15_000;
const VSCODE_FORCE_KILL_WAIT_MS = 5_000;

function isHeadedRun(): boolean {
  return process.env.HEADED !== '0';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(200);
  }
  return !isProcessAlive(pid);
}

function forceKillProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore: process may already be gone
    }
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore: process may already be gone
  }
}

function installBoundedClose(app: ElectronApplication): void {
  const launchedPid = app.process()?.pid;
  if (!launchedPid) return;

  const originalClose = app.close.bind(app);
  let closePromise: Promise<void> | undefined;

  Object.defineProperty(app, 'close', {
    configurable: true,
    value: async (): Promise<void> => {
      if (closePromise) {
        return closePromise;
      }

      closePromise = (async () => {
        const gracefulClose = originalClose();

        try {
          await Promise.race([
            gracefulClose,
            sleep(VSCODE_CLOSE_TIMEOUT_MS).then(() => {
              throw new Error(`Timed out closing VS Code after ${VSCODE_CLOSE_TIMEOUT_MS}ms`);
            }),
          ]);
          await gracefulClose;
          return;
        } catch (error) {
          if (isProcessAlive(launchedPid)) {
            forceKillProcessTree(launchedPid);
            await waitForProcessExit(launchedPid, VSCODE_FORCE_KILL_WAIT_MS);
          }

          if (isProcessAlive(launchedPid)) {
            throw error;
          }
        }
      })();

      return closePromise;
    },
  });
}

function getVsCodeLaunchArgs(extensionRoot: string, userDataDir: string, workspaceDir: string): string[] {
  const args = [
    `--extensionDevelopmentPath=${extensionRoot}`,
    '--disable-updates',
    '--no-sandbox',
    '--disable-extension=googlecloudtools.cloudcode',
    '--disable-extension=google.geminicodeassist',
    '--disable-extension=ms-toolsai.jupyter',
    '--disable-extension=GitHub.copilot',
    '--disable-extension=GitHub.copilot-chat',
    `--user-data-dir=${userDataDir}`,
  ];

  if (!isHeadedRun()) {
    // Playwright's config-level `use.headless` does not affect `_electron.launch()`.
    // Pass Chromium/VS Code launch switches explicitly so headless scripts do not
    // still open visible VS Code windows.
    args.push('--headless', '--disable-gpu');
  }

  args.push(workspaceDir);
  return args;
}

export function isPageTarget(target: PanelTarget): target is Page {
  return typeof (target as Page).frames === 'function';
}

export async function findWorkbenchWindow(
  app: ElectronApplication,
  preferred?: Page
): Promise<Page> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const candidates: Page[] = [];
    const addCandidate = (candidate?: Page) => {
      if (candidate && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };

    try {
      addCandidate(await app.firstWindow());
    } catch { /* app may be closing */ }

    for (const window of app.windows()) {
      addCandidate(window);
    }
    addCandidate(preferred);

    for (const candidate of candidates) {
      try {
        if (candidate.isClosed()) continue;
        const workbench = candidate.locator('.monaco-workbench').first();
        if (await workbench.count() > 0) {
          return candidate;
        }
      } catch { /* detached */ }
    }

    await new Promise(r => setTimeout(r, 200));
  }

  throw new Error('VS Code workbench window not found');
}

async function findVisiblePanelTarget(
  app: ElectronApplication,
  workbenchWindow: Page,
  timeoutMs: number
): Promise<PanelTarget | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // (a) separate windows
    for (const w of app.windows()) {
      if (w === workbenchWindow) continue;
      try {
        if (await isPanelTargetReady(w)) return w;
      } catch { /* detached */ }
    }
    // (b) inline frames
    for (const frame of workbenchWindow.frames()) {
      try {
        if (await isPanelTargetReady(frame)) return frame;
      } catch { /* detached */ }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return undefined;
}

async function isPanelTargetReady(target: PanelTarget): Promise<boolean> {
  const appRoot = target.locator('#app').first();
  if ((await appRoot.count()) === 0) return false;
  if (!(await appRoot.isVisible())) return false;

  const transferTab = target.locator('.view-tab:has-text("Transfer files")').first();
  const manageTab = target.locator('.view-tab:has-text("Manage connections")').first();
  return (await transferTab.count()) > 0 && (await manageTab.count()) > 0;
}

async function triggerOpenPanelFromStatusBar(workbenchWindow: Page, timeoutMs = 0): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const statusBarCommand = workbenchWindow
      .getByRole('button', { name: /SFTP Zip Gun.*click to open panel/ })
      .first();
    try {
      if (await statusBarCommand.count() > 0) {
        await statusBarCommand.evaluate((button: HTMLElement) => button.click());
        return true;
      }
    } catch {
      // ignore and keep polling until the deadline
    }

    if (Date.now() >= deadline) {
      return false;
    }

    await new Promise(r => setTimeout(r, 250));
  }
}

async function triggerOpenPanelFromCommandPalette(workbenchWindow: Page): Promise<void> {
  await workbenchWindow.keyboard.press('Control+Shift+P');
  await workbenchWindow.locator('.quick-input-widget').waitFor({ timeout: 10_000 });
  await workbenchWindow.keyboard.type('Open Upload Panel');
  await workbenchWindow.keyboard.press('Enter');
}

interface Tile { x: number; y: number; w: number; h: number }

function getScreenSize(): { width: number; height: number } {
  const envW = Number(process.env.SCREEN_W);
  const envH = Number(process.env.SCREEN_H);
  if (envW > 0 && envH > 0) return { width: envW, height: envH };

  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'wmic',
        ['path', 'Win32_VideoController', 'get',
          'CurrentHorizontalResolution,CurrentVerticalResolution', '/format:value'],
        { encoding: 'utf8' }
      );
      const w = Number(out.match(/CurrentHorizontalResolution=(\d+)/)?.[1]);
      const h = Number(out.match(/CurrentVerticalResolution=(\d+)/)?.[1]);
      if (w > 0 && h > 0) return { width: w, height: h };
    } catch { /* fall through */ }
  }
  return { width: 1920, height: 1080 };
}

function computeTile(idx: number, count: number, screen: { width: number; height: number }): Tile | undefined {
  if (count <= 1 || idx < 0 || idx >= count) return undefined;
  const { width, height } = screen;
  if (count === 2) {
    const w = Math.floor(width / 2);
    return { x: idx * w, y: 0, w, h: height };
  }
  if (count === 3) {
    const w = Math.floor(width / 3);
    return { x: idx * w, y: 0, w, h: height };
  }
  // 4+ → 2×2 grid (extra workers stack on slot 0..3)
  const slot = idx % 4;
  const col = slot % 2, row = Math.floor(slot / 2);
  const w = Math.floor(width / 2), h = Math.floor(height / 2);
  return { x: col * w, y: row * h, w, h };
}

/** Resolves the VS Code Electron executable path on Windows. */
function resolveCodeExe(): string {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(local, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const normalizePathResult = (candidate: string): string | undefined => {
    if (!candidate || !fs.existsSync(candidate)) return undefined;

    const base = path.basename(candidate).toLowerCase();
    if (base === 'code.exe' || base === 'code - insiders.exe') return candidate;

    if (base === 'code' || base === 'code.cmd' || base === 'code.bat') {
      const dir = path.dirname(candidate);
      if (path.basename(dir).toLowerCase() === 'bin') {
        const installRoot = path.dirname(dir);
        const rootCandidates = [
          path.join(installRoot, 'Code.exe'),
          path.join(installRoot, 'Code - Insiders.exe'),
        ];
        return rootCandidates.find(c => fs.existsSync(c));
      }
    }

    return candidate;
  };

  try {
    // execFileSync with 'where' — no shell, no injection risk
    const paths = execFileSync('where', ['code'], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    for (const candidate of paths) {
      const normalized = normalizePathResult(candidate);
      if (normalized) return normalized;
    }
  } catch { /* fall through */ }

  throw new Error(
    'VS Code Electron executable not found. Ensure VS Code is installed or `code` is on PATH.'
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

  const args = getVsCodeLaunchArgs(extensionRoot, userDataDir, workspaceDir);

  const app = await electron.launch({
    executablePath: resolveCodeExe(),
    args,
  });
  installBoundedClose(app);

  const workerIndex = Number(process.env.TEST_PARALLEL_INDEX ?? '0');
  const workerCount = Number(process.env.WORKERS ?? '1');
  const tile = computeTile(workerIndex, workerCount, getScreenSize());
  if (tile && isHeadedRun()) {
    void app.firstWindow().then(async () => {
      try {
        await app.evaluate(({ BrowserWindow }, t) => {
          const apply = () => {
            for (const win of BrowserWindow.getAllWindows()) {
              try { win.setBounds({ x: t.x, y: t.y, width: t.w, height: t.h }); } catch { /* ignore */ }
            }
          };
          apply();
          // VS Code may re-position the window during early init; re-apply a few times.
          setTimeout(apply, 500);
          setTimeout(apply, 1500);
          setTimeout(apply, 3000);
        }, tile);
      } catch { /* non-fatal */ }
    }).catch(() => {});
  }

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
    const initialWindow = await app.firstWindow();
    const mainWindow = await findWorkbenchWindow(app, initialWindow);
    await expect(mainWindow.locator('.monaco-workbench').first()).toBeVisible({ timeout: 45_000 });
    await hideAuxiliaryBar(mainWindow);
    await installHighlight(mainWindow);
    const panel = await openPanelAndFindWebview(app, mainWindow);
    await installHighlight(panel);
    return { app, cleanup, workspaceDir, mainWindow: await findWorkbenchWindow(app, mainWindow), panel };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    throw error;
  }
}

/**
 * Closes VS Code's secondary (auxiliary) sidebar if it is currently visible,
 * so the upload panel has full editor width — important when running multiple
 * windows in parallel headed mode.
 */
async function hideAuxiliaryBar(window: Page): Promise<void> {
  try {
    const visible = await window.evaluate(() => {
      const part = document.querySelector('.part.auxiliarybar') as HTMLElement | null;
      if (!part) return false;
      const style = part.ownerDocument.defaultView?.getComputedStyle(part);
      if (!style) return false;
      return style.display !== 'none' && style.visibility !== 'hidden' && part.offsetWidth > 0;
    });
    if (visible) {
      await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+B' : 'Control+Alt+B');
    }
  } catch {
    // not fatal; suite proceeds even if the aux bar can't be queried
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
  const modeButton = panel.locator(selectorByMode[mode]);
  await modeButton.click();
  await expect(modeButton).toHaveClass(/active/, { timeout: 5_000 });
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
  const workbenchWindow = await findWorkbenchWindow(app, mainWindow);

  // Wait for VS Code to settle before opening the command palette so
  // startup notifications don't steal focus from the palette input.
  await workbenchWindow.locator('.monaco-workbench').waitFor({ timeout: 30_000 });
  await new Promise(r => setTimeout(r, isHeadedRun() ? 1_500 : 3_000));

  for (let attempt = 0; attempt < 2; attempt++) {
    const statusTriggered = await triggerOpenPanelFromStatusBar(
      workbenchWindow,
      attempt === 0 ? (isHeadedRun() ? 5_000 : 12_000) : (isHeadedRun() ? 2_000 : 6_000)
    );
    const statusPanel = await findVisiblePanelTarget(
      app,
      workbenchWindow,
      statusTriggered ? 12_000 : 2_000
    );
    if (statusPanel) return statusPanel;

    try {
      await triggerOpenPanelFromCommandPalette(workbenchWindow);
      const commandPanel = await findVisiblePanelTarget(
        app,
        workbenchWindow,
        isHeadedRun() ? 20_000 : 30_000 + attempt * 15_000
      );
      if (commandPanel) return commandPanel;
    } catch { /* retry status bar below */ }

    if (await triggerOpenPanelFromStatusBar(workbenchWindow, isHeadedRun() ? 1_500 : 4_000)) {
      const retryPanel = await findVisiblePanelTarget(app, workbenchWindow, 12_000 + attempt * 5_000);
      if (retryPanel) return retryPanel;
    }

    if (attempt === 0) {
      await new Promise(r => setTimeout(r, isHeadedRun() ? 1_000 : 2_500));
    }
  }

  throw new Error('SFTP Zip Gun webview (ready panel with #app and tabs) not found within launch timeout');
}

export async function closeAndReopenPanel(
  app: ElectronApplication,
  mainWindow: Page
): Promise<{ mainWindow: Page; panel: PanelTarget }> {
  let workbenchWindow: Page | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    workbenchWindow = await findWorkbenchWindow(app, attempt === 0 ? mainWindow : undefined);
    try {
      await workbenchWindow.keyboard.press('Control+W');
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Target page, context or browser has been closed/.test(message) || attempt === 2) {
        throw error;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!workbenchWindow) {
    throw new Error('VS Code workbench window not found before panel close');
  }
  await new Promise(r => setTimeout(r, 800));

  const currentWorkbench = await findWorkbenchWindow(app, workbenchWindow);
  const panel = await openPanelAndFindWebview(app, currentWorkbench);
  return { mainWindow: await findWorkbenchWindow(app, currentWorkbench), panel };
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
  await openManageTab(panel);
  await panel.locator('button:has-text("+ Add Account")').click();

  const form = panel.locator('#preset-form-section');
  await expect(form).toBeVisible({ timeout: 10_000 });

  const nameInput = form.locator('input[placeholder="My Server"]');
  const hostInput = form.locator('input[placeholder="sftp.example.com"]');
  const portInput = form.locator('input[type="number"]');
  const usernameInput = form.locator('input[placeholder="username"]');
  const remoteDirInput = form.locator('input[placeholder="/uploads"]');

  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await expect(hostInput).toBeVisible({ timeout: 10_000 });
  await expect(portInput).toBeVisible({ timeout: 10_000 });
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await expect(remoteDirInput).toBeVisible({ timeout: 10_000 });

  await nameInput.fill(preset.name);
  await hostInput.fill(preset.host);
  await portInput.fill(String(preset.port));
  await usernameInput.fill(preset.username);
  await remoteDirInput.fill(preset.remoteDir);

  if (preset.authType === 'key') {
    const keyRadio = form.locator('input[type="radio"][value="key"]');
    await keyRadio.click();
    const keyInput = form.locator('#f-auth-fields input[placeholder="/home/user/.ssh/id_rsa"]');
    await expect(keyInput).toBeVisible({ timeout: 15_000 });
    await keyInput.fill(preset.keyPath ?? '');
    await expect(keyInput).toHaveValue(preset.keyPath ?? '', { timeout: 2_000 });
  } else {
    const passwordRadio = form.locator('input[type="radio"][value="password"]');
    await passwordRadio.click();
    if (preset.password) {
      const passwordInput = form.locator('#f-auth-fields input[type="password"]');
      await expect(passwordInput).toBeVisible({ timeout: 15_000 });
      await passwordInput.fill(preset.password ?? '');
      await expect(passwordInput).toHaveValue(preset.password ?? '', { timeout: 2_000 });
    }
  }

  const saveButton = form.locator('button:text-is("Save")');
  await expect(saveButton).toBeVisible({ timeout: 10_000 });
  await saveButton.evaluate((button: HTMLButtonElement) => button.click());

  const presetCard = panel.locator(`.preset-card:has-text("${preset.name}")`);
  await expect(async () => {
    await expect(form).toBeHidden({ timeout: 3_000 });
    await expect(presetCard).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  await openTransferTab(panel);
  await expect(panel.locator(`#preset-select option[value="${preset.name}"]`)).toHaveCount(1, { timeout: 10_000 });
}

/** Selects a preset from the Account dropdown. */
export async function selectPreset(panel: PanelTarget, presetName: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const select = panel.locator('#preset-select');
      await select.waitFor({ state: 'visible', timeout: 5_000 });
      await select.evaluate((element: HTMLSelectElement, value) => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, presetName);
      await expect(select).toHaveValue(presetName, { timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out selecting preset "${presetName}"`);
}

/**
 * Injects a synthetic `filesListed` message into the webview so that file
 * rows appear without relying on vscode.workspace.workspaceFolders being set
 * in Extension Development Host mode.
 *
 * Call this after selectPreset and before selectFile.
 */
export async function loadFolder(panel: PanelTarget, folderPath: string, opts?: { waitForRows?: boolean }): Promise<void> {
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
  if (opts?.waitForRows !== false) {
    // Wait for at least one file row to appear in the DOM.
    await panel.waitForSelector('tr[data-filepath]', { timeout: 10_000 });
  }
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

/** Opens the "Session Logs" tab. No-op if already active (clicking active tab would close it). */
export async function openLogTab(panel: PanelTarget): Promise<void> {
  const logsBtn = panel.locator('button:has-text("Session Logs")');
  const isActive = await logsBtn.evaluate(el => el.classList.contains('active'));
  if (!isActive) {
    await logsBtn.click();
    await expect(logsBtn).toHaveClass(/active/, { timeout: 5_000 });
  }
  await panel.locator('.log-section-box:has(.log-box) .log-filter-row').waitFor({ timeout: 5_000 });
}

/** Opens the "Upload History" tab. No-op if already active (clicking active tab would close it). */
export async function openHistoryTab(panel: PanelTarget): Promise<void> {
  const histBtn = panel.locator('button:has-text("Upload History")');
  const isActive = await histBtn.evaluate(el => el.classList.contains('active'));
  if (!isActive) {
    await histBtn.click();
    await expect(histBtn).toHaveClass(/active/, { timeout: 5_000 });
  }
  await panel.locator('.log-history-section').waitFor({ timeout: 5_000 });
  await panel.locator('.log-section-box:has(.log-history-section) .log-filter-row').waitFor({ timeout: 5_000 });
}

/** Returns a locator for all .history-entry elements. */
export function getHistoryEntries(panel: PanelTarget): Locator {
  return panel.locator('.history-entry');
}

async function clickButtonByDom(locator: Locator): Promise<void> {
  await locator.evaluate((button: HTMLElement) => button.click());
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
  const filterBar = panel.locator('.log-section-box:has(.log-history-section) .log-filter-row');
  await filterBar.waitFor({ timeout: 5_000 });
  const resultButton = filterBar.locator(`button:text-is("${resultLabel[result]}")`);
  if (!/\bactive\b/.test(await resultButton.getAttribute('class') ?? '')) {
    await clickButtonByDom(resultButton);
  }

  // Mode filter buttons only render when histModes.length > 1
  const allModesBtn = filterBar.locator('button:text-is("All modes")');
  if (await allModesBtn.count() > 0) {
    if (mode === 'all') {
      if (!/\bactive\b/.test(await allModesBtn.getAttribute('class') ?? '')) {
        await clickButtonByDom(allModesBtn);
      }
    } else {
      const modeButton = filterBar.locator(`button:text-is("${mode}")`);
      if (!/\bactive\b/.test(await modeButton.getAttribute('class') ?? '')) {
        await clickButtonByDom(modeButton);
      }
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
  const filterBar = panel.locator('.log-section-box:has(.log-box) .log-filter-row');
  await filterBar.waitFor({ timeout: 5_000 });
  const allBtn = filterBar.locator('button:text-is("All")');
  if (category === 'all') {
    if (!/\bactive\b/.test(await allBtn.getAttribute('class') ?? '')) {
      await allBtn.click();
    }
    return;
  }

  if (/\bactive\b/.test(await allBtn.getAttribute('class') ?? '')) {
    await allBtn.click();
  }

  for (const cat of ['upload', 'conn', 'import', 'accounts', 'sys']) {
    const btn = filterBar.locator(`button:text-is("${cat}")`);
    const isActive = /\bactive\b/.test(await btn.getAttribute('class') ?? '');
    if (cat === category && !isActive) {
      await btn.click();
    } else if (cat !== category && isActive) {
      await btn.click();
    }
  }
}

/** Selects an option in the #send-to-select dropdown. */
export async function selectSendTo(panel: PanelTarget, value: string): Promise<void> {
  await panel.selectOption('#send-to-select', { value });
}

/**
 * Selects a one-time remote path in the Transfer tab.
 * Leaves bookmark helpers and the default /store flow unchanged.
 */
export async function selectOneTimeRemotePath(panel: PanelTarget, remoteDir: string): Promise<void> {
  await openTransferTab(panel);
  const select = panel.locator('#send-to-select');
  await select.selectOption({ value: '__add_new__' });

  const remotePathInput = panel.locator('input[placeholder="/remote/path"]');
  await remotePathInput.waitFor({ state: 'visible', timeout: 10_000 });
  await remotePathInput.fill(remoteDir);

  await panel.locator('button:text-is("Use once")').click();
  await expect(select).toHaveValue(remoteDir, { timeout: 5_000 });
}

async function openViewTab(panel: PanelTarget, label: string, anchorSelector: string): Promise<void> {
  const tab = panel.locator(`.view-tab:has-text("${label}")`);
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  if (!await tab.evaluate(el => el.classList.contains('active'))) {
    await tab.evaluate((button: HTMLElement) => button.click());
  }
  await expect(tab).toHaveClass(/active/, { timeout: 10_000 });
  await panel.locator(anchorSelector).waitFor({ state: 'visible', timeout: 10_000 });
}

/** Clicks the "Manage connections" view tab. */
export async function openManageTab(panel: PanelTarget): Promise<void> {
  await openViewTab(panel, 'Manage connections', 'button:has-text("+ Add Account")');
}

/** Clicks the "Transfer files" view tab. */
export async function openTransferTab(panel: PanelTarget): Promise<void> {
  await openViewTab(panel, 'Transfer files', '#preset-select');
}
