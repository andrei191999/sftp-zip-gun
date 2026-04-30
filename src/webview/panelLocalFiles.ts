import * as path from 'path';
import * as vscode from 'vscode';
import type { FileEntry } from '../types/messages';

export function getOpenFileEntries(): Array<{ path: string; name: string }> {
  const files: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri;
        if (uri.scheme === 'file' && !seen.has(uri.fsPath)) {
          seen.add(uri.fsPath);
          files.push({ path: uri.fsPath, name: path.basename(uri.fsPath) });
        }
      }
    }
  }

  return files;
}

export async function listFolderFiles(folderPath: string): Promise<FileEntry[]> {
  const uri = vscode.Uri.file(folderPath);
  const entries = await vscode.workspace.fs.readDirectory(uri);
  return entries
    .filter(([, type]) => type === vscode.FileType.File)
    .map(([name]) => ({ name, size: 0, isDirectory: false }));
}
