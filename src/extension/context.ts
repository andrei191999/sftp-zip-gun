import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';

export function updateHasPresetsContext(presetManager: PresetManager): void {
  void vscode.commands.executeCommand(
    'setContext',
    'sftpZipGun.hasPresets',
    presetManager.getAll().length > 0
  );
}
