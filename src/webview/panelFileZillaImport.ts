import * as fs from 'fs';
import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';
import { parseFileZillaXml } from '../config/fileZillaImporter';
import type { PresetMeta } from '../types/messages';

export interface FileZillaImportSummary {
  added: number;
  duplicates: number;
  skipped: number;
  total: number;
  presets: PresetMeta[];
  newPresetNames: string[];
}

export async function importFileZillaPresets(
  context: vscode.ExtensionContext,
  presetManager: PresetManager
): Promise<FileZillaImportSummary | null> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'FileZilla XML': ['xml'] },
    title: 'Select FileZilla Site Manager Export',
  });
  if (!uris || uris.length === 0) {
    return null;
  }

  const xmlContent = fs.readFileSync(uris[0].fsPath, 'utf8');
  const existingBefore = presetManager.getAll();
  const result = parseFileZillaXml(xmlContent, existingBefore);

  const savedPresets: PresetMeta[] = [];
  for (const imported of result.presets) {
    const { password, ...preset } = imported;
    const saved = await presetManager.save({
      preset: preset as PresetMeta,
      password,
      isNew: true,
    });
    savedPresets.push(saved);
  }

  const savedNames = new Set(savedPresets.map((preset) => preset.name));
  const finalPresets = [...existingBefore.filter((preset) => !savedNames.has(preset.name)), ...savedPresets];
  const added = result.presets.length;

  return {
    added,
    duplicates: result.duplicates,
    skipped: result.skipped,
    total: added + result.duplicates + result.skipped,
    presets: finalPresets,
    newPresetNames: savedPresets.map((preset) => preset.name),
  };
}
