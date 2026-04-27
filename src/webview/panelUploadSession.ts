import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PresetManager } from '../config/presetManager';
import { StateManager } from '../config/stateManager';
import { sanitizeUserFacingError } from '../errors/userFacingError';
import { log } from '../logger';
import { AbortError, SftpClient } from '../sftp/sftpClient';
import { buildZip, formatTimestamp } from '../sftp/zipBuilder';
import {
  generateId,
  type HistoryEntry,
  type HostToWebview,
  type PresetMeta,
  type UploadRequest,
} from '../types/messages';
import { prepareUploadArtifacts, runUploadRunner, type PreparedUploadArtifacts } from '../upload/uploadRunner';

interface UploadSessionDeps {
  presetManager: PresetManager;
  stateManager: StateManager;
  post: (message: HostToWebview) => void;
  onUploadComplete?: (presetName: string) => void;
}

export class PanelUploadSession {
  private readonly presetManager: PresetManager;
  private readonly stateManager: StateManager;
  private readonly post: (message: HostToWebview) => void;
  private readonly onUploadComplete?: (presetName: string) => void;
  private activeClient: SftpClient | undefined;
  private zipping = false;
  private uploading = false;
  private uploadStartMs = 0;
  private currentRemotePath: string | undefined;
  private inFlightFilePath: string | undefined;
  private inFlightGroupId: number | undefined;
  private pendingGroupIds = new Set<number>();

  constructor({ presetManager, stateManager, post, onUploadComplete }: UploadSessionDeps) {
    this.presetManager = presetManager;
    this.stateManager = stateManager;
    this.post = post;
    this.onUploadComplete = onUploadComplete;
  }

  get isBusy(): boolean {
    return this.zipping || this.uploading;
  }

  cancel(): void {
    if (this.zipping) {
      this.post({ kind: 'log', payload: { level: 'warn', text: 'Cancellation triggered — waiting for ZIP to finish…', category: 'upload' } });
      this.post({ kind: 'uploadProgress', payload: { bytesTransferred: 0, totalBytes: 0, percent: 0, currentFile: 'Cancelling…' } });
      this.activeClient?.abort();
      return;
    }

    if (this.uploading) {
      this.activeClient?.forceAbort();
      return;
    }

    this.activeClient?.abort();
  }

  dispose(): void {
    this.activeClient?.forceAbort();
    this.activeClient = undefined;
  }

  async handleUpload(payload: UploadRequest): Promise<void> {
    this.uploadStartMs = Date.now();
    const preset = this.presetManager.getByName(payload.presetName);
    if (!preset) {
      this.post({ kind: 'uploadError', payload: { message: `Preset "${payload.presetName}" not found.` } });
      return;
    }

    let connectOptions: Awaited<ReturnType<PresetManager['resolveConnectOptions']>>;
    try {
      connectOptions = await this.presetManager.resolveConnectOptions(preset);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', `Failed to resolve connection options for "${preset.name}": ${message}`);
      this.post({ kind: 'uploadError', payload: { message: sanitizeUserFacingError(message) } });
      return;
    }

    const transport = new SftpClient();
    this.activeClient = transport;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SFTP: ${preset.name}`,
        cancellable: true,
      },
      async (progress, token) => {
        let cancelZipProgress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
        let zipPhaseResolve!: () => void;
        const zipPhaseDone = new Promise<void>((resolve) => { zipPhaseResolve = resolve; });

        token.onCancellationRequested(() => {
          if (this.uploading) {
            this.activeClient?.forceAbort();
          } else if (this.zipping) {
            this.post({ kind: 'log', payload: { level: 'warn', text: 'Cancellation triggered — waiting for ZIP to finish…', category: 'upload' } });
            this.activeClient?.abort();
            void vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `SFTP: ${preset.name}`, cancellable: false },
              async (p2) => {
                cancelZipProgress = p2;
                p2.report({ message: 'Waiting for ZIP to finish… (cancellation pending)' });
                await zipPhaseDone;
                cancelZipProgress = undefined;
              }
            );
          } else {
            this.activeClient?.abort();
          }
        });

        const zipCanonSourceFiles = payload.mode === 'zip_canon' ? [...(payload.files ?? [])] : [];

        try {
          const prepared = await prepareUploadArtifacts({
            request: payload,
            buildZip: async (files, anchorFile, baseName, onZipProgress) => {
              this.zipping = true;
              if (payload.mode === 'zip_canon') {
                this.setFileStatuses(zipCanonSourceFiles, 'zipping');
                progress.report({ message: `Building ZIP… (${files.length} files)` });
                this.post({ kind: 'log', payload: { level: 'info', text: `Building ZIP archive… (${files.length} file${files.length === 1 ? '' : 's'})`, category: 'sys' } });
              } else {
                const currentGroup = payload.groups?.find((group) => group.files === files || group.anchorFile === anchorFile);
                if (currentGroup) {
                  this.pendingGroupIds.add(currentGroup.id);
                  this.inFlightGroupId = currentGroup.id;
                  this.post({ kind: 'fileStatus', payload: { groupId: currentGroup.id, status: 'zipping' } });
                }
              }

              let firstZipProgress = true;
              try {
                return await buildZip(files, anchorFile, baseName, (processed, total) => {
                  onZipProgress?.(processed, total);
                  if (payload.mode === 'zip_canon') {
                    const message = `Building ZIP… ${processed}/${total}`;
                    progress.report({ message });
                    cancelZipProgress?.report({ message: `${message} (cancellation pending)` });
                    this.post({
                      kind: 'log',
                      payload: { level: 'info', text: `Zipping… ${processed}/${total}`, category: 'sys', replace: !firstZipProgress },
                    });
                    firstZipProgress = false;
                  } else if (this.inFlightGroupId !== undefined) {
                    this.post({
                      kind: 'log',
                      payload: { level: 'info', text: `Zipping… ${processed}/${total}`, category: 'sys', replace: processed > 1 },
                    });
                  }
                });
              } finally {
                this.zipping = false;
                this.inFlightGroupId = undefined;
                zipPhaseResolve();
              }
            },
            now: () => new Date(),
          });

          let pistolDoneCount = 0;
          const pistolTotal = payload.mode === 'pistol_file' ? prepared.localPaths.length : 0;
          const pistolWindow: string[] = [];
          let lastProgressMs = 0;
          let zipCanonUploadingPosted = false;
          this.uploading = true;
          const result = await runUploadRunner({
            preset,
            connectOptions,
            request: payload,
            transport,
            stateManager: this.stateManager,
            zipBuilder: buildZip,
            prepared,
            now: () => new Date(),
            createId: generateId,
            onProgress: (uploadProgress) => {
              if (payload.mode === 'zip_canon') {
                if (!zipCanonUploadingPosted) {
                  this.setFileStatuses(zipCanonSourceFiles, 'uploading');
                  zipCanonUploadingPosted = true;
                }
              } else if (payload.mode === 'pistol_file') {
                this.inFlightFilePath = uploadProgress.currentFilePath;
                if (uploadProgress.currentFilePath) {
                  this.post({ kind: 'fileStatus', payload: { filePath: uploadProgress.currentFilePath, status: 'uploading' } });
                }
              } else {
                const group = payload.groups?.find((entry, index) => prepared.localPaths[index] === uploadProgress.currentFilePath);
                if (group) {
                  this.inFlightGroupId = group.id;
                  this.post({ kind: 'fileStatus', payload: { groupId: group.id, status: 'uploading' } });
                }
              }

              this.currentRemotePath = uploadProgress.remotePath;
              const now = Date.now();
              if (now - lastProgressMs >= 80) {
                lastProgressMs = now;
                progress.report({ increment: 0, message: `${path.basename(uploadProgress.currentFilePath ?? uploadProgress.currentFile ?? '')} — ${uploadProgress.percent}%` });
                this.post({
                  kind: 'uploadProgress',
                  payload: {
                    bytesTransferred: uploadProgress.bytesTransferred,
                    totalBytes: uploadProgress.totalBytes,
                    percent: uploadProgress.percent,
                    currentFile: uploadProgress.currentFile,
                    currentFilePath: uploadProgress.currentFilePath,
                  },
                });
              }
            },
            onFileUploaded: (localPath, _remotePath) => {
              if (payload.mode === 'pistol_file' && pistolTotal > 1) {
                pistolDoneCount++;
                pistolWindow.push(path.basename(localPath));
                if (pistolWindow.length > 3) { pistolWindow.shift(); }
                this.post({
                  kind: 'log',
                  payload: {
                    level: 'info',
                    text: `${pistolDoneCount}/${pistolTotal} uploaded — ${pistolWindow.join(', ')}`,
                    category: 'upload',
                    replace: pistolDoneCount > 1,
                  },
                });
              }
            },
          });

          this.currentRemotePath = undefined;
          if (result.status === 'success') {
            this.markArtifactsComplete(payload, prepared, preset);
            this.post({
              kind: 'uploadDone',
              payload: {
                remoteFile: result.remoteFile ?? '',
                bytesTransferred: result.bytesTransferred,
                durationMs: Date.now() - this.uploadStartMs,
              },
            });
            this.onUploadComplete?.(preset.name);
            return;
          }

          this.markArtifactsFailed(payload, zipCanonSourceFiles, result.status === 'cancelled' ? 'cancelled' : 'error');
          this.post({ kind: 'uploadError', payload: { message: result.errorMessage ?? 'Upload failed.' } });

          if (result.status === 'error') {
            vscode.window.showErrorMessage(`SFTP Zip Gun upload failed: ${result.errorMessage}`);
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const terminalStatus = error instanceof AbortError || transport.isAborted ? 'cancelled' : 'error';
          this.markArtifactsFailed(payload, zipCanonSourceFiles, terminalStatus);
          this.post({ kind: 'uploadError', payload: { message: terminalStatus === 'cancelled' ? 'Upload cancelled.' : sanitizeUserFacingError(message) } });
          if (terminalStatus === 'error') {
            log('error', `Upload failed for preset "${preset.name}": ${message}`);
            vscode.window.showErrorMessage(`SFTP Zip Gun upload failed: ${sanitizeUserFacingError(message)}`);
          }
        } finally {
          this.resetState();
          this.post({ kind: 'history', payload: { entries: this.stateManager.getHistory() } });
        }
      }
    );
  }

  private setFileStatuses(
    filePaths: string[],
    status: 'queued' | 'zipping' | 'uploading' | 'done' | 'cancelled' | 'error'
  ): void {
    for (const filePath of filePaths) {
      this.post({ kind: 'fileStatus', payload: { filePath, status } });
    }
  }

  private markArtifactsComplete(
    payload: UploadRequest,
    prepared: PreparedUploadArtifacts,
    preset: PresetMeta
  ): void {
    if (payload.mode === 'zip_canon') {
      this.setFileStatuses(prepared.sourceFiles, 'done');
      return;
    }

    if (payload.mode === 'pistol_file') {
      for (const localPath of prepared.localPaths) {
        this.post({ kind: 'fileStatus', payload: { filePath: localPath, status: 'done' } });
      }
      return;
    }

    for (const group of payload.groups ?? []) {
      this.pendingGroupIds.delete(group.id);
      this.post({ kind: 'fileStatus', payload: { groupId: group.id, status: 'done' } });
    }
    this.post({ kind: 'log', payload: { level: 'info', text: `Uploaded to ${preset.host}:${preset.port}`, category: 'sys' } });
  }

  private markArtifactsFailed(
    payload: UploadRequest,
    zipCanonSourceFiles: string[],
    terminalStatus: 'cancelled' | 'error'
  ): void {
    if (payload.mode === 'zip_canon' && zipCanonSourceFiles.length > 0) {
      this.setFileStatuses(zipCanonSourceFiles, terminalStatus);
    } else if (this.inFlightFilePath) {
      this.post({ kind: 'fileStatus', payload: { filePath: this.inFlightFilePath, status: terminalStatus } });
    }

    for (const groupId of this.pendingGroupIds) {
      this.post({ kind: 'fileStatus', payload: { groupId, status: terminalStatus } });
    }
    this.pendingGroupIds.clear();
  }

  private resetState(): void {
    this.uploading = false;
    this.zipping = false;
    this.currentRemotePath = undefined;
    this.inFlightFilePath = undefined;
    this.inFlightGroupId = undefined;
    this.pendingGroupIds.clear();
    this.activeClient = undefined;
  }
}
