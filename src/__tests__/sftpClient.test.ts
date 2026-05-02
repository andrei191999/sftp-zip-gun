const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockPut = jest.fn();

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    put: mockPut,
  }));
});

import { SftpClient } from '../sftp/sftpClient';

describe('SftpClient', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockPut.mockReset().mockResolvedValue(undefined);
  });

  it('uses an extended SSH ready timeout when connecting', async () => {
    const client = new SftpClient();

    await client.connect({
      host: '127.0.0.1',
      port: 2222,
      username: 'pwuser',
      password: 'pwpass',
    });

    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({
      readyTimeout: 60_000,
    }));
  });

  it('retries uploads with a relative path after an absolute-path permission denial', async () => {
    mockPut
      .mockRejectedValueOnce(Object.assign(new Error('_put: Write stream error: Permission denied /store/file.txt'), {
        code: 3,
        custom: true,
      }))
      .mockResolvedValueOnce(undefined);

    const client = new SftpClient();

    const result = await client.uploadFile('C:\\synthetic\\file.txt', '/store/file.txt', jest.fn());

    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut.mock.calls[0][1]).toBe('/store/file.txt');
    expect(mockPut.mock.calls[1][1]).toBe('store/file.txt');
    expect(result.remoteFile).toBe('/store/file.txt');
  });
});
