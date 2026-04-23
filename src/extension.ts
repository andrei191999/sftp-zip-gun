import * as vscode from 'vscode';
import { PresetManager } from './config/presetManager';
import { StateManager } from './config/stateManager';
import { SftpPanel } from './webview/SftpPanel';
import { initLogger, log } from './logger';
import { updateHasPresetsContext } from './extension/context';
import { handleImportFileZilla } from './extension/importFileZilla';
import { migrateOldPresets } from './extension/migration';
import { StatusBarController } from './extension/statusBarController';
import { createTestModeCommands, isTestMode } from './extension/testMode';
import { handleQuickUpload } from './extension/quickUpload';

// ---------------------------------------------------------------------------
// Extension entry points
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log('info', 'SFTP Zip Gun extension activated');

  const presetManager = new PresetManager(context);
  const stateManager = new StateManager(context);

  const statusBar = new StatusBarController();
  statusBar.initialize(context, stateManager);
  try {
    await migrateOldPresets();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log('warn', `Preset migration failed: ${message}`);
    void vscode.window.showWarningMessage(
      'SFTP Zip Gun: Preset migration failed. Existing commands are still available; check the output channel for details.'
    );
  }

  updateHasPresetsContext(presetManager);
  SftpPanel.currentPanel?.refreshPresets();

  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand('sftpZipGun.openPanel', (uri?: vscode.Uri) =>
      SftpPanel.createOrShow(context.extensionUri, context, presetManager, stateManager, (presetName) => {
        statusBar.setSuccess(presetName);
        updateHasPresetsContext(presetManager);
      })
    ),

    vscode.commands.registerCommand('sftpZipGun.quickUpload', (uri?: vscode.Uri) =>
      void handleQuickUpload(uri, presetManager, stateManager, statusBar)
    ),

    vscode.commands.registerCommand('sftpZipGun.importFileZilla', () =>
      void handleImportFileZilla(context, presetManager)
    ),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sftpZipGun.presets')) {
        updateHasPresetsContext(presetManager);
        SftpPanel.currentPanel?.refreshPresets();
      }
    })
  ];

  if (isTestMode()) {
    disposables.push(...createTestModeCommands(presetManager, stateManager));
  }

  context.subscriptions.push(...disposables);
}

export function deactivate(): void {}
