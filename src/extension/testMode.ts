import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';
import { StateManager } from '../config/stateManager';
import type { HistoryEntry, PanelState, SavePresetRequest } from '../types/messages';
import { updateHasPresetsContext } from './context';
import { SftpPanel } from '../webview/SftpPanel';

export function isTestMode(): boolean {
  return process.env.SFTP_ZIP_GUN_TEST_MODE === '1';
}

export async function resetTestState(
  presetManager: PresetManager,
  stateManager: StateManager
): Promise<void> {
  await presetManager.clearAll();
  await stateManager.clearHistory();
  await stateManager.clearState();
}

export async function seedTestState(
  presetManager: PresetManager,
  stateManager: StateManager,
  payload: {
    presets: SavePresetRequest[];
    state?: Partial<PanelState>;
  }
): Promise<void> {
  await resetTestState(presetManager, stateManager);
  for (const req of payload.presets) {
    await presetManager.save(req);
  }
  if (payload.state) {
    await stateManager.setState(payload.state);
  }
}

export function createTestModeCommands(
  presetManager: PresetManager,
  stateManager: StateManager
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('sftpZipGun._test.resetState', async () => {
      await resetTestState(presetManager, stateManager);
      updateHasPresetsContext(presetManager);
      SftpPanel.currentPanel?.refreshPresets();
    }),
    vscode.commands.registerCommand(
      'sftpZipGun._test.seedPresets',
      async (payload: { presets: SavePresetRequest[]; state?: Partial<PanelState> }) => {
        await seedTestState(presetManager, stateManager, payload);
        updateHasPresetsContext(presetManager);
        SftpPanel.currentPanel?.refreshPresets();
      }
    ),
    vscode.commands.registerCommand('sftpZipGun._test.getHistory', (): HistoryEntry[] =>
      stateManager.getHistory()
    ),
  ];
}
