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
  readyTimeout?: number;
}

const SSH_READY_TIMEOUT_MS = 60_000;

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
      readyTimeout: SSH_READY_TIMEOUT_MS,
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
    if (this.aborted) { throw new AbortError(); }
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

  get isAborted(): boolean { return this.aborted; }

  /** Set the abort flag only. Used during the zip phase (archiver cannot be
   *  interrupted) so the upload loop stops cleanly after the zip finishes. */
  abort(): void {
    log('warn', 'Upload aborted by user (graceful)');
    this.aborted = true;
  }

  /** Set the abort flag AND force-destroy the TCP socket. Used during the
   *  active upload phase to stop put() immediately. The partial remote file
   *  must be cleaned up by the caller. */
  forceAbort(): void {
    log('warn', 'Upload aborted by user (force)');
    this.aborted = true;
    try {
      const sock = (this.client as any).client?._sock;
      if (sock && typeof sock.destroy === 'function') {
        sock.destroy();
      } else {
        void this.client.end().catch(() => { /* ignore */ });
      }
    } catch {
      void this.client.end().catch(() => { /* ignore */ });
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    // ssh2-sftp-client has a `delete` method but its bundled types omit it.
    await (this.client as any).delete(remotePath);
  }
}
