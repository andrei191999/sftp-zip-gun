// Minimal ambient declaration for ssh2-sftp-client (no official @types package).
// Only covers the API surface used by this extension.
declare module 'ssh2-sftp-client' {
  interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: Buffer | string;
    passphrase?: string;
  }

  interface PutOptions {
    step?: (transferred: number, chunk: number, total: number) => void;
  }

  interface FileInfo {
    name: string;
    type: 'd' | '-' | 'l';
    size: number;
    modifyTime: number;
    accessTime: number;
    rights: { user: string; group: string; other: string };
    owner: number;
    group: number;
  }

  class SftpClient {
    connect(config: ConnectOptions): Promise<void>;
    put(localPath: string, remotePath: string, options?: PutOptions): Promise<string>;
    list(remotePath: string, pattern?: string | RegExp): Promise<FileInfo[]>;
    end(): Promise<void>;
  }

  export = SftpClient;
}
