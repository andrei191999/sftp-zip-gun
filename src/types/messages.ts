// ---------------------------------------------------------------------------
// Preset types (non-sensitive — safe to send host → webview)
// ---------------------------------------------------------------------------

export interface PresetMeta {
  name: string;
  host: string;
  port: number;
  username: string;
  remoteDir: string;       // default / pinned remote directory
  savedPaths: string[];    // bookmarked remote directories for multi-target upload
  authType: 'password' | 'key';
  keyPath: string;         // empty string when authType === 'password'
  readOnly: boolean;       // true = drop-box server: no stat/exists/delete/mkdir
}

// Sent webview → host only (may contain secrets).
// Never echoed back from host → webview.
export interface SavePresetRequest {
  preset: PresetMeta;
  password?: string;       // undefined = keep existing SecretStorage value
  passphrase?: string;     // SSH key passphrase; undefined = keep existing
  isNew: boolean;
  originalName?: string;   // set when editing an existing preset and the name changed
}

// ---------------------------------------------------------------------------
// Upload types
// ---------------------------------------------------------------------------

export type UploadMode = 'zip' | 'separate';

export interface UploadRequest {
  mode: UploadMode;
  files: string[];        // absolute local paths
  anchorFile: string;     // anchor XML path (determines ZIP output dir)
  presetName: string;
  archiveName?: string;   // zip mode: base name without extension (timestamp appended by host)
  selectedPaths: string[]; // one or more remote directories to upload to
}

// ---------------------------------------------------------------------------
// File system types
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  size: number;           // bytes
  isDirectory: boolean;
}

export interface RemoteEntry {
  name: string;
  type: 'd' | '-' | 'l'; // directory / file / symlink
  size: number;
}

// ---------------------------------------------------------------------------
// History types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;             // ISO timestamp + random suffix for uniqueness
  timestamp: string;      // ISO 8601
  presetName: string;
  mode: UploadMode;
  files: string[];        // local file basenames
  remoteFile: string;     // uploaded file path on server
  result: 'success' | 'error';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// UI state persisted across VS Code restarts
// ---------------------------------------------------------------------------

export interface PanelState {
  lastFolder?: string;
  lastPresetName?: string;
  mode?: UploadMode;
  anchorFile?: string;
}

// ---------------------------------------------------------------------------
// Webview → Host messages
// ---------------------------------------------------------------------------

export type WebviewToHost =
  | { kind: 'ready' }
  | { kind: 'cancel' }
  | { kind: 'pickFolder' }                                       // host opens a VS Code folder picker, then responds with filesListed
  | { kind: 'listFiles';        payload: { folderPath: string } }
  | { kind: 'upload';           payload: UploadRequest }
  | { kind: 'testConnection';   payload: { presetName: string } }
  | { kind: 'getPresets' }
  | { kind: 'savePreset';       payload: SavePresetRequest }
  | { kind: 'deletePreset';     payload: { name: string } }
  | { kind: 'importFileZilla' }
  | { kind: 'getHistory' }
  | { kind: 'getState' }
  | { kind: 'setState';         payload: PanelState }
  | { kind: 'browseRemoteDir';  payload: { presetName: string; path: string } }
  | { kind: 'pinFolder';        payload: { presetName: string; remotePath: string } }
  | { kind: 'bookmarkPath';     payload: { presetName: string; remotePath: string } };

// ---------------------------------------------------------------------------
// Host → Webview messages
// ---------------------------------------------------------------------------

export type HostToWebview =
  | { kind: 'filesListed';       payload: FilesListedPayload }
  | { kind: 'uploadProgress';    payload: ProgressPayload }
  | { kind: 'uploadDone';        payload: DonePayload }
  | { kind: 'uploadError';       payload: ErrorPayload }
  | { kind: 'presets';           payload: PresetsPayload }
  | { kind: 'presetSaved';       payload: { preset: PresetMeta; originalName?: string } }
  | { kind: 'presetDeleted';     payload: { name: string } }
  | { kind: 'connectionTested';  payload: ConnectionTestedPayload }
  | { kind: 'history';           payload: { entries: HistoryEntry[] } }
  | { kind: 'state';             payload: PanelState }
  | { kind: 'remoteDirListed';   payload: RemoteDirListedPayload }
  | { kind: 'folderPinned';      payload: { presetName: string; remotePath: string } }
  | { kind: 'fileZillaImported'; payload: FileZillaImportedPayload }
  | { kind: 'log';               payload: LogPayload };

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

export interface FilesListedPayload {
  folderPath: string;
  files: FileEntry[];
}

export interface ProgressPayload {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;        // 0–100
  currentFile?: string;   // basename of file being transferred
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
}

export interface LogPayload {
  level: 'info' | 'warn' | 'error';
  text: string;
}

// ---------------------------------------------------------------------------
// Exhaustiveness helper
// ---------------------------------------------------------------------------

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(x)}`);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
