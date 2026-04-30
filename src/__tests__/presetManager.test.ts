import { PresetManager } from '../config/presetManager';
import {
  getMockConfiguration,
  makeMockContext,
  resetMockWorkspace,
  setMockConfiguration,
} from '../__mocks__/vscode';

const BASE_PRESET = {
  name: 'QA Preset',
  host: '127.0.0.1',
  port: 2222,
  username: 'pwuser',
  remoteDir: '/upload',
  savedPaths: [] as string[],
  authType: 'password' as const,
  keyPath: '',
  readOnly: false,
};

describe('PresetManager', () => {
  beforeEach(() => {
    resetMockWorkspace();
  });

  it('normalizes legacy presets that are missing readOnly and savedPaths', () => {
    setMockConfiguration('sftpZipGun', {
      presets: [
        {
          name: 'Legacy',
          host: 'legacy.example.com',
          port: 22,
          username: 'legacy-user',
          remoteDir: '/',
          authType: 'password',
          keyPath: '',
        },
      ],
    });

    const ctx = makeMockContext();
    const manager = new PresetManager(ctx as any);
    expect(manager.getAll()).toEqual([
      {
        name: 'Legacy',
        host: 'legacy.example.com',
        port: 22,
        username: 'legacy-user',
        remoteDir: '/',
        savedPaths: [],
        authType: 'password',
        keyPath: '',
        readOnly: false,
      },
    ]);
  });

  it('normalizes and exposes presets defined in settings', () => {
    setMockConfiguration('sftpZipGun', {
      presets: [
        {
          name: 'Manual Settings Preset',
          host: '127.0.0.1',
          port: 2222,
          username: 'pwuser',
          remoteDir: '/store',
          authType: 'password',
          keyPath: '',
          readOnly: false,
        },
      ],
    });

    const ctx = makeMockContext({
      secrets: {
        'sftpZipGun.preset.Manual Settings Preset.password': 'pwpass',
      },
    });
    const manager = new PresetManager(ctx as any);

    expect(manager.getAll()).toEqual([
      {
        name: 'Manual Settings Preset',
        host: '127.0.0.1',
        port: 2222,
        username: 'pwuser',
        remoteDir: '/store',
        savedPaths: [],
        authType: 'password',
        keyPath: '',
        readOnly: false,
      },
    ]);
    expect(manager.getByName('Manual Settings Preset')?.name).toBe('Manual Settings Preset');
  });

  it('stores non-sensitive preset metadata and normalizes readOnly on save', async () => {
    const ctx = makeMockContext();
    const manager = new PresetManager(ctx as any);

    await manager.save({
      preset: {
        ...BASE_PRESET,
        savedPaths: undefined as unknown as string[],
        readOnly: undefined as unknown as boolean,
      },
      password: 'pwpass',
      isNew: true,
    });

    expect(getMockConfiguration('sftpZipGun').presets).toEqual([
      {
        ...BASE_PRESET,
        savedPaths: [],
        readOnly: false,
      },
    ]);
    expect(ctx.__mock.secretStore.get('sftpZipGun.preset.QA Preset.password')).toBe('pwpass');
  });

  it('migrates stored secrets when a preset is renamed', async () => {
    setMockConfiguration('sftpZipGun', { presets: [BASE_PRESET] });
    const ctx = makeMockContext({
      secrets: {
        'sftpZipGun.preset.QA Preset.password': 'pwpass',
        'sftpZipGun.preset.QA Preset.passphrase': 'secret-passphrase',
      },
    });
    const manager = new PresetManager(ctx as any);

    await manager.save({
      preset: {
        ...BASE_PRESET,
        name: 'Renamed Preset',
        authType: 'key',
        keyPath: 'C:\\keys\\qa_ed25519',
      },
      originalName: 'QA Preset',
      isNew: false,
    });

    expect(getMockConfiguration('sftpZipGun').presets).toEqual([
      {
        ...BASE_PRESET,
        name: 'Renamed Preset',
        authType: 'key',
        keyPath: 'C:\\keys\\qa_ed25519',
      },
    ]);
    expect(ctx.__mock.secretStore.get('sftpZipGun.preset.Renamed Preset.password')).toBe('pwpass');
    expect(ctx.__mock.secretStore.get('sftpZipGun.preset.Renamed Preset.passphrase')).toBe('secret-passphrase');
    expect(ctx.__mock.secretStore.has('sftpZipGun.preset.QA Preset.password')).toBe(false);
    expect(ctx.__mock.secretStore.has('sftpZipGun.preset.QA Preset.passphrase')).toBe(false);
  });

  it('deletes preset metadata and secrets together', async () => {
    setMockConfiguration('sftpZipGun', { presets: [BASE_PRESET] });
    const ctx = makeMockContext({
      secrets: {
        'sftpZipGun.preset.QA Preset.password': 'pwpass',
        'sftpZipGun.preset.QA Preset.passphrase': 'secret-passphrase',
      },
    });
    const manager = new PresetManager(ctx as any);

    await manager.delete('QA Preset');

    expect(getMockConfiguration('sftpZipGun').presets).toEqual([]);
    expect(ctx.__mock.secretStore.size).toBe(0);
  });

  it('sanitizes missing key-file errors', async () => {
    const ctx = makeMockContext();
    const manager = new PresetManager(ctx as any);

    await expect(
      manager.resolveConnectOptions({
        ...BASE_PRESET,
        authType: 'key',
        keyPath: 'C:\\Users\\user\\.ssh\\missing_ed25519',
      })
    ).rejects.toThrow('Cannot read the SSH key file. Check that the configured key path exists and is readable.');

    await manager.resolveConnectOptions({
      ...BASE_PRESET,
      authType: 'key',
      keyPath: 'C:\\Users\\user\\.ssh\\missing_ed25519',
    }).catch((err: Error) => {
      expect(err.message).not.toContain('missing_ed25519');
      expect(err.message).not.toContain('ENOENT');
    });
  });
});
