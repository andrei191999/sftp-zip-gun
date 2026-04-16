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
  private _zipping = false;
  private _uploading = false;
  private _currentRemotePath: string | undefined;

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
  ): Promise<{ added: number; duplicates: number; skipped: number; total: number; presets: PresetMeta[]; newPresetNames: string[] } | null> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'FileZilla XML': ['xml'] },
      title: 'Select FileZilla Site Manager Export',
    });
    if (!uris || uris.length === 0) { return null; }

    const xmlContent = fs.readFileSync(uris[0].fsPath, 'utf8');
    const existingBefore = presetManager.getAll();
    const result = parseFileZillaXml(xmlContent, existingBefore);

    const savedPresets: PresetMeta[] = [];
    for (const p of result.presets) {
      const { password, ...preset } = p;
      const saved = await presetManager.save({
        preset: preset as PresetMeta,
        password,
        isNew: true,
      });
      savedPresets.push(saved);
    }

    const savedNames = new Set(savedPresets.map(p => p.name));
    const finalPresets = [...existingBefore.filter(p => !savedNames.has(p.name)), ...savedPresets];

    const added = result.presets.length;
    const total = added + result.duplicates + result.skipped;
    return { added, duplicates: result.duplicates, skipped: result.skipped, total, presets: finalPresets, newPresetNames: savedPresets.map(p => p.name) };
  }

  dispose(): void {
    log('info', 'SFTP Zip Gun panel disposed');
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
        if (this._zipping) {
          this._post({ kind: 'log', payload: { level: 'warn', text: 'Cancellation triggered \u2014 waiting for ZIP to finish\u2026', category: 'upload' } });
          this._activeClient?.abort();
        } else if (this._uploading) {
          this._activeClient?.forceAbort();
        } else {
          this._activeClient?.abort();
        }
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
        void vscode.window.showTextDocument(vscode.Uri.file(msg.payload.filePath));
        break;
      }

      case 'switchFolder': {
        void this._handleListFiles(msg.payload.folderPath);
        break;
      }

      default: {
        assertNever(msg);
      }
    }
  }

  private _handleGetOpenFiles(): void {
    const files: { path: string; name: string }[] = [];
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
    this._post({ kind: 'openFiles', payload: { files } });
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

    const client = new SftpClient();
    this._activeClient = client;

    // withProgress wraps the entire job (zip + upload) so the VS Code notification
    // shows progress and its cancel button works throughout both phases.
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SFTP: ${preset.name}`,
        cancellable: true,
      },
      async (progress, token) => {
        // ── Cancellation from the VS Code notification ───────────────────────
        // uploadErrorPosted tracks whether onCancellationRequested already sent
        // uploadError so the catch block can avoid a duplicate log entry.
        let uploadErrorPosted = false;
        // When notification-cancel fires during the zip phase, VS Code dismisses the
        // original notification immediately. A replacement (non-cancellable) notification
        // is spawned instead and stays open until the zip finishes, so users doing a
        // background upload without the panel open still see progress feedback.
        let cancelZipProgress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
        let zipPhaseResolve!: () => void;
        const zipPhaseDone = new Promise<void>(resolve => { zipPhaseResolve = resolve; });

        token.onCancellationRequested(() => {
          if (this._uploading) {
            // Force-stop first so put() rejects before uploadDone can fire,
            // then post the error so the webview never sees success after cancel.
            this._activeClient?.forceAbort();
            this._post({ kind: 'uploadError', payload: { message: 'Upload cancelled.' } });
            uploadErrorPosted = true;
          } else if (this._zipping) {
            // Zip phase — archiver can't be stopped mid-stream. Flag abort and
            // warn the user, then spawn a replacement notification that stays open
            // until the zip finishes so background-upload users keep seeing progress.
            this._post({ kind: 'log', payload: { level: 'warn', text: 'Cancellation triggered \u2014 waiting for ZIP to finish\u2026', category: 'upload' } });
            this._activeClient?.abort();
            void vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `SFTP: ${preset.name}`, cancellable: false },
              async (p2) => {
                cancelZipProgress = p2;
                p2.report({ message: 'Waiting for ZIP to finish\u2026 (cancellation pending)' });
                await zipPhaseDone;
                cancelZipProgress = undefined;
              }
            );
          } else {
            this._activeClient?.abort();
          }
        });

        let uploadList: string[] = [];
        let uploadedBasenames: string[] = [];

        // Single try/catch/finally covers both phases so that a zip-phase failure
        // still resets state, disconnects the client, and posts uploadError.
        try {
          // ── ZIP phase ───────────────────────────────────────────────────────
          if (mode === 'zip_canon') {
            const stem = archiveName ?? path.basename(anchorFile, path.extname(anchorFile));
            this._post({ kind: 'log', payload: { level: 'info', text: `Building ZIP archive\u2026 (${files.length} file${files.length === 1 ? '' : 's'})`, category: 'sys' } });
            progress.report({ message: `Building ZIP\u2026 (${files.length} files)` });
            this._zipping = true;
            let firstZipProgress = true;
            try {
              const zipPath = await buildZip(files, anchorFile, stem, (processed, total) => {
                this._post({ kind: 'log', payload: { level: 'info', text: `Zipping\u2026 ${processed}/${total}`, category: 'sys', replace: !firstZipProgress } });
                const zipMsg = `Building ZIP\u2026 ${processed}/${total}`;
                progress.report({ message: zipMsg });
                cancelZipProgress?.report({ message: `${zipMsg} (cancellation pending)` });
                firstZipProgress = false;
              });
              uploadList = [zipPath];
              uploadedBasenames = [path.basename(zipPath)];
            } finally {
              this._zipping = false;
              zipPhaseResolve(); // Signals the replacement notification to close.
            }
          } else {
            zipPhaseResolve(); // No zip phase — resolve immediately so no notification hangs.
            uploadList = files;
            uploadedBasenames = files.map(f => path.basename(f));
          }

          // ── Upload phase ──────────────────────────────────────────────────
          const pathCount = remoteBases.length;
          let totalSize = 0;
          try {
            totalSize = uploadList.reduce((sum, f) => sum + fs.statSync(f).size, 0) * pathCount;
          } catch { totalSize = 0; }

          if (client.isAborted) { throw new AbortError(); }
          progress.report({ message: `Connecting to ${preset.host}\u2026` });
          await client.connect(connectOpts);
          this._post({ kind: 'log', payload: { level: 'info', text: `Connected to ${preset.host}:${preset.port}` } });

          this._uploading = true;
          let overallTransferred = 0;

          for (let pi = 0; pi < remoteBases.length; pi++) {
            const remoteBase = remoteBases[pi];
            const pathPrefix = remoteBases.length > 1 ? `[${pi + 1}/${remoteBases.length}] ${remoteBase}: ` : '';

            for (const localPath of uploadList) {
              const basename = path.basename(localPath);
              const remotePath = remoteBase === '/' ? `/${basename}` : `${remoteBase}/${basename}`;

              this._post({ kind: 'log', payload: { level: 'info', text: `${pathPrefix}Uploading ${basename}\u2026` } });
              this._currentRemotePath = remotePath;

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
                progress.report({ increment: 0, message: `${pathPrefix}${basename} \u2014 ${p.percent}%` });
              });

              this._currentRemotePath = undefined;
              overallTransferred += done.bytesTransferred;
              this._post({ kind: 'log', payload: { level: 'info', text: `${pathPrefix}\u2713 ${basename} (${done.bytesTransferred} bytes, ${done.durationMs}ms)` } });
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
            folderPath: anchorFile ? path.dirname(anchorFile) : undefined,
            filePaths: files.length > 0 ? files : undefined,
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
          const isAbort = err instanceof AbortError || client.isAborted;
          const message = err instanceof Error ? err.message : String(err);

          if (isAbort) {
            // uploadErrorPosted is true only when notification cancel fired during upload
            // (onCancellationRequested already sent the message). In all other paths
            // (webview Stop, or notification cancel during zip), post it here.
            if (!uploadErrorPosted) {
              this._post({ kind: 'uploadError', payload: { message: 'Upload cancelled.' } });
            }

            // ── Partial file cleanup ──────────────────────────────────────────
            // _currentRemotePath is set only while a put() is in flight.
            const partialPath = this._currentRemotePath;
            this._currentRemotePath = undefined;

            if (partialPath && !preset.readOnly) {
              progress.report({ message: 'Removing partial file\u2026' });
              const cleanupClient = new SftpClient();
              try {
                await cleanupClient.connect(connectOpts);
                await cleanupClient.deleteFile(partialPath);
                this._post({ kind: 'log', payload: { level: 'warn', text: `Removed partial file: ${partialPath}`, category: 'upload' } });
              } catch {
                this._post({ kind: 'log', payload: { level: 'warn', text: `Could not remove partial file: ${partialPath}`, category: 'upload' } });
              } finally {
                await cleanupClient.disconnect();
              }
            } else if (partialPath && preset.readOnly) {
              this._post({ kind: 'log', payload: { level: 'warn', text: `Partial file may remain on server (read-only server): ${partialPath}`, category: 'upload' } });
            }
          } else {
            this._post({ kind: 'uploadError', payload: { message } });
            vscode.window.showErrorMessage(`SFTP Zip Gun upload failed: ${message}`);

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
          this._uploading = false;
          this._currentRemotePath = undefined;
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
      this._post({ kind: 'connectionTested', payload: { presetName, success: true, message: `Connected to ${preset.host}:${preset.port} successfully.` } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', `Connection test failed for "${presetName}": ${message}`);
      this._post({ kind: 'connectionTested', payload: { presetName, success: false, message } });
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
    const result = await SftpPanel.doFileZillaImport(this._context, this._presetManager);
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
