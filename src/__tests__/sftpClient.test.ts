const mockConnect = jest.fn();
const mockEnd = jest.fn();

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
  }));
});

import { SftpClient } from '../sftp/sftpClient';

describe('SftpClient', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
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
});
