import type { UploadMode } from './upload';

export interface HistoryEntry {
  id: string;             // ISO timestamp + random suffix for uniqueness
  timestamp: string;      // ISO 8601
  presetName: string;
  mode: UploadMode;
  files: string[];        // local file basenames (existing)
  folderPath?: string;    // source folder path (new — optional for backwards compat)
  filePaths?: string[];   // absolute paths parallel to files[] (new — optional)
  remoteFile: string;     // uploaded file path on server
  result: 'success' | 'error';
  errorMessage?: string;
}
