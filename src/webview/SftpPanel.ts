import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PresetManager } from '../config/presetManager';
import { StateManager } from '../config/stateManager';
import { SftpClient, AbortError } from '../sftp/sftpClient';
import { buildZip } from '../sftp/zipBuilder';
import { parseFileZillaXml } from '../config/fileZillaImporter';
import {
  WebviewToHost, HostToWebview, assertNever,
  PresetMeta, HistoryEntry, UploadMode, UploadRequest, generateId,
} from '../types/messages';
import { log } from '../logger';

export class SftpPanel {
  static currentPanel: SftpPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private readonly _presetManager: PresetManager;
  private readonly _stateManager: StateManager;
  private readonly _onUploadComplete?: (presetName: string) => void;
  private _disposables: vscode.Disposable[] = [];
  private _activeClient: SftpClient | undefined;

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
      'sftpUpload',
      'SFTP Upload',
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
    log('info', 'SFTP Upload panel opened');
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

    this._panel.webview.html = this._getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToHost) => this._onMessage(msg),
      null,
      this._disposables
    );
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js')
    );

    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    html = html
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{scriptUri\}\}/g, jsUri.toString());

    return html;
  }

  private _post(msg: HostToWebview): void {
    void this._panel.webview.postMessage(msg);
  }

  refreshPresets(): void {
    const presets = this._presetManager.getAll();
    const lastPresetName = this._stateManager.getState().lastPresetName;
    this._post({ kind: 'presets', payload: { presets, lastPresetName } });
  }

  static async doFileZillaImport(
    context: vscode.ExtensionContext,
    presetManager: PresetManager
  ): Promise<{ added: number; duplicates: number; skipped: number; total: number } | null> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'FileZilla XML': ['xml'] },
      title: 'Select FileZilla Site Manager Export',
    });
    if (!uris || uris.length === 0) { return null; }

    const xmlContent = fs.readFileSync(uris[0].fsPath, 'utf8');
    const result = parseFileZillaXml(xmlContent, presetManager.getAll());

    for (const p of result.presets) {
      const { password, ...preset } = p;
      await presetManager.save({
        preset: preset as PresetMeta,
        password,
        isNew: true,
      });
    }

    const added = result.presets.length;
    const total = added + result.duplicates + result.skipped;
    return { added, duplicates: result.duplicates, skipped: result.skipped, total };
  }

  dispose(): void {
    log('info', 'SFTP Upload panel disposed');
    SftpPanel.currentPanel = undefined;
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
        this._post({ kind: 'state', payload: state });
        this._post({ kind: 'history', payload: { entries: this._stateManager.getHistory() } });
        const folderToList = state.lastFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (folderToList) { void this._handleListFiles(folderToList); }
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
        void this._handlePickFolder();
        break;
      }

      case 'listFiles': {
        void this._handleListFiles(msg.payload.folderPath);
        break;
      }

      case 'upload': {
        void this._handleUpload(msg.payload);
        break;
      }

      case 'cancel': {
        this._activeClient?.abort();
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

      default: {
        assertNever(msg);
      }
    }
  }

  private async _handlePickFolder(): Promise<void> {
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
    try {
      const uri = vscode.Uri.file(folderPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const files = entries
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => ({ name, size: 0, isDirectory: false }));
      this._post({ kind: 'filesListed', payload: { folderPath, files } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ kind: 'log', payload: { level: 'error', text: `Failed to list folder: ${message}` } });
    }
  }

  private async _handleUpload(payload: UploadRequest): Promise<void> {
    const { mode, files, anchorFile, presetName, archiveName, selectedPaths } = payload;

    const preset = this._presetManager.getByName(presetName);
    if (!preset) {
      this._post({ kind: 'uploadError', payload: { message: `Preset "${presetName}" not found.` } });
      return;
    }

    let connectOpts: Awaited<ReturnType<typeof this._presetManager.resolveConnectOptions>>;
    try {
      connectOpts = await this._presetManager.resolveConnectOptions(preset);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this._post({ kind: 'uploadError', payload: { message } });
      return;
    }

    // Resolve target paths — fall back to preset.remoteDir if nothing was sent
    const remoteBases = (selectedPaths && selectedPaths.length > 0 ? selectedPaths : [preset.remoteDir])
      .map(p => p.replace(/\/$/, '') || '/');

    let uploadList: string[];
    let uploadedBasenames: string[];

    if (mode === 'zip') {
      const stem = archiveName ?? path.basename(anchorFile, path.extname(anchorFile));
      this._post({ kind: 'log', payload: { level: 'info', text: 'Building ZIP archive…' } });
      const zipPath = await buildZip(files, anchorFile, stem);
      uploadList = [zipPath];
      uploadedBasenames = [path.basename(zipPath)];
    } else {
      uploadList = files;
      uploadedBasenames = files.map(f => path.basename(f));
    }

    // Total size accounts for uploading to each remote path
    const pathCount = remoteBases.length;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SFTP: Uploading to ${preset.name}`,
        cancellable: true,
      },
      async (progress, token) => {
        const client = new SftpClient();
        this._activeClient = client;
        token.onCancellationRequested(() => {
          this._post({ kind: 'log', payload: { level: 'warn', text: 'Upload cancelled.' } });
          client.abort();
        });

        let totalSize = 0;
        try {
          totalSize = uploadList.reduce((sum, f) => sum + fs.statSync(f).size, 0) * pathCount;
        } catch { totalSize = 0; }

        try {
          await client.connect(connectOpts);
          this._post({ kind: 'log', payload: { level: 'info', text: `Connected to ${preset.host}:${preset.port}` } });

          let overallTransferred = 0;

          for (let pi = 0; pi < remoteBases.length; pi++) {
            const remoteBase = remoteBases[pi];
            const pathPrefix = remoteBases.length > 1 ? `[${pi + 1}/${remoteBases.length}] ${remoteBase}: ` : '';

            for (const localPath of uploadList) {
              const basename = path.basename(localPath);
              const remotePath = remoteBase === '/' ? `/${basename}` : `${remoteBase}/${basename}`;

              this._post({ kind: 'log', payload: { level: 'info', text: `${pathPrefix}Uploading ${basename}…` } });

              const done = await client.uploadFile(localPath, remotePath, (p) => {
                const currentTransferred = overallTransferred + p.bytesTransferred;
                const overallPercent = totalSize > 0
                  ? Math.round((currentTransferred / totalSize) * 100)
                  : p.percent;
                this._post({
                  kind: 'uploadProgress',
                  payload: {
                    bytesTransferred: currentTransferred,
                    totalBytes: totalSize,
                    percent: overallPercent,
                    currentFile: basename,
                  },
                });
                progress.report({ increment: 0, message: `${pathPrefix}${basename} — ${p.percent}%` });
              });

              overallTransferred += done.bytesTransferred;
              this._post({ kind: 'log', payload: { level: 'info', text: `${pathPrefix}✓ ${basename} (${done.bytesTransferred} bytes, ${done.durationMs}ms)` } });
            }
          }

          const finalRemote = remoteBases.length === 1
            ? `${remoteBases[0]}/${path.basename(uploadList[uploadList.length - 1])}`
            : remoteBases.join(', ');

          const entry: HistoryEntry = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            presetName: preset.name,
            mode,
            files: uploadedBasenames,
            remoteFile: finalRemote,
            result: 'success',
          };
          await this._stateManager.addToHistory(entry);
          await this._stateManager.setState({ lastPresetName: preset.name });

          this._post({
            kind: 'uploadDone',
            payload: {
              remoteFile: finalRemote,
              bytesTransferred: overallTransferred,
              durationMs: 0,
            },
          });

          this._onUploadComplete?.(preset.name);

        } catch (err: unknown) {
          const isAbort = err instanceof AbortError;
          const message = err instanceof Error ? err.message : String(err);

          if (!isAbort) {
            this._post({ kind: 'uploadError', payload: { message } });
            vscode.window.showErrorMessage(`SFTP Upload failed: ${message}`);

            await this._stateManager.addToHistory({
              id: generateId(),
              timestamp: new Date().toISOString(),
              presetName: preset.name,
              mode,
              files: uploadedBasenames,
              remoteFile: remoteBases[0] ?? '',
              result: 'error',
              errorMessage: message,
            });
          }
        } finally {
          this._activeClient = undefined;
          await client.disconnect();
        }
      }
    );
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
      await client.disconnect();
      this._post({ kind: 'connectionTested', payload: { presetName, success: true, message: `Connected to ${preset.host}:${preset.port} successfully.` } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Connection test failed for "${presetName}": ${message}`);
      this._post({ kind: 'connectionTested', payload: { presetName, success: false, message } });
    }
  }

  private async _handleSavePreset(payload: import('../types/messages').SavePresetRequest): Promise<void> {
    await this._presetManager.save(payload);
    // Re-read from config to reflect any normalisation applied during save (e.g. readOnly defaulting).
    const saved = this._presetManager.getByName(payload.preset.name);
    if (saved) {
      this._post({ kind: 'presetSaved', payload: { preset: saved, originalName: payload.originalName } });
    }
  }

  private async _handleDeletePreset(name: string): Promise<void> {
    await this._presetManager.delete(name);
    this._post({ kind: 'presetDeleted', payload: { name } });
  }

  private async _handleImportFileZilla(): Promise<void> {
    const result = await SftpPanel.doFileZillaImport(this._context, this._presetManager);
    if (result === null) { return; }
    const { added, duplicates, skipped, total } = result;
    const presets = this._presetManager.getAll();
    this._post({
      kind: 'fileZillaImported',
      payload: { added, duplicates, skipped, total, presets },
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
      await client.disconnect();
      this._post({ kind: 'remoteDirListed', payload: { presetName, path: remotePath, entries } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Remote browse failed for "${presetName}" at "${remotePath}": ${message}`);
      this._post({ kind: 'log', payload: { level: 'error', text: `Remote browse failed: ${message}` } });
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
    await this._presetManager.save({
      preset: { ...preset, remoteDir: remotePath },
      isNew: false,
    });
    this._post({ kind: 'folderPinned', payload: { presetName, remotePath } });
  }
}
