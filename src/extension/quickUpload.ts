import * as path from 'path';
import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';
import { StateManager } from '../config/stateManager';
import { SftpClient } from '../sftp/sftpClient';
import { StatusBarController } from './statusBarController';
import { runUploadRunner } from '../upload/uploadRunner';
import { updateHasPresetsContext } from './context';
import { log } from '../logger';

export async function handleQuickUpload(
  commandUri: vscode.Uri | undefined,
  presetManager: PresetManager,
  stateManager: StateManager,
  statusBar: StatusBarController
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

  let preset = presets.find((entry) => entry.name === stateManager.getState().lastPresetName);
  if (!preset) {
    const pick = await vscode.window.showQuickPick(
      presets.map((entry) => ({
        label: `${entry.readOnly ? '🔒 ' : ''}${entry.name}`,
        description: `${entry.host}:${entry.port}`,
        preset: entry,
      })),
      { title: 'Select SFTP Preset for Quick Upload' }
    );
    if (!pick) {
      return;
    }
    preset = pick.preset;
  }

  const fileName = path.basename(uri.fsPath);
  statusBar.setUploading();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `SFTP: Uploading ${fileName}`, cancellable: true },
    async (progress, token) => {
      const transport = new SftpClient();
      token.onCancellationRequested(() => transport.abort());

      const result = await runUploadRunner({
        preset,
        connectOptions: await presetManager.resolveConnectOptions(preset),
        request: {
          mode: 'pistol_file',
          presetName: preset.name,
          selectedPaths: [preset.remoteDir],
          files: [uri.fsPath],
        },
        transport,
        stateManager,
        zipBuilder: async () => {
          throw new Error('Quick upload does not build archives.');
        },
        onProgress: (uploadProgress) => {
          progress.report({ increment: uploadProgress.percent, message: `${uploadProgress.percent}%` });
        },
      });

      if (result.status === 'success') {
        statusBar.setSuccess(preset.name);
        updateHasPresetsContext(presetManager);
        vscode.window.showInformationMessage(
          `SFTP Zip Gun: ${fileName} → ${result.remoteFile} (${result.bytesTransferred} bytes)`
        );
        return;
      }

      if (result.status === 'cancelled') {
        statusBar.setIdle(preset.name);
        return;
      }

      log('error', `Quick upload failed for preset "${preset.name}": ${result.errorMessage}`);
      statusBar.setError();
      vscode.window.showErrorMessage(`SFTP Zip Gun upload failed: ${result.errorMessage}`);
    }
  );
}
