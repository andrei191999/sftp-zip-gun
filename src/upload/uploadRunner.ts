import * as fs from 'fs';
import * as path from 'path';
import { sanitizeUserFacingError } from '../errors/userFacingError';
import type {
  DonePayload,
  HistoryEntry,
  PresetMeta,
  ProgressPayload,
  UploadRequest,
} from '../types/messages';
import { generateId } from '../types/messages';
import { formatTimestamp } from '../sftp/zipBuilder';

export interface UploadRunnerTransport {
  connect(options: unknown): Promise<void>;
  uploadFile(
    localPath: string,
    remotePath: string,
    onProgress: (progress: ProgressPayload) => void
  ): Promise<DonePayload>;
  disconnect(): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  abort(): void;
  forceAbort(): void;
  listDirectory(remotePath: string): Promise<unknown>;
  isAborted: boolean;
}

export interface UploadRunnerStateManager {
  addToHistory(entry: HistoryEntry): Promise<void>;
  setState(partial: { lastPresetName?: string }): Promise<void>;
}

export interface PreparedUploadArtifacts {
  localPaths: string[];
  uploadedBasenames: string[];
  sourceFiles: string[];
}

export interface PrepareUploadArtifactsArgs {
  request: UploadRequest;
  buildZip: (
    files: string[],
    anchorFile: string,
    baseName: string,
    onProgress?: (processed: number, total: number) => void
  ) => Promise<string>;
  now?: () => Date;
  onZipProgress?: (processed: number, total: number, groupId?: number) => void;
}

export interface UploadRunnerArgs {
  preset: PresetMeta;
  connectOptions: unknown;
  request: UploadRequest;
  transport: UploadRunnerTransport;
  stateManager: UploadRunnerStateManager;
  zipBuilder: PrepareUploadArtifactsArgs['buildZip'];
  prepared?: PreparedUploadArtifacts;
  now?: () => Date;
  createId?: () => string;
  onProgress?: (progress: ProgressPayload & { remotePath: string }) => void;
  onFileUploaded?: (localPath: string, remotePath: string) => void;
}

export interface UploadRunnerResult {
  status: 'success' | 'cancelled' | 'error';
  remoteFile?: string;
  bytesTransferred: number;
  durationMs: number;
  errorMessage?: string;
}

function defaultNow(): Date {
  return new Date();
}

function defaultCreateId(): string {
  return generateId();
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

function getRemoteBases(request: UploadRequest, preset: PresetMeta): string[] {
  const raw = request.selectedPaths?.length ? request.selectedPaths : [preset.remoteDir];
  return raw.map((remotePath) => remotePath.replace(/\/$/, '') || '/');
}

function getTotalSize(localPaths: string[], remoteBaseCount: number): number {
  try {
    return localPaths.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0) * remoteBaseCount;
  } catch {
    return 0;
  }
}

function buildRemoteTarget(remoteBase: string, localPath: string): string {
  const basename = path.basename(localPath);
  return remoteBase === '/' ? `/${basename}` : `${remoteBase}/${basename}`;
}

function buildSuccessRemoteFile(request: UploadRequest, remoteBases: string[], uploadedBasenames: string[]): string {
  if (remoteBases.length === 1) {
    if (request.mode === 'zip_gun' || (request.mode === 'pistol_file' && uploadedBasenames.length > 1)) {
      return `${uploadedBasenames.join(' + ')} → ${remoteBases[0]}/`;
    }
    return `${remoteBases[0]}/${uploadedBasenames[uploadedBasenames.length - 1]}`;
  }
  return remoteBases.join(', ');
}

function buildHistoryEntry(args: {
  id: string;
  timestamp: string;
  preset: PresetMeta;
  request: UploadRequest;
  uploadedBasenames: string[];
  remoteFile: string;
  result: 'success' | 'error';
  errorMessage?: string;
}): HistoryEntry {
  const { id, timestamp, preset, request, uploadedBasenames, remoteFile, result, errorMessage } = args;
  return {
    id,
    timestamp,
    presetName: preset.name,
    mode: request.mode,
    files: uploadedBasenames,
    folderPath: request.anchorFile ? path.dirname(request.anchorFile) : undefined,
    filePaths: request.files?.length ? request.files : undefined,
    remoteFile,
    result,
    errorMessage,
  };
}

async function persistSuccessfulUpload(
  stateManager: UploadRunnerStateManager,
  entry: HistoryEntry,
  presetName: string,
): Promise<void> {
  try {
    await stateManager.addToHistory(entry);
  } catch {
    // Best-effort persistence only. Upload already succeeded.
  }

  try {
    await stateManager.setState({ lastPresetName: presetName });
  } catch {
    // Best-effort persistence only. Upload already succeeded.
  }
}

export async function prepareUploadArtifacts({
  request,
  buildZip,
  now = defaultNow,
  onZipProgress,
}: PrepareUploadArtifactsArgs): Promise<PreparedUploadArtifacts> {
  if (request.mode === 'pistol_file') {
    const localPaths = [...(request.files ?? [])];
    return {
      localPaths,
      uploadedBasenames: localPaths.map((filePath) => path.basename(filePath)),
      sourceFiles: localPaths,
    };
  }

  if (request.mode === 'zip_canon') {
    const filesForZip = [...(request.files ?? [])];
    const anchorFile = request.anchorFile ?? filesForZip[0];
    const stem = (request.archiveName?.trim() || path.basename(anchorFile, path.extname(anchorFile)));
    const finalStem = `${stem}_${formatTimestamp(now())}`;
    const zipPath = await buildZip(filesForZip, anchorFile, finalStem, (processed, total) => {
      onZipProgress?.(processed, total);
    });
    return {
      localPaths: [zipPath],
      uploadedBasenames: [path.basename(zipPath)],
      sourceFiles: filesForZip,
    };
  }

  const localPaths: string[] = [];
  const uploadedBasenames: string[] = [];
  const groups = request.groups ?? [];
  const totalGroups = groups.length;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    let stem: string;
    if (request.groupNaming === 'base-counter') {
      const pad = String(totalGroups).length;
      stem = `${request.namingBase}_${String(index + 1).padStart(pad, '0')}`;
    } else if (request.groupNaming === 'base-timestamp') {
      const timestamp = now().toISOString().replace(/[^0-9]/g, '');
      stem = `${request.namingBase}_${timestamp}_${index + 1}`;
    } else {
      stem = path.basename(group.anchorFile, path.extname(group.anchorFile));
    }

    const zipPath = await buildZip(group.files, group.anchorFile, stem, (processed, total) => {
      onZipProgress?.(processed, total, group.id);
    });
    localPaths.push(zipPath);
    uploadedBasenames.push(path.basename(zipPath));
  }

  return {
    localPaths,
    uploadedBasenames,
    sourceFiles: groups.flatMap((group) => group.files),
  };
}

export async function runUploadRunner({
  preset,
  connectOptions,
  request,
  transport,
  stateManager,
  zipBuilder,
  prepared,
  now = defaultNow,
  createId = defaultCreateId,
  onProgress,
  onFileUploaded,
}: UploadRunnerArgs): Promise<UploadRunnerResult> {
  const startTime = now();
  const artifacts = prepared ?? await prepareUploadArtifacts({ request, buildZip: zipBuilder, now });
  const remoteBases = getRemoteBases(request, preset);
  const totalBytes = getTotalSize(artifacts.localPaths, remoteBases.length);
  let bytesTransferred = 0;
  let currentRemotePath: string | undefined;
  let remoteFile: string | undefined;

  try {
    await transport.connect(connectOptions);

    for (const remoteBase of remoteBases) {
      for (const localPath of artifacts.localPaths) {
        const remotePath = buildRemoteTarget(remoteBase, localPath);
        currentRemotePath = remotePath;
        const result = await transport.uploadFile(localPath, remotePath, (progress) => {
          const aggregateTransferred = bytesTransferred + progress.bytesTransferred;
          const percent = totalBytes > 0
            ? Math.round((aggregateTransferred / totalBytes) * 100)
            : progress.percent;
          onProgress?.({
            ...progress,
            totalBytes,
            percent,
            currentFile: path.basename(localPath),
            currentFilePath: localPath,
            remotePath,
          });
        });
        currentRemotePath = undefined;
        bytesTransferred += result.bytesTransferred;
        onFileUploaded?.(localPath, remotePath);
      }
    }
    remoteFile = buildSuccessRemoteFile(request, remoteBases, artifacts.uploadedBasenames);
  } catch (error: unknown) {
    if (isAbortError(error) || transport.isAborted) {
      if (currentRemotePath && !preset.readOnly) {
        try {
          await transport.deleteFile(currentRemotePath);
        } catch {
          // Best-effort cleanup only.
        }
      }

      return {
        status: 'cancelled',
        bytesTransferred,
        durationMs: now().getTime() - startTime.getTime(),
        errorMessage: 'Upload cancelled.',
      };
    }

    const message = sanitizeUserFacingError(error instanceof Error ? error.message : String(error));
    const remoteFile = remoteBases[0] ?? '';
    await stateManager.addToHistory(buildHistoryEntry({
      id: createId(),
      timestamp: now().toISOString(),
      preset,
      request,
      uploadedBasenames: artifacts.uploadedBasenames,
      remoteFile,
      result: 'error',
      errorMessage: message,
    }));

    return {
      status: 'error',
      bytesTransferred,
      durationMs: now().getTime() - startTime.getTime(),
      errorMessage: message,
    };
  } finally {
    await transport.disconnect();
  }

  await persistSuccessfulUpload(
    stateManager,
    buildHistoryEntry({
      id: createId(),
      timestamp: now().toISOString(),
      preset,
      request,
      uploadedBasenames: artifacts.uploadedBasenames,
      remoteFile: remoteFile ?? '',
      result: 'success',
    }),
    preset.name,
  );

  return {
    status: 'success',
    remoteFile,
    bytesTransferred,
    durationMs: now().getTime() - startTime.getTime(),
  };
}
