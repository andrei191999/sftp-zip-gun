import * as vscode from 'vscode';
import type { PresetMeta } from '../types/messages';

jest.mock('../upload/uploadRunner', () => ({ runUploadRunner: jest.fn() }));
jest.mock('../sftp/sftpClient', () => ({ SftpClient: jest.fn() }));
jest.mock('../extension/context', () => ({ updateHasPresetsContext: jest.fn() }));
jest.mock('../logger', () => ({ log: jest.fn() }));

const { handleQuickUpload } = jest.requireActual('../extension/quickUpload') as typeof import('../extension/quickUpload');
const { updateHasPresetsContext } = jest.requireMock('../extension/context') as typeof import('../extension/context');
const { log } = jest.requireMock('../logger') as typeof import('../logger');
const { SftpClient } = jest.requireMock('../sftp/sftpClient') as typeof import('../sftp/sftpClient');
const { runUploadRunner } = jest.requireMock('../upload/uploadRunner') as typeof import('../upload/uploadRunner');

const vscodeMock = vscode as typeof vscode & {
  resetMockWindow: () => void;
  getMockProgressReports: () => unknown[];
  triggerMockCancellation: () => void;
};

const BASE_PRESET: PresetMeta = {
  name: 'Production',
  host: 'sftp.example.test',
  port: 22,
  username: 'deploy',
  remoteDir: '/incoming',
  savedPaths: [],
  authType: 'password',
  keyPath: '',
  readOnly: false,
};

const READ_ONLY_PRESET: PresetMeta = {
  ...BASE_PRESET,
  name: 'Drop Box',
  host: 'drop.example.test',
  remoteDir: '/intake',
  readOnly: true,
};

function makeUri(fsPath = 'C:\\tmp\\invoice.xml'): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

function makeHarness(options?: { presets?: PresetMeta[]; lastPresetName?: string }) {
  const presetManager = {
    getAll: jest.fn(() => options?.presets ?? [BASE_PRESET]),
    resolveConnectOptions: jest.fn(async (preset: PresetMeta) => ({
      host: preset.host,
      port: preset.port,
      username: preset.username,
      password: 'secret',
    })),
  };
  const stateManager = {
    getState: jest.fn(() => ({ lastPresetName: options?.lastPresetName })),
  };
  const statusBar = {
    setUploading: jest.fn(),
    setSuccess: jest.fn(),
    setIdle: jest.fn(),
    setError: jest.fn(),
  };

  return { presetManager, stateManager, statusBar };
}

async function runQuickUpload(
  commandUri: vscode.Uri | undefined,
  harness = makeHarness({ lastPresetName: BASE_PRESET.name })
): Promise<ReturnType<typeof makeHarness>> {
  await handleQuickUpload(
    commandUri,
    harness.presetManager as never,
    harness.stateManager as never,
    harness.statusBar as never
  );
  return harness;
}

describe('handleQuickUpload', () => {
  let transport: { abort: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    vscodeMock.resetMockWindow();
    transport = { abort: jest.fn() };
    (SftpClient as jest.Mock).mockImplementation(() => transport);
    (runUploadRunner as jest.Mock).mockResolvedValue({
      status: 'success',
      remoteFile: '/incoming/invoice.xml',
      bytesTransferred: 123,
    });
  });

  it('shows an error when no file is selected', async () => {
    const harness = makeHarness();

    await runQuickUpload(undefined, harness);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('SFTP Zip Gun: No file selected.');
    expect(harness.presetManager.getAll).not.toHaveBeenCalled();
    expect(runUploadRunner).not.toHaveBeenCalled();
  });

  it('shows an error when no presets are configured', async () => {
    const harness = makeHarness({ presets: [] });

    await runQuickUpload(makeUri(), harness);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'SFTP Zip Gun: No presets configured. Use the Manage panel to add one.'
    );
    expect(runUploadRunner).not.toHaveBeenCalled();
  });

  it('uses the last preset without prompting', async () => {
    const harness = makeHarness({ presets: [BASE_PRESET, READ_ONLY_PRESET], lastPresetName: READ_ONLY_PRESET.name });

    await runQuickUpload(makeUri(), harness);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(harness.presetManager.resolveConnectOptions).toHaveBeenCalledWith(READ_ONLY_PRESET);
    expect(runUploadRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: READ_ONLY_PRESET,
        request: expect.objectContaining({
          mode: 'pistol_file',
          presetName: READ_ONLY_PRESET.name,
          selectedPaths: [READ_ONLY_PRESET.remoteDir],
          files: ['C:\\tmp\\invoice.xml'],
        }),
        transport,
      })
    );
  });

  it('prompts when no last preset exists and includes read-only labels', async () => {
    const harness = makeHarness({ presets: [BASE_PRESET, READ_ONLY_PRESET], lastPresetName: 'Missing' });
    (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (items) => items[1]);

    await runQuickUpload(makeUri(), harness);

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({ label: 'Production', description: 'sftp.example.test:22', preset: BASE_PRESET }),
        expect.objectContaining({ label: '🔒 Drop Box', description: 'drop.example.test:22', preset: READ_ONLY_PRESET }),
      ],
      { title: 'Select SFTP Preset for Quick Upload' }
    );
    expect(runUploadRunner).toHaveBeenCalledWith(expect.objectContaining({ preset: READ_ONLY_PRESET }));
  });

  it('returns without uploading when preset picking is cancelled', async () => {
    const harness = makeHarness({ presets: [BASE_PRESET], lastPresetName: undefined });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    await runQuickUpload(makeUri(), harness);

    expect(harness.statusBar.setUploading).not.toHaveBeenCalled();
    expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(runUploadRunner).not.toHaveBeenCalled();
  });

  it('sets success status and information message after upload', async () => {
    const harness = makeHarness({ lastPresetName: BASE_PRESET.name });

    await runQuickUpload(makeUri(), harness);

    expect(harness.statusBar.setUploading).toHaveBeenCalledTimes(1);
    expect(harness.statusBar.setSuccess).toHaveBeenCalledWith(BASE_PRESET.name);
    expect(updateHasPresetsContext).toHaveBeenCalledWith(harness.presetManager);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'SFTP Zip Gun: invoice.xml → /incoming/invoice.xml (123 bytes)'
    );
  });

  it('sets idle status after cancelled upload', async () => {
    const harness = makeHarness({ lastPresetName: BASE_PRESET.name });
    (runUploadRunner as jest.Mock).mockResolvedValue({ status: 'cancelled', errorMessage: 'Upload cancelled.' });

    await runQuickUpload(makeUri(), harness);

    expect(harness.statusBar.setIdle).toHaveBeenCalledWith(BASE_PRESET.name);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('sets error status and error message after failed upload', async () => {
    const harness = makeHarness({ lastPresetName: BASE_PRESET.name });
    (runUploadRunner as jest.Mock).mockResolvedValue({ status: 'failed', errorMessage: 'Permission denied' });

    await runQuickUpload(makeUri(), harness);

    expect(log).toHaveBeenCalledWith('error', 'Quick upload failed for preset "Production": Permission denied');
    expect(harness.statusBar.setError).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('SFTP Zip Gun upload failed: Permission denied');
  });

  it('reports progress and aborts the transport when VS Code progress is cancelled', async () => {
    const harness = makeHarness({ lastPresetName: BASE_PRESET.name });
    (runUploadRunner as jest.Mock).mockImplementation(async ({ onProgress }) => {
      onProgress({ percent: 37 });
      vscodeMock.triggerMockCancellation();
      return { status: 'cancelled', errorMessage: 'Upload cancelled.' };
    });

    await runQuickUpload(makeUri(), harness);

    expect(vscodeMock.getMockProgressReports()).toEqual([{ increment: 37, message: '37%' }]);
    expect(transport.abort).toHaveBeenCalledTimes(1);
  });
});
