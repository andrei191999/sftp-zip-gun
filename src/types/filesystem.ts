export interface FileEntry {
  name: string;
  size: number;           // bytes
  isDirectory: boolean;
}

export interface RemoteEntry {
  name: string;
  type: 'd' | '-' | 'l'; // directory / file / symlink
  size: number;
}
