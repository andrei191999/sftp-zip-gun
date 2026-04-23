import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';
import { SftpPanel } from '../webview/SftpPanel';
import { updateHasPresetsContext } from './context';

export async function handleImportFileZilla(
  context: vscode.ExtensionContext,
  presetManager: PresetManager
): Promise<void> {
  const result = await SftpPanel.doFileZillaImport(context, presetManager);
  if (result === null) {
    return;
  }

  updateHasPresetsContext(presetManager);
  SftpPanel.currentPanel?.refreshPresets();
  const { added, duplicates, skipped, total } = result;
  vscode.window.showInformationMessage(
    `SFTP Zip Gun Import: ${added} added, ${duplicates} duplicate${duplicates !== 1 ? 's' : ''}, ${skipped} skipped (of ${total} found).`
  );
}
