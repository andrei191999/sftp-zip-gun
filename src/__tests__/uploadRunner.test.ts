import { prepareUploadArtifacts, runUploadRunner } from '../upload/uploadRunner';
import type { PresetMeta } from '../types/messages';

const BASE_PRESET: PresetMeta = {
  name: 'QA Preset',
  host: '127.0.0.1',
  port: 22,
  username: 'user',
  remoteDir: '/upload',
  savedPaths: [],
  authType: 'password',
  keyPath: '',
  readOnly: false,
};

describe('runUploadRunner', () => {
  it('builds unique ZIP Gun archive stems for base-timestamp groups in the same run', async () => {
    const buildZip = jest.fn()
      .mockResolvedValueOnce('C:/tmp/batch_20260423094500_1.zip')
      .mockResolvedValueOnce('C:/tmp/batch_20260423094500_2.zip');

    const result = await prepareUploadArtifacts({
      request: {
        mode: 'zip_gun',
        presetName: BASE_PRESET.name,
        selectedPaths: ['/upload'],
        groupNaming: 'base-timestamp',
        namingBase: 'batch',
        groups: [
          { id: 1, label: 'G1', files: ['C:/tmp/a.txt'], anchorFile: 'C:/tmp/a.txt' },
          { id: 2, label: 'G2', files: ['C:/tmp/b.txt'], anchorFile: 'C:/tmp/b.txt' },
        ],
      },
      buildZip,
      now: () => new Date('2026-04-23T09:45:00.000Z'),
    });

    expect(buildZip).toHaveBeenNthCalledWith(
      1,
      ['C:/tmp/a.txt'],
      'C:/tmp/a.txt',
      'batch_20260423094500000_1',
      expect.any(Function)
    );
    expect(buildZip).toHaveBeenNthCalledWith(
      2,
      ['C:/tmp/b.txt'],
      'C:/tmp/b.txt',
      'batch_20260423094500000_2',
      expect.any(Function)
    );
    expect(result.uploadedBasenames).toEqual([
      'batch_20260423094500_1.zip',
      'batch_20260423094500_2.zip',
    ]);
  });

  it('uploads pistol_file inputs and records a success history entry', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const uploadFile = jest.fn().mockResolvedValue({
      remoteFile: '/upload/invoice.xml',
      bytesTransferred: 42,
      durationMs: 15,
    });
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const addToHistory = jest.fn().mockResolvedValue(undefined);
    const setState = jest.fn().mockResolvedValue(undefined);
    const onProgress = jest.fn();

    const result = await runUploadRunner({
      preset: BASE_PRESET,
      connectOptions: {
        host: BASE_PRESET.host,
        port: BASE_PRESET.port,
        username: BASE_PRESET.username,
        password: 'pw',
      },
      request: {
        mode: 'pistol_file',
        presetName: BASE_PRESET.name,
        selectedPaths: ['/upload'],
        files: ['C:/tmp/invoice.xml'],
      },
      transport: {
        connect,
        uploadFile,
        disconnect,
        deleteFile: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        forceAbort: jest.fn(),
        listDirectory: jest.fn(),
        isAborted: false,
      },
      stateManager: {
        addToHistory,
        setState,
      },
      zipBuilder: jest.fn(),
      now: () => new Date('2026-04-22T10:00:00.000Z'),
      createId: () => 'history-1',
      onProgress,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledWith(
      'C:/tmp/invoice.xml',
      '/upload/invoice.xml',
      expect.any(Function)
    );
    expect(addToHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'history-1',
        presetName: BASE_PRESET.name,
        mode: 'pistol_file',
        files: ['invoice.xml'],
        remoteFile: '/upload/invoice.xml',
        result: 'success',
      })
    );
    expect(setState).toHaveBeenCalledWith({ lastPresetName: BASE_PRESET.name });
    expect(result.status).toBe('success');
  });

  it('keeps a successful upload successful when lastPreset state write fails', async () => {
    const addToHistory = jest.fn().mockResolvedValue(undefined);
    const setState = jest.fn().mockRejectedValue(new Error('state write failed'));

    const result = await runUploadRunner({
      preset: BASE_PRESET,
      connectOptions: {
        host: BASE_PRESET.host,
        port: BASE_PRESET.port,
        username: BASE_PRESET.username,
        password: 'pw',
      },
      request: {
        mode: 'pistol_file',
        presetName: BASE_PRESET.name,
        selectedPaths: ['/upload'],
        files: ['C:/tmp/invoice.xml'],
      },
      transport: {
        connect: jest.fn().mockResolvedValue(undefined),
        uploadFile: jest.fn().mockResolvedValue({
          remoteFile: '/upload/invoice.xml',
          bytesTransferred: 42,
          durationMs: 15,
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        forceAbort: jest.fn(),
        listDirectory: jest.fn(),
        isAborted: false,
      },
      stateManager: {
        addToHistory,
        setState,
      },
      zipBuilder: jest.fn(),
      now: () => new Date('2026-04-23T10:00:00.000Z'),
      createId: () => 'history-success',
      onProgress: jest.fn(),
    });

    expect(addToHistory).toHaveBeenCalledTimes(1);
    expect(addToHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'history-success',
        result: 'success',
      })
    );
    expect(setState).toHaveBeenCalledWith({ lastPresetName: BASE_PRESET.name });
    expect(result.status).toBe('success');
    expect(result.errorMessage).toBeUndefined();
  });

  it('treats AbortError as a cancelled upload without writing error history', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const addToHistory = jest.fn().mockResolvedValue(undefined);

    const result = await runUploadRunner({
      preset: BASE_PRESET,
      connectOptions: {
        host: BASE_PRESET.host,
        port: BASE_PRESET.port,
        username: BASE_PRESET.username,
        password: 'pw',
      },
      request: {
        mode: 'pistol_file',
        presetName: BASE_PRESET.name,
        selectedPaths: ['/upload'],
        files: ['C:/tmp/invoice.xml'],
      },
      transport: {
        connect: jest.fn().mockResolvedValue(undefined),
        uploadFile: jest.fn().mockRejectedValue(Object.assign(new Error('Upload aborted by user'), { name: 'AbortError' })),
        disconnect,
        deleteFile: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        forceAbort: jest.fn(),
        listDirectory: jest.fn(),
        isAborted: false,
      },
      stateManager: {
        addToHistory,
        setState: jest.fn().mockResolvedValue(undefined),
      },
      zipBuilder: jest.fn(),
      now: () => new Date('2026-04-22T10:00:00.000Z'),
      createId: () => 'history-2',
      onProgress: jest.fn(),
    });

    expect(addToHistory).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('cancelled');
    expect(result.errorMessage).toBe('Upload cancelled.');
  });

  it('reconnects to delete partial remote file when abort destroys the active connection', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const deleteFile = jest.fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(undefined);

    const result = await runUploadRunner({
      preset: BASE_PRESET,
      connectOptions: {
        host: BASE_PRESET.host,
        port: BASE_PRESET.port,
        username: BASE_PRESET.username,
        password: 'pw',
      },
      request: {
        mode: 'pistol_file',
        presetName: BASE_PRESET.name,
        selectedPaths: ['/upload'],
        files: ['C:/tmp/invoice.xml'],
      },
      transport: {
        connect,
        uploadFile: jest.fn().mockRejectedValue(Object.assign(new Error('Upload aborted by user'), { name: 'AbortError' })),
        disconnect,
        deleteFile,
        abort: jest.fn(),
        forceAbort: jest.fn(),
        listDirectory: jest.fn(),
        isAborted: false,
      },
      stateManager: {
        addToHistory: jest.fn().mockResolvedValue(undefined),
        setState: jest.fn().mockResolvedValue(undefined),
      },
      zipBuilder: jest.fn(),
      now: () => new Date('2026-04-22T10:00:00.000Z'),
      createId: () => 'history-cleanup',
      onProgress: jest.fn(),
    });

    expect(result.status).toBe('cancelled');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledWith('/upload/invoice.xml');
  });
});
