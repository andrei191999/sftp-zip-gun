import * as vscode from 'vscode';
import * as path from 'path';
import { PresetManager } from '../config/presetManager';
import { StateManager } from '../config/stateManager';
import { SftpClient } from '../sftp/sftpClient';
import {
  WebviewToHost, HostToWebview, assertNever,
  PresetMeta, UploadMode,
} from '../types/messages';
import { log } from '../logger';
import { sanitizeUserFacingError } from '../errors/userFacingError';
import { PanelUploadSession } from './panelUploadSession';
import { importFileZillaPresets } from './panelFileZillaImport';
import { getOpenFileEntries, listFolderFiles } from './panelLocalFiles';
import { getPanelHtml } from './panelHtml';

export class SftpPanel {
  static currentPanel: SftpPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private readonly _presetManager: PresetManager;
  private readonly _stateManager: StateManager;
  private readonly _onUploadComplete?: (presetName: string) => void;
  private _disposables: vscode.Disposable[] = [];
  private _lastOpenFilePaths: string[] = [];
  private readonly _uploadSession: PanelUploadSession;

  private _isUploadBusy(): boolean {
    return this._uploadSession.isBusy;
  }

  private _postUploadLog(text: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this._post({ kind: 'log', payload: { level, text, category: 'upload' } });
  }

  private _setFileStatuses(filePaths: string[], status: 'queued' | 'zipping' | 'uploading' | 'done' | 'cancelled' | 'error'): void {
    for (const filePath of filePaths) {
      this._post({ kind: 'fileStatus', payload: { filePath, status } });
    }
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    presetManager: PresetManager,
    stateManager: StateManager,
    onUploadComplete?: (presetName: string) => void
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (SftpPanel.currentPanel) {
      SftpPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'sftpZipGun',
      'SFTP Zip Gun',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      }
    );

    SftpPanel.currentPanel = new SftpPanel(panel, extensionUri, context, presetManager, stateManager, onUploadComplete);
    log('info', 'SFTP Zip Gun panel opened');
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    presetManager: PresetManager,
    stateManager: StateManager,
    onUploadComplete?: (presetName: string) => void
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;
    this._presetManager = presetManager;
    this._stateManager = stateManager;
    this._onUploadComplete = onUploadComplete;
    this._uploadSession = new PanelUploadSession({
      presetManager,
      stateManager,
      post: (message) => this._post(message),
      onUploadComplete,
    });

    this._panel.webview.html = getPanelHtml(this._extensionUri, this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToHost) => this._onMessage(msg),
      null,
      this._disposables
    );
    vscode.window.tabGroups.onDidChangeTabs(() => {
      this._handleGetOpenFiles();
    }, null, this._disposables);
  }

  private _post(msg: HostToWebview): void {
    void this._panel.webview.postMessage(msg);
  }

  refreshPresets(): void {
    const presets = this._presetManager.getAll();
    const lastPresetName = this._stateManager.getState().lastPresetName;
    this._post({ kind: 'presets', payload: { presets, lastPresetName } });
  }

  static doFileZillaImport = importFileZillaPresets;

  dispose(): void {
    log('info', 'SFTP Zip Gun panel disposed');
    SftpPanel.currentPanel = undefined;
    this._uploadSession.dispose();
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  private _onMessage(msg: WebviewToHost): void {
    switch (msg.kind) {
      case 'ready': {
        this.refreshPresets();
        const state = this._stateManager.getState();
        if (!state.mode) {
          const dflt = vscode.workspace.getConfiguration('sftpZipGun').get<UploadMode>('defaultMode');
          if (dflt) { state.mode = dflt; }
        }
        this._post({ kind: 'state', payload: state });
        this._post({ kind: 'history', payload: { entries: this._stateManager.getHistory() } });
        const folderToList = state.lastFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (folderToList) { void this._handleListFiles(folderToList); }
        this._handleGetOpenFiles();
        break;
      }

      case 'getState': {
        this._post({ kind: 'state', payload: this._stateManager.getState() });
        break;
      }

      case 'setState': {
        void this._stateManager.setState(msg.payload);
        break;
      }

      case 'getPresets': {
        this.refreshPresets();
        break;
      }

      case 'getHistory': {
        this._post({ kind: 'history', payload: { entries: this._stateManager.getHistory() } });
        break;
      }

      case 'pickFolder': {
        if (this._isUploadBusy()) {
          this._postUploadLog('Cannot change the local folder while an upload is running.', 'warn');
          break;
        }
        void this._handlePickFolder();
        break;
      }

      case 'listFiles': {
        if (this._isUploadBusy()) {
          this._postUploadLog('Cannot change the local folder while an upload is running.', 'warn');
          break;
        }
        void this._handleListFiles(msg.payload.folderPath);
        break;
      }

      case 'upload': {
        void this._uploadSession.handleUpload(msg.payload);
        break;
      }

      case 'cancel': {
        this._uploadSession.cancel();
        break;
      }

      case 'testConnection': {
        void this._handleTestConnection(msg.payload.presetName);
        break;
      }

      case 'savePreset': {
        void this._handleSavePreset(msg.payload);
        break;
      }

      case 'deletePreset': {
        void this._handleDeletePreset(msg.payload.name);
        break;
      }

      case 'importFileZilla': {
        void this._handleImportFileZilla();
        break;
      }

      case 'browseRemoteDir': {
        void this._handleBrowseRemoteDir(msg.payload.presetName, msg.payload.path);
        break;
      }

      case 'pinFolder': {
        void this._handlePinFolder(msg.payload.presetName, msg.payload.remotePath);
        break;
      }

      case 'bookmarkPath': {
        void this._handleBookmarkPath(msg.payload.presetName, msg.payload.remotePath);
        break;
      }

      case 'getOpenFiles': {
        this._handleGetOpenFiles();
        break;
      }

      case 'openFileInEditor': {
        const filePath = msg.payload.filePath;
        if (typeof filePath !== 'string' || !filePath) { break; }
        const targetColumn = vscode.window.visibleTextEditors[0]?.viewColumn ?? vscode.ViewColumn.Beside;
        vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false, viewColumn: targetColumn }).then(
          undefined,
          () => { void vscode.window.showWarningMessage(`Cannot open: ${path.basename(filePath)}`); }
        );
        break;
      }

      case 'switchFolder': {
        if (this._isUploadBusy()) {
          this._postUploadLog('Cannot change the local folder while an upload is running.', 'warn');
          break;
        }
        void this._handleListFiles(msg.payload.folderPath);
        break;
      }

      default: {
        assertNever(msg);
      }
    }
  }

  private _handleGetOpenFiles(): void {
    const files = getOpenFileEntries();
    const newPaths = files.map(file => file.path);
    if (JSON.stringify(newPaths.sort()) !== JSON.stringify(this._lastOpenFilePaths.sort())) {
      this._post({ kind: 'openFiles', payload: { files } });
      this._lastOpenFilePaths = [...newPaths];
    }
  }

  private async _handlePickFolder(): Promise<void> {
    if (this._isUploadBusy()) {
      this._postUploadLog('Cannot change the local folder while an upload is running.', 'warn');
      return;
    }
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select folder to upload from',
    });
    if (!uris || uris.length === 0) { return; }
    await this._handleListFiles(uris[0].fsPath);
  }

  private async _handleListFiles(folderPath: string): Promise<void> {
    if (this._isUploadBusy()) {
      this._postUploadLog('Cannot change the local folder while an upload is running.', 'warn');
      return;
    }
    try {
      const files = await listFolderFiles(folderPath);
      this._post({ kind: 'filesListed', payload: { folderPath, files } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Failed to list folder "${folderPath}": ${message}`);
      this._post({
        kind: 'log',
        payload: { level: 'error', text: `Failed to list folder: ${sanitizeUserFacingError(message)}` },
      });
    }
  }

  private async _handleTestConnection(presetName: string): Promise<void> {
    const preset = this._presetManager.getByName(presetName);
    if (!preset) {
      this._post({ kind: 'connectionTested', payload: { presetName, success: false, message: 'Preset not found.' } });
      return;
    }
    const client = new SftpClient();
    try {
      const connectOpts = await this._presetManager.resolveConnectOptions(preset);
      await client.connect(connectOpts);
      this._post({ kind: 'connectionTested', payload: { presetName, success: true, message: `Connected to ${preset.host}:${preset.port} successfully.` } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Connection test failed for "${presetName}": ${message}`);
      this._post({
        kind: 'connectionTested',
        payload: { presetName, success: false, message: sanitizeUserFacingError(message) },
      });
    } finally {
      await client.disconnect();
    }
  }

  private async _handleSavePreset(payload: import('../types/messages').SavePresetRequest): Promise<void> {
    const saved = await this._presetManager.save(payload);
    this._post({ kind: 'presetSaved', payload: { preset: saved, originalName: payload.originalName, isNew: payload.isNew } });
  }

  private async _handleDeletePreset(name: string): Promise<void> {
    await this._presetManager.delete(name);
    this._post({ kind: 'presetDeleted', payload: { name } });
  }

  private async _handleImportFileZilla(): Promise<void> {
    const result = await importFileZillaPresets(this._context, this._presetManager);
    if (result === null) { return; }
    const { added, duplicates, skipped, total, presets, newPresetNames } = result;
    this._post({
      kind: 'fileZillaImported',
      payload: { added, duplicates, skipped, total, presets, newPresetNames },
    });
    vscode.window.showInformationMessage(
      `SFTP Import: ${added} added, ${duplicates} duplicate${duplicates !== 1 ? 's' : ''}, ${skipped} skipped (of ${total} found).`
    );
  }

  private async _handleBrowseRemoteDir(presetName: string, remotePath: string): Promise<void> {
    const preset = this._presetManager.getByName(presetName);
    if (!preset) { return; }
    const client = new SftpClient();
    try {
      const connectOpts = await this._presetManager.resolveConnectOptions(preset);
      await client.connect(connectOpts);
      const entries = await client.listDirectory(remotePath);
      this._post({ kind: 'remoteDirListed', payload: { presetName, path: remotePath, entries } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Remote browse failed for "${presetName}" at "${remotePath}": ${message}`);
      this._post({
        kind: 'log',
        payload: { level: 'error', text: `Remote browse failed: ${sanitizeUserFacingError(message)}` },
      });
    } finally {
      await client.disconnect();
    }
  }

  private async _handleBookmarkPath(presetName: string, remotePath: string): Promise<void> {
    await this._presetManager.addSavedPath(presetName, remotePath);
    this.refreshPresets();
    vscode.window.showInformationMessage(`Bookmarked: ${remotePath}`);
  }

  private async _handlePinFolder(presetName: string, remotePath: string): Promise<void> {
    const preset = this._presetManager.getByName(presetName);
    if (!preset) { return; }
    const normalized = remotePath.replace(/\/$/, '') || '/';
    const oldDefault = (preset.remoteDir || '/').replace(/\/$/, '') || '/';
    let newSavedPaths = preset.savedPaths.filter(p => p !== normalized);
    if (oldDefault !== normalized && !newSavedPaths.includes(oldDefault)) {
      newSavedPaths = [...newSavedPaths, oldDefault];
    }
    await this._presetManager.save({
      preset: { ...preset, remoteDir: normalized, savedPaths: newSavedPaths },
      isNew: false,
    });
    this.refreshPresets();
    this._post({ kind: 'folderPinned', payload: { presetName, remotePath: normalized } });
  }
}
