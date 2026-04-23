export type UploadMode = 'zip_canon' | 'pistol_file' | 'zip_gun';

export interface FileGroup {
  id: number;
  label: string;          // e.g. "G1"
  files: string[];        // absolute paths
  anchorFile: string;     // absolute path — user-pinned or first-alphabetically fallback
}

export interface UploadRequest {
  mode: UploadMode;
  presetName: string;
  selectedPaths: string[];
  // zip_canon and pistol_file:
  files?: string[];
  anchorFile?: string;
  archiveName?: string;
  // zip_gun:
  groups?: FileGroup[];
  groupNaming?: 'anchor' | 'base-counter' | 'base-timestamp';
  namingBase?: string;
}
