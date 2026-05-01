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
const VSCODE_LAUNCH_LOCK_TIMEOUT_MS = 180_000;
const VSCODE_LAUNCH_LOCK_STALE_MS = 240_000;
const VSCODE_LAUNCH_LOCK_PATH = path.join(os.tmpdir(), 'sftp-e2e-vscode-launch.lock');
const MIN_HEADED_TILE_WIDTH = 480;

function isHeadedRun(): boolean {
  return process.env.HEADED !== '0';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLogText(value: unknown): string {
  if (value === null || value === undefined) return '<none>';
  if (typeof value === 'string') return value.trim() || '<empty>';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function safePageLabel(page: Page): string {
  try {
    return page.url() || '<no-url>';
  } catch {
    return '<detached-page>';
  }
}

function safeFrameLabel(frame: Frame): string {
  try {
    return frame.url() || '<no-url>';
  } catch {
    return '<detached-frame>';
  }
}

async function acquireVsCodeLaunchLock(): Promise<() => void> {
  const deadline = Date.now() + VSCODE_LAUNCH_LOCK_TIMEOUT_MS;
  let fd: number | undefined;

  while (Date.now() < deadline) {
    try {
      fd = fs.openSync(VSCODE_LAUNCH_LOCK_PATH, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return () => {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
          fd = undefined;
        }
        try { fs.rmSync(VSCODE_LAUNCH_LOCK_PATH, { force: true }); } catch { /* ignore */ }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        throw error;
      }

      try {
        const raw = fs.readFileSync(VSCODE_LAUNCH_LOCK_PATH, 'utf8');
        const parsed = JSON.parse(raw) as { createdAt?: number };
        const createdAt = Number(parsed.createdAt);
        if (createdAt > 0 && Date.now() - createdAt > VSCODE_LAUNCH_LOCK_STALE_MS) {
          fs.rmSync(VSCODE_LAUNCH_LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        try { fs.rmSync(VSCODE_LAUNCH_LOCK_PATH, { force: true }); } catch { /* ignore */ }
      }

      await sleep(250);
    }
  }

  throw new Error(`Timed out waiting for VS Code launch lock at ${VSCODE_LAUNCH_LOCK_PATH}`);
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
    '--disable-extensions',
    '--no-sandbox',
    '--disable-extension=googlecloudtools.cloudcode',
    '--disable-extension=google.geminicodeassist',
    '--disable-extension=google.gemini-cli-vscode-ide-companion',
    '--disable-extension=anthropic.claude-code',
    '--disable-extension=ms-toolsai.jupyter',
    '--disable-extension=GitHub.copilot',
    '--disable-extension=GitHub.copilot-chat',
    '--disable-extension=vscode.github-authentication',
    '--disable-extension=vscode.microsoft-authentication',
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

function getPanelOwnerPage(target?: PanelTarget): Page | undefined {
  if (!target) return undefined;
  if (isPageTarget(target)) return target;
  try {
    return target.page();
  } catch {
    return undefined;
  }
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
  timeoutMs: number,
  excludedTargets: PanelTarget[] = []
): Promise<PanelTarget | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // (a) separate windows
    for (const w of app.windows()) {
      if (w === workbenchWindow) continue;
      if (excludedTargets.includes(w)) continue;
      try {
        if (await isPanelTargetReady(w)) return w;
      } catch { /* detached */ }
    }
    // (b) inline frames
    for (const frame of workbenchWindow.frames()) {
      if (excludedTargets.includes(frame)) continue;
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
        try {
          await statusBarCommand.click({ force: true, timeout: 1_500 });
        } catch {
          await statusBarCommand.evaluate((button: HTMLElement) => button.click());
        }
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

async function triggerOpenPanelFromKeybinding(workbenchWindow: Page): Promise<void> {
  await workbenchWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+U' : 'Control+Shift+U');
}

async function triggerOpenPanelFromCommandPalette(workbenchWindow: Page): Promise<void> {
  await workbenchWindow.bringToFront();
  await workbenchWindow.keyboard.press('Escape').catch(() => {});
  await dismissWorkbenchNoise(workbenchWindow);
  await workbenchWindow.keyboard.press('Control+Shift+P');
  const widget = workbenchWindow.locator('.quick-input-widget').first();
  try {
    await widget.waitFor({ timeout: 10_000 });
  } catch {
    await workbenchWindow.keyboard.press('F1');
    await widget.waitFor({ timeout: 10_000 });
  }
  const input = widget.locator('input').first();
  await expect(input).toBeVisible({ timeout: 5_000 });

  const queries = ['SFTP Zip Gun: Open Upload Panel', 'Open Upload Panel'];
  let matched = false;
  for (const query of queries) {
    await input.fill(query);
    const result = workbenchWindow.locator(`.quick-input-list .monaco-list-row:has-text("${query}")`).first();
    try {
      await expect(result).toBeVisible({ timeout: 8_000 });
      matched = true;
      break;
    } catch {
      // Try the shorter contributed command label before failing.
    }
  }

  if (!matched) {
    throw new Error('SFTP Zip Gun command-palette result not found');
  }
  await workbenchWindow.keyboard.press('Enter');
}

async function dismissWorkbenchNoise(workbenchWindow: Page): Promise<void> {
  const dismissible = [
    '.notification-toast .codicon-notifications-clear',
    '.notification-toast .codicon-close',
    '.notifications-toasts .monaco-action-bar .codicon-close',
    '.monaco-dialog-box .dialog-buttons button:has-text("Cancel")',
    '.monaco-dialog-box .dialog-buttons button:has-text("No")',
    '.monaco-dialog-box .dialog-buttons button:has-text("Not Now")',
    '.monaco-dialog-box .dialog-buttons button:has-text("Later")',
  ];

  for (const selector of dismissible) {
    const target = workbenchWindow.locator(selector).first();
    try {
      if (await target.count() > 0 && await target.isVisible()) {
        await target.click({ force: true, timeout: 500 });
      }
    } catch {
      // Non-fatal: best-effort cleanup before command palette opening.
    }
  }
}

async function getActiveEditorTabLabels(window: Page): Promise<string[]> {
  try {
    return await window.evaluate(() => {
      const selectors = [
        '.tabs-container .tab.active',
        '.editor-group-container .tab.active',
        '.editor-group-container .tabs-container .tab.active',
      ];
      const seen = new Set<string>();
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          const label = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (label) seen.add(label);
        }
      }
      return Array.from(seen);
    });
  } catch {
    return [];
  }
}

async function getStatusBarVisible(window: Page): Promise<boolean | 'unknown'> {
  try {
    const statusBar = window.locator('.statusbar').first();
    if (await statusBar.count() === 0) return false;
    return await statusBar.isVisible();
  } catch {
    return 'unknown';
  }
}

async function getSftpStatusCommandVisible(window: Page): Promise<boolean | 'unknown'> {
  try {
    const statusBarCommand = window
      .getByRole('button', { name: /SFTP Zip Gun.*click to open panel/ })
      .first();
    if (await statusBarCommand.count() === 0) return false;
    return await statusBarCommand.isVisible();
  } catch {
    return 'unknown';
  }
}

async function getCommandPaletteSnapshot(window: Page): Promise<{
  widgetVisible: boolean | 'unknown';
  resultVisible: boolean | 'unknown';
  resultCount: number | 'unknown';
}> {
  try {
    const widget = window.locator('.quick-input-widget').first();
    const widgetVisible = await widget.count() > 0 ? await widget.isVisible() : false;
    const result = window.locator('.quick-input-list .monaco-list-row:has-text("SFTP Zip Gun: Open Upload Panel")').first();
    const resultCount = await result.count();
    const resultVisible = resultCount > 0 ? await result.isVisible() : false;
    return { widgetVisible, resultVisible, resultCount };
  } catch {
    return { widgetVisible: 'unknown', resultVisible: 'unknown', resultCount: 'unknown' };
  }
}

async function getFrameHasApp(frame: Frame): Promise<boolean | 'unknown'> {
  try {
    return (await frame.locator('#app').count()) > 0;
  } catch {
    return 'unknown';
  }
}

async function getFrameAppVisible(frame: Frame): Promise<boolean | 'unknown'> {
  try {
    const appRoot = frame.locator('#app').first();
    if (await appRoot.count() === 0) return false;
    return await appRoot.isVisible();
  } catch {
    return 'unknown';
  }
}

async function collectPanelDiagnostics(
  app: ElectronApplication,
  workbenchWindow: Page,
  extra?: Record<string, unknown>
): Promise<string> {
  const lines: string[] = [];
  lines.push(`headed=${isHeadedRun()}`);

  try {
    lines.push(`app.windows=${app.windows().length}`);
  } catch (error) {
    lines.push(`app.windows=error:${normalizeLogText(error)}`);
  }

  lines.push(`workbench=${safePageLabel(workbenchWindow)}`);
  lines.push(`active.editor.tabs=${normalizeLogText(await getActiveEditorTabLabels(workbenchWindow))}`);
  lines.push(`status.bar.visible=${normalizeLogText(await getStatusBarVisible(workbenchWindow))}`);
  lines.push(`sftp.status.command.visible=${normalizeLogText(await getSftpStatusCommandVisible(workbenchWindow))}`);

  const palette = await getCommandPaletteSnapshot(workbenchWindow);
  lines.push(`command.palette.widget.visible=${normalizeLogText(palette.widgetVisible)}`);
  lines.push(`command.palette.result.visible=${normalizeLogText(palette.resultVisible)}`);
  lines.push(`command.palette.result.count=${normalizeLogText(palette.resultCount)}`);

  const windows = app.windows();
  lines.push(`window.count=${windows.length}`);
  for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
    const page = windows[windowIndex];
    try {
      lines.push(`window[${windowIndex}].url=${safePageLabel(page)}`);
      const frames = page.frames();
      lines.push(`window[${windowIndex}].frames=${frames.length}`);
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex];
        const hasApp = await getFrameHasApp(frame);
        const appVisible = hasApp === true ? await getFrameAppVisible(frame) : 'n/a';
        lines.push(
          `window[${windowIndex}].frame[${frameIndex}].name=${normalizeLogText(frame.name())} ` +
          `url=${safeFrameLabel(frame)} hasApp=${normalizeLogText(hasApp)} appVisible=${normalizeLogText(appVisible)}`
        );
      }
    } catch (error) {
      lines.push(`window[${windowIndex}]=error:${normalizeLogText(error)}`);
    }
  }

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      lines.push(`${key}=${normalizeLogText(value)}`);
    }
  }

  return lines.join('\n');
}

async function logHeadedPanelDiagnostics(
  app: ElectronApplication,
  workbenchWindow: Page,
  reason: string,
  extra?: Record<string, unknown>
): Promise<string> {
  const diagnostics = await collectPanelDiagnostics(app, workbenchWindow, extra);
  const message = `[launch-vscode] ${reason}\n${diagnostics}`;
  console.error(message);
  return message;
}

interface Tile { x: number; y: number; w: number; h: number }

function getScreenSize(): { width: number; height: number } {
  const envW = Number(process.env.SCREEN_W);
  const envH = Number(process.env.SCREEN_H);
  if (envW > 0 && envH > 0) return { width: envW, height: envH };

  if (process.platform === 'win32') {
    try {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$screen = [System.Windows.Forms.Screen]::PrimaryScreen;',
        '$bounds = $screen.WorkingArea;',
        'Write-Output ("{0}x{1}" -f $bounds.Width, $bounds.Height);',
      ].join(' ');
      const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
      const match = out.match(/(\d+)x(\d+)/);
      const w = Number(match?.[1]);
      const h = Number(match?.[2]);
      if (w > 0 && h > 0) return { width: w, height: h };
    } catch { /* fall through */ }
  }
  return { width: 1920, height: 1080 };
}

function computeTile(idx: number, count: number, screen: { width: number; height: number }): Tile | undefined {
  if (count <= 1 || idx < 0 || idx >= count) return undefined;
  const width = Math.max(1, Math.floor(screen.width));
  const height = Math.max(1, Math.floor(screen.height));

  // 4+ workers use the first four visible slots; additional workers stack on
  // those slots because a headed run cannot display more without overlap.
  const visibleSlots = Math.min(count, 4);
  let cols = count <= 3 ? count : 2;
  if (Math.floor(width / cols) < MIN_HEADED_TILE_WIDTH) {
    cols = 1;
  }
  const rows = Math.ceil(visibleSlots / cols);
  const slot = idx % visibleSlots;
  const col = slot % cols, row = Math.floor(slot / cols);
  const w = Math.max(1, Math.floor(width / cols)), h = Math.max(1, Math.floor(height / rows));
  const x = Math.min(col * w, Math.max(0, width - 1));
  const y = Math.min(row * h, Math.max(0, height - 1));
  return { x, y, w: Math.min(w, width - x), h: Math.min(h, height - y) };
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
    'workbench.accounts.showAccounts': false,
    'workbench.activityBar.showAccounts': false,
    'workbench.activityBar.showGlobalSearch': false,
    'settingsSync.enableNaturalLanguageSearch': false,
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
  const releaseLaunchLock = await acquireVsCodeLaunchLock();
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
  } finally {
    releaseLaunchLock();
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
  mainWindow: Page,
  excludedTargets: PanelTarget[] = []
): Promise<Frame | Page> {
  const workbenchWindow = await findWorkbenchWindow(app, mainWindow);
  const openerTrace: string[] = [];

  // Wait for VS Code to settle before opening the command palette so
  // startup notifications don't steal focus from the palette input.
  await workbenchWindow.locator('.monaco-workbench').waitFor({ timeout: 30_000 });
  await new Promise(r => setTimeout(r, isHeadedRun() ? 1_500 : 3_000));

  for (let attempt = 0; attempt < 2; attempt++) {
    await workbenchWindow.bringToFront();
    const statusTriggered = await triggerOpenPanelFromStatusBar(
      workbenchWindow,
      attempt === 0 ? (isHeadedRun() ? 5_000 : 12_000) : (isHeadedRun() ? 2_000 : 6_000)
    );
    openerTrace.push(`attempt:${attempt}:statusBar:triggered=${statusTriggered}`);
    const statusPanel = await findVisiblePanelTarget(
      app,
      workbenchWindow,
      statusTriggered ? 12_000 : 2_000,
      excludedTargets
    );
    if (statusPanel) {
      openerTrace.push(`attempt:${attempt}:statusBar:ready=true`);
      return statusPanel;
    }
    openerTrace.push(`attempt:${attempt}:statusBar:ready=false`);

    try {
      await triggerOpenPanelFromKeybinding(workbenchWindow);
      openerTrace.push(`attempt:${attempt}:keybinding:triggered=true`);
      const keybindingPanel = await findVisiblePanelTarget(
        app,
        workbenchWindow,
        isHeadedRun() ? 10_000 : 15_000,
        excludedTargets
      );
      if (keybindingPanel) {
        openerTrace.push(`attempt:${attempt}:keybinding:ready=true`);
        return keybindingPanel;
      }
      openerTrace.push(`attempt:${attempt}:keybinding:ready=false`);
    } catch (error) {
      openerTrace.push(`attempt:${attempt}:keybinding:error=${normalizeLogText(error)}`);
    }

    try {
      await triggerOpenPanelFromCommandPalette(workbenchWindow);
      openerTrace.push(`attempt:${attempt}:commandPalette:triggered=true`);
      const commandPanel = await findVisiblePanelTarget(
        app,
        workbenchWindow,
        isHeadedRun() ? 20_000 : 30_000 + attempt * 15_000,
        excludedTargets
      );
      if (commandPanel) {
        openerTrace.push(`attempt:${attempt}:commandPalette:ready=true`);
        return commandPanel;
      }
      openerTrace.push(`attempt:${attempt}:commandPalette:ready=false`);
    } catch (error) {
      openerTrace.push(`attempt:${attempt}:commandPalette:error=${normalizeLogText(error)}`);
    }

    if (attempt === 0) {
      await new Promise(r => setTimeout(r, isHeadedRun() ? 1_000 : 2_500));
    }
  }

  const diagnostics = isHeadedRun()
    ? await logHeadedPanelDiagnostics(app, workbenchWindow, 'panel open failed', {
      openerTrace,
      excludedTargets: excludedTargets.length,
    })
    : undefined;
  throw new Error(
    'SFTP Zip Gun webview (ready panel with #app and tabs) not found within launch timeout' +
    (diagnostics ? `\n${diagnostics}` : '')
  );
}

async function waitForPanelTargetToDisappear(target: PanelTarget, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const appRoot = target.locator('#app').first();
      if ((await appRoot.count()) === 0) {
        return;
      }
      if (!await appRoot.isVisible()) {
        return;
      }
    } catch {
      return;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  throw new Error(`Panel target did not disappear within ${timeoutMs}ms`);
}

async function tryClosePanelViaTabChrome(window: Page): Promise<boolean> {
  const tab = window
    .locator('.tabs-container .tab.active:has-text("SFTP Zip Gun"), .editor-group-container .tab.active:has-text("SFTP Zip Gun")')
    .first();
  try {
    if (await tab.count() === 0 || !(await tab.isVisible())) {
      return false;
    }

    await tab.hover({ force: true, timeout: 2_000 }).catch(() => {});
    const closeButton = tab.locator([
      'button[aria-label*="Close"]',
      'button[title*="Close"]',
      '.monaco-action-bar .action-label.codicon-close',
      '.action-label.codicon-close',
      '.codicon-close',
    ].join(', ')).first();
    if (await closeButton.count() === 0 || !(await closeButton.isVisible())) {
      return false;
    }

    try {
      await closeButton.click({ force: true, timeout: 2_000 });
    } catch {
      await closeButton.evaluate((button: HTMLElement) => button.click());
    }
    return true;
  } catch {
    return false;
  }
}

export async function closeAndReopenPanel(
  app: ElectronApplication,
  mainWindow: Page,
  previousPanel?: PanelTarget
): Promise<{ mainWindow: Page; panel: PanelTarget }> {
  let workbenchWindow: Page | undefined;
  let closeMethod = 'not-attempted';
  for (let attempt = 0; attempt < 3; attempt++) {
    workbenchWindow = await findWorkbenchWindow(app, attempt === 0 ? mainWindow : undefined);
    const ownerPage = getPanelOwnerPage(previousPanel);
    if (ownerPage && !ownerPage.isClosed()) {
      await ownerPage.bringToFront().catch(() => {});
      workbenchWindow = await findWorkbenchWindow(app, ownerPage);
    } else {
      await workbenchWindow.bringToFront().catch(() => {});
    }
    try {
      const closedViaTab = await tryClosePanelViaTabChrome(workbenchWindow);
      if (!closedViaTab) {
        const activeTabs = await getActiveEditorTabLabels(workbenchWindow);
        if (!activeTabs.some(label => /SFTP Zip Gun/i.test(label))) {
          const diagnostics = isHeadedRun()
            ? await logHeadedPanelDiagnostics(app, workbenchWindow, 'panel close refused: SFTP tab not active', {
              previousPanelPresent: Boolean(previousPanel),
              activeTabs,
            })
            : '';
          throw new Error(
            'Refusing to use keyboard close because the active editor is not the SFTP Zip Gun panel' +
            (diagnostics ? `\n${diagnostics}` : '')
          );
        }
        await workbenchWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
        closeMethod = 'keyboard';
      } else {
        closeMethod = 'tab-close-button';
      }
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Target page, context or browser has been closed/.test(message) || attempt === 2) {
        if (isHeadedRun()) {
          const diagnostics = await logHeadedPanelDiagnostics(app, workbenchWindow, 'panel close failed', {
            previousPanelPresent: Boolean(previousPanel),
            closeMethod,
          });
          throw new Error(`${message}\n${diagnostics}`);
        }
        throw error;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!workbenchWindow) {
    throw new Error('VS Code workbench window not found before panel close');
  }
  if (previousPanel) {
    await waitForPanelTargetToDisappear(previousPanel, 10_000);
    if (isHeadedRun()) {
      console.error(`[launch-vscode] panel close verified closeMethod=${closeMethod}`);
    }
  } else {
    const visiblePanel = await findVisiblePanelTarget(app, workbenchWindow, 2_000);
    if (visiblePanel) {
      await waitForPanelTargetToDisappear(visiblePanel, 10_000);
      if (isHeadedRun()) {
        console.error(`[launch-vscode] panel close verified closeMethod=${closeMethod}`);
      }
    }
  }
  await new Promise(r => setTimeout(r, isHeadedRun() ? 800 : 1_500));

  const currentWorkbench = await findWorkbenchWindow(app, workbenchWindow);
  try {
    const panel = await openPanelAndFindWebview(app, currentWorkbench);
    return { mainWindow: await findWorkbenchWindow(app, currentWorkbench), panel };
  } catch (error) {
    if (isHeadedRun()) {
      const diagnostics = await logHeadedPanelDiagnostics(app, currentWorkbench, 'panel reopen failed', {
        previousPanelPresent: Boolean(previousPanel),
        closeMethod,
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
    }
    throw error;
  }
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
    readOnly?: boolean;
  }
): Promise<void> {
  const form = panel.locator('#preset-form-section');
  await expect(async () => {
    await openManageTab(panel);
    const addButton = panel.locator('button:has-text("+ Add Account")');
    await expect(addButton).toBeVisible({ timeout: 2_000 });
    await addButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(form.locator('input[placeholder="My Server"]')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

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
    await expect(async () => {
      const keyRadio = form.locator('input[type="radio"][value="key"]');
      await keyRadio.check({ force: true });
      await expect(keyRadio).toBeChecked({ timeout: 2_000 });
      const keyInput = form.locator('#f-auth-fields input[placeholder="SSH private key path"]');
      await expect(keyInput).toBeVisible({ timeout: 2_000 });
      await keyInput.fill(preset.keyPath ?? '');
      await expect(keyInput).toHaveValue(preset.keyPath ?? '', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  } else {
    if (preset.password) {
      await expect(async () => {
        const passwordRadio = form.locator('input[type="radio"][value="password"]');
        await passwordRadio.check({ force: true });
        await expect(passwordRadio).toBeChecked({ timeout: 2_000 });
        const passwordInput = form.locator('#f-auth-fields input[type="password"]');
        await expect(passwordInput).toBeVisible({ timeout: 2_000 });
        await passwordInput.fill(preset.password ?? '');
        await expect(passwordInput).toHaveValue(preset.password ?? '', { timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
    }
  }

  if (preset.readOnly === true) {
    const readOnlyInput = form.locator('label:has-text("Drop-box") input[type="checkbox"]').first();
    await readOnlyInput.check();
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
  await expect(async () => {
    const select = panel.locator('#preset-select');
    await expect(select).toBeVisible({ timeout: 2_000 });
    await select.selectOption({ value: presetName });
    await expect(select).toHaveValue(presetName, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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
