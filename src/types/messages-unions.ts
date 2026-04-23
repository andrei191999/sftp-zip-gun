import type { HistoryEntry } from './history';
import type { PanelState } from './panelState';
import type {
  ConnectionTestedPayload,
  DonePayload,
  ErrorPayload,
  FileStatusPayload,
  FileZillaImportedPayload,
  FilesListedPayload,
  HistoryPayload,
  LogPayload,
  PresetsPayload,
  ProgressPayload,
  RemoteDirListedPayload,
} from './payloads';
import type { PresetMeta, SavePresetRequest } from './preset';
import type { UploadRequest } from './upload';

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
  | { kind: 'bookmarkPath';     payload: { presetName: string; remotePath: string } }
  | { kind: 'getOpenFiles' }
  | { kind: 'openFileInEditor'; payload: { filePath: string } }
  | { kind: 'switchFolder';     payload: { folderPath: string } };

export type HostToWebview =
  | { kind: 'filesListed';       payload: FilesListedPayload }
  | { kind: 'uploadProgress';    payload: ProgressPayload }
  | { kind: 'fileStatus';        payload: FileStatusPayload }
  | { kind: 'uploadDone';        payload: DonePayload }
  | { kind: 'uploadError';       payload: ErrorPayload }
  | { kind: 'presets';           payload: PresetsPayload }
  | { kind: 'presetSaved';       payload: { preset: PresetMeta; originalName?: string; isNew: boolean } }
  | { kind: 'presetDeleted';     payload: { name: string } }
  | { kind: 'connectionTested';  payload: ConnectionTestedPayload }
  | { kind: 'history';           payload: HistoryPayload }
  | { kind: 'state';             payload: PanelState }
  | { kind: 'remoteDirListed';   payload: RemoteDirListedPayload }
  | { kind: 'folderPinned';      payload: { presetName: string; remotePath: string } }
  | { kind: 'fileZillaImported'; payload: FileZillaImportedPayload }
  | { kind: 'openFiles';         payload: { files: { path: string; name: string }[] } }
  | { kind: 'log';               payload: LogPayload };
