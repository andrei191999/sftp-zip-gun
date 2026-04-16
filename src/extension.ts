import * as vscode from 'vscode';
import * as path from 'path';
import { PresetManager } from './config/presetManager';
import { StateManager } from './config/stateManager';
import { SftpClient, AbortError } from './sftp/sftpClient';
import { SftpPanel } from './webview/SftpPanel';
import { generateId } from './types/messages';
import { initLogger, log } from './logger';

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private readonly spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIdx = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'sftpZipGun.openPanel';
    this.item.tooltip = 'SFTP Zip Gun — click to open panel';
  }

  setIdle(presetName?: string): void {
    this._clearSpinner();
    this.item.text = presetName ? `$(cloud-upload) ${presetName}` : `$(cloud-upload) SFTP Zip Gun`;
    this.item.show();
  }

  setUploading(): void {
    this._clearSpinner();
    this.spinnerTimer = setInterval(() => {
      this.item.text = `${this.spinnerFrames[this.spinnerIdx++ % this.spinnerFrames.length]} Uploading…`;
    }, 100);
    this.item.show();
  }

  setSuccess(presetName: string): void {
    this._clearSpinner();
    this.item.text = `$(check) ${presetName}`;
    this.item.show();
    setTimeout(() => this.setIdle(presetName), 3000);
  }

  setError(): void {
    this._clearSpinner();
    this.item.text = `$(issue-opened) Upload failed`;
    this.item.show();
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.item);
  }

  private _clearSpinner(): void {
    if (this.spinnerTimer !== undefined) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }
}

function createStatusBar(
  context: vscode.ExtensionContext,
  presetManager: PresetManager,
  stateManager: StateManager
): StatusBar {
  const bar = new StatusBar();
  const lastPreset = stateManager.getState().lastPresetName;
  bar.setIdle(lastPreset);
  bar.register(context);
  return bar;
}

// ---------------------------------------------------------------------------
// Context helper
// ---------------------------------------------------------------------------

function updateHasPresetsContext(presetManager: PresetManager): void {
  void vscode.commands.executeCommand(
    'setContext',
    'sftpZipGun.hasPresets',
    presetManager.getAll().length > 0
  );
}

// ---------------------------------------------------------------------------
// Quick upload handler
// ---------------------------------------------------------------------------

async function handleQuickUpload(
  commandUri: vscode.Uri | undefined,
  context: vscode.ExtensionContext,
  presetManager: PresetManager,
  stateManager: StateManager,
  statusBar: StatusBar
): Promise<void> {
  const uri = commandUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    vscode.window.showErrorMessage('SFTP Zip Gun: No file selected.');
    return;
  }

  const presets = presetManager.getAll();
  if (presets.length === 0) {
    vscode.window.showErrorMessage('SFTP Zip Gun: No presets configured. Use the Manage panel to add one.');
    return;
  }

  let preset = presets.find(p => p.name === stateManager.getState().lastPresetName);
  if (!preset) {
    const pick = await vscode.window.showQuickPick(
      presets.map(p => ({ label: (p.readOnly ? '🔒 ' : '') + p.name, description: `${p.host}:${p.port}`, preset: p })),
      { title: 'Select SFTP Preset for Quick Upload' }
    );
    if (!pick) { return; }
    preset = pick.preset;
  }

  const fileName = path.basename(uri.fsPath);
  const remotePath = preset.remoteDir.replace(/\/$/, '') + '/' + fileName;

  statusBar.setUploading();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `SFTP: Uploading ${fileName}`, cancellable: true },
    async (progress, token) => {
      const client = new SftpClient();
      token.onCancellationRequested(() => client.abort());

      try {
        const connectOpts = await presetManager.resolveConnectOptions(preset!);
        await client.connect(connectOpts);
        const done = await client.uploadFile(uri.fsPath, remotePath, (p) => {
          progress.report({ increment: p.percent, message: `${p.percent}%` });
        });
        await stateManager.setState({ lastPresetName: preset!.name });
        await stateManager.addToHistory({
          id: generateId(),
          timestamp: new Date().toISOString(),
          presetName: preset!.name,
          mode: 'separate',
          files: [fileName],
          remoteFile: remotePath,
          result: 'success',
        });
        statusBar.setSuccess(preset!.name);
        updateHasPresetsContext(presetManager);
        vscode.window.showInformationMessage(`SFTP Zip Gun: ${fileName} → ${remotePath} (${done.bytesTransferred} bytes)`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof AbortError;
        if (!isAbort) {
          statusBar.setError();
          vscode.window.showErrorMessage(`SFTP Zip Gun upload failed: ${message}`);
          await stateManager.addToHistory({
            id: generateId(),
            timestamp: new Date().toISOString(),
            presetName: preset!.name,
            mode: 'separate',
            files: [fileName],
            remoteFile: remotePath,
            result: 'error',
            errorMessage: message,
          });
        } else {
          statusBar.setIdle(preset?.name);
        }
      } finally {
        await client.disconnect();
      }
    }
  );
}

// ---------------------------------------------------------------------------
// FileZilla import handler
// ---------------------------------------------------------------------------

async function handleImportFileZilla(
  context: vscode.ExtensionContext,
  presetManager: PresetManager,
  stateManager: StateManager
): Promise<void> {
  const result = await SftpPanel.doFileZillaImport(context, presetManager);
  if (result === null) { return; } // cancelled
  updateHasPresetsContext(presetManager);
  SftpPanel.currentPanel?.refreshPresets();
  const { added, duplicates, skipped, total } = result;
  vscode.window.showInformationMessage(
    `SFTP Zip Gun Import: ${added} added, ${duplicates} duplicate${duplicates !== 1 ? 's' : ''}, ${skipped} skipped (of ${total} found).`
  );
}

// ---------------------------------------------------------------------------
// One-time preset migration
// ---------------------------------------------------------------------------

async function migrateOldPresets(): Promise<void> {
  const newCfg = vscode.workspace.getConfiguration('sftpZipGun');
  const newPresets = newCfg.get<unknown[]>('presets', []);
  if (newPresets.length > 0) { return; }

  const oldCfg = vscode.workspace.getConfiguration('sftpUpload');
  const oldPresets = oldCfg.get<unknown[]>('presets', []);
  if (oldPresets.length === 0) { return; }

  await newCfg.update('presets', oldPresets, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    'SFTP Zip Gun: Presets migrated from old sftpUpload config — please re-enter your passwords.'
  );
}

// ---------------------------------------------------------------------------
// Extension entry points
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log('info', 'SFTP Zip Gun extension activated');

  const presetManager = new PresetManager(context);
  const stateManager = new StateManager(context);

  await migrateOldPresets();

  const statusBar = createStatusBar(context, presetManager, stateManager);

  updateHasPresetsContext(presetManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('sftpZipGun.openPanel', (uri?: vscode.Uri) =>
      SftpPanel.createOrShow(context.extensionUri, context, presetManager, stateManager, (presetName) => {
        statusBar.setSuccess(presetName);
        updateHasPresetsContext(presetManager);
      })
    ),

    vscode.commands.registerCommand('sftpZipGun.quickUpload', (uri?: vscode.Uri) =>
      void handleQuickUpload(uri, context, presetManager, stateManager, statusBar)
    ),

    vscode.commands.registerCommand('sftpZipGun.importFileZilla', () =>
      void handleImportFileZilla(context, presetManager, stateManager)
    ),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sftpZipGun.presets')) {
        updateHasPresetsContext(presetManager);
        SftpPanel.currentPanel?.refreshPresets();
      }
    })
  );
}

export function deactivate(): void {}
