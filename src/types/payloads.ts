import type { FileEntry, RemoteEntry } from './filesystem';
import type { HistoryEntry } from './history';
import type { PanelState } from './panelState';
import type { PresetMeta } from './preset';

export interface FilesListedPayload {
  folderPath: string;
  files: FileEntry[];
}

export interface ProgressPayload {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;        // 0–100
  currentFile?: string;   // basename of file being transferred
  currentFilePath?: string; // absolute path — used for precise row matching in the file table
}

export interface DonePayload {
  remoteFile: string;
  bytesTransferred: number;
  durationMs: number;
}

export interface ErrorPayload {
  message: string;
}

export interface PresetsPayload {
  presets: PresetMeta[];
  lastPresetName?: string;
}

export interface ConnectionTestedPayload {
  presetName: string;
  success: boolean;
  message: string;        // human-readable result
}

export interface RemoteDirListedPayload {
  presetName: string;
  path: string;
  entries: RemoteEntry[];
}

export interface FileZillaImportedPayload {
  added: number;
  duplicates: number;
  skipped: number;
  total: number;
  presets: PresetMeta[];
  newPresetNames: string[];
}

export interface FileStatusPayload {
  filePath?: string;   // pistol_file and zip_canon: absolute path of the local source row
  groupId?: number;    // zip_gun: group.id of the group being processed
  status: 'queued' | 'zipping' | 'uploading' | 'done' | 'cancelled' | 'error';
}

export interface LogPayload {
  level: 'info' | 'warn' | 'error';
  text: string;
  category?: 'upload' | 'conn' | 'import' | 'accounts' | 'sys';
  replace?: boolean;   // if true, replace the last log entry in-place (for progress updates)
}

export interface HistoryPayload {
  entries: HistoryEntry[];
}

export interface StatePayload extends PanelState {}
