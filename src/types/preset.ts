export interface PresetMeta {
  name: string;
  host: string;
  port: number;
  username: string;
  remoteDir: string;       // default / pinned remote directory
  savedPaths: string[];    // bookmarked remote directories for multi-target upload
  authType: 'password' | 'key';
  keyPath: string;         // empty string when authType === 'password'
  readOnly: boolean;       // true = drop-box server: no stat/exists/delete/mkdir
}

// Sent webview -> host only (may contain secrets).
// Never echoed back from host -> webview.
export interface SavePresetRequest {
  preset: PresetMeta;
  password?: string;       // undefined = keep existing SecretStorage value
  passphrase?: string;     // SSH key passphrase; undefined = keep existing
  isNew: boolean;
  originalName?: string;   // set when editing an existing preset and the name changed
}
