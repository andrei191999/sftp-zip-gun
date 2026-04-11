import SftpClientLib from 'ssh2-sftp-client';
import { ProgressPayload, DonePayload, RemoteEntry } from '../types/messages';
import { log } from '../logger';

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
}

export class AbortError extends Error {
  constructor() {
    super('Upload aborted by user');
    this.name = 'AbortError';
  }
}

export class SftpClient {
  private client: SftpClientLib;
  private aborted = false;

  constructor() {
    this.client = new SftpClientLib();
  }

  async connect(options: ConnectOptions): Promise<void> {
    const authMethod = options.privateKey ? 'key' : 'password';
    log('info', `Connecting to ${options.host}:${options.port} as ${options.username} (${authMethod})`);

    const connectConfig: ConnectOptions & { privateKey?: Buffer } = {
      host: options.host,
      port: options.port,
      username: options.username,
    };

    if (options.privateKey !== undefined) {
      connectConfig.privateKey = options.privateKey;
      if (options.passphrase !== undefined) {
        connectConfig.passphrase = options.passphrase;
      }
    } else if (options.password !== undefined) {
      connectConfig.password = options.password;
    }

    await this.client.connect(connectConfig);
    log('info', `Connected to ${options.host}:${options.port}`);
  }

  async uploadFile(
    localPath: string,
    remotePath: string,
    onProgress: (p: ProgressPayload) => void
  ): Promise<DonePayload> {
    this.aborted = false;
    const startTime = Date.now();
    let lastTransferred = 0;
    log('info', `Upload start: "${localPath}" → "${remotePath}"`);

    try {
      await this.client.put(localPath, remotePath, {
        step: (transferred: number, _chunk: number, total: number) => {
          lastTransferred = transferred;
          if (!this.aborted) {
            onProgress({
              bytesTransferred: transferred,
              totalBytes: total,
              percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
            });
          }
        },
      });
    } catch (err) {
      // If we aborted, the connection close caused put() to reject — surface as AbortError.
      if (this.aborted) {
        throw new AbortError();
      }
      throw err;
    }

    if (this.aborted) {
      throw new AbortError();
    }

    const durationMs = Date.now() - startTime;
    log('info', `Upload done: ${lastTransferred} bytes in ${durationMs}ms`);
    return { remoteFile: remotePath, bytesTransferred: lastTransferred, durationMs };
  }

  async listDirectory(remotePath: string): Promise<RemoteEntry[]> {
    log('info', `Listing: "${remotePath}"`);
    const entries = await this.client.list(remotePath);
    log('info', `Listed ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in "${remotePath}"`);
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.type === 'd' ? 'd' : entry.type === 'l' ? 'l' : '-',
      size: entry.size,
    }));
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.end();
    } catch (err) {
      log('warn', `Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  abort(): void {
    log('warn', 'Upload aborted by user');
    this.aborted = true;
    // Closing the connection causes any in-progress put() to reject immediately.
    void this.client.end().catch((err) => {
      log('warn', `Abort disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
