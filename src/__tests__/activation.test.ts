import {
  makeMockContext,
  resetMockWindow,
  resetMockWorkspace,
  resetRegisteredCommands,
  window,
  getRegisteredCommands,
} from '../__mocks__/vscode';

jest.mock('../extension/migration', () => ({
  migrateOldPresets: jest.fn(),
}));

jest.mock('../extension/statusBarController', () => ({
  StatusBarController: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    setSuccess: jest.fn(),
  })),
}));

jest.mock('../webview/SftpPanel', () => ({
  SftpPanel: {
    currentPanel: undefined,
    createOrShow: jest.fn(),
  },
}));

jest.mock('../extension/importFileZilla', () => ({
  handleImportFileZilla: jest.fn(),
}));

jest.mock('../extension/quickUpload', () => ({
  handleQuickUpload: jest.fn(),
}));

jest.mock('../extension/context', () => ({
  updateHasPresetsContext: jest.fn(),
}));

jest.mock('../extension/testMode', () => ({
  isTestMode: jest.fn(() => false),
  createTestModeCommands: jest.fn(() => []),
}));

import { activate } from '../extension';
import { migrateOldPresets } from '../extension/migration';

describe('activate', () => {
  beforeEach(() => {
    resetMockWorkspace();
    resetMockWindow();
    resetRegisteredCommands();
    jest.clearAllMocks();
  });

  it('registers commands and shows a warning when preset migration fails', async () => {
    (migrateOldPresets as jest.Mock).mockRejectedValue(new Error('migration exploded'));

    await expect(activate(makeMockContext() as any)).resolves.toBeUndefined();

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'SFTP Zip Gun: Preset migration failed. Existing commands are still available; check the output channel for details.'
    );
    expect(getRegisteredCommands()).toEqual(
      expect.arrayContaining([
        'sftpZipGun.openPanel',
        'sftpZipGun.quickUpload',
        'sftpZipGun.importFileZilla',
      ])
    );
  });
});
