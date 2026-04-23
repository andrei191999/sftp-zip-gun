import * as vscode from 'vscode';

export async function migrateOldPresets(): Promise<void> {
  const newCfg = vscode.workspace.getConfiguration('sftpZipGun');
  const newPresets = newCfg.get<unknown[]>('presets', []);
  if (newPresets.length > 0) {
    return;
  }

  const oldCfg = vscode.workspace.getConfiguration('sftpUpload');
  const oldPresets = oldCfg.get<unknown[]>('presets', []);
  if (oldPresets.length === 0) {
    return;
  }

  await newCfg.update('presets', oldPresets, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    'SFTP Zip Gun: Presets migrated from old sftpUpload config — please re-enter your passwords.'
  );
}
