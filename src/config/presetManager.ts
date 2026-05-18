import * as vscode from 'vscode';
import * as fs from 'fs';
import type { PresetMeta, SavePresetRequest } from '../types/messages';
import { log } from '../logger';
import { sanitizeKeyFileReadError } from '../errors/userFacingError';

const CONFIG_KEY = 'presets';
const CONFIG_SECTION = 'sftpZipGun';

function secretKey(name: string, field: 'password' | 'passphrase'): string {
  return `sftpZipGun.preset.${name}.${field}`;
}

export class PresetManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getAll(): PresetMeta[] {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const raw = config.get<unknown>(CONFIG_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }
    // Filter to well-formed entries only; never surface password/passphrase.
    // Normalize readOnly to boolean — old presets saved before the field was added will have it undefined.
    return raw
      .filter(
        (item): item is PresetMeta =>
          item !== null &&
          typeof item === 'object' &&
          typeof (item as PresetMeta).name === 'string' &&
          typeof (item as PresetMeta).host === 'string'
      )
      .map((item) => ({
        name:       item.name,
        host:       item.host,
        port:       typeof item.port === 'number' ? item.port : 22,
        username:   typeof item.username === 'string' ? item.username : '',
        remoteDir:  typeof item.remoteDir === 'string' ? item.remoteDir : '',
        authType:   item.authType === 'key' ? 'key' : 'password',
        keyPath:    typeof item.keyPath === 'string' ? item.keyPath : '',
        readOnly:   item.readOnly === true,
        savedPaths: Array.isArray(item.savedPaths) ? item.savedPaths : [],
      }));
  }

  getByName(name: string): PresetMeta | undefined {
    return this.getAll().find(p => p.name === name);
  }

  async getPassword(name: string): Promise<string | undefined> {
    return this.context.secrets.get(secretKey(name, 'password'));
  }

  async getPassphrase(name: string): Promise<string | undefined> {
    return this.context.secrets.get(secretKey(name, 'passphrase'));
  }

  /** Resolves credentials from SecretStorage and reads the key file if needed.
   *  All connect paths must go through this to keep credential handling in one place. */
  async resolveConnectOptions(preset: PresetMeta): Promise<{
    host: string; port: number; username: string;
    password?: string; privateKey?: Buffer; passphrase?: string;
  }> {
    const { host, port, username, authType, keyPath, name } = preset;
    if (authType === 'key') {
      const passphrase = await this.getPassphrase(name);
      let privateKey: Buffer | undefined;
      if (keyPath) {
        try {
          privateKey = fs.readFileSync(keyPath);
        } catch (e) {
          const rawMessage = e instanceof Error ? e.message : String(e);
          log('error', `Cannot read SSH key file "${keyPath}" for preset "${name}": ${rawMessage}`);
          throw new Error(sanitizeKeyFileReadError());
        }
      }
      return { host, port, username, privateKey, passphrase };
    }
    const password = await this.getPassword(name);
    return { host, port, username, password };
  }

  async save(req: SavePresetRequest): Promise<PresetMeta> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const existing = this.getAll();

    const updated = [...existing];

    // Strip any accidental secret fields from the meta object
    const { name, host, port, username, remoteDir, savedPaths, authType, keyPath, readOnly } = req.preset;
    const safeMeta: PresetMeta = {
      name,
      host,
      port,
      username,
      remoteDir,
      savedPaths: Array.isArray(savedPaths) ? savedPaths : [],
      authType,
      keyPath: typeof keyPath === 'string' ? keyPath : '',
      readOnly: readOnly === true,
    };

    if (req.isNew) {
      updated.push(safeMeta);
    } else {
      // Search by originalName first (rename case), then fall back to current name
      const lookupName = req.originalName ?? name;
      const idx = updated.findIndex((p) => p.name === lookupName);
      if (idx !== -1) {
        updated[idx] = safeMeta;
      } else {
        updated.push(safeMeta);
      }
    }

    await config.update(CONFIG_KEY, updated, vscode.ConfigurationTarget.Global);

    if (req.password !== undefined) {
      await this.context.secrets.store(secretKey(name, 'password'), req.password);
    }

    if (req.passphrase !== undefined) {
      await this.context.secrets.store(secretKey(name, 'passphrase'), req.passphrase);
    }

    // If the name changed, migrate secrets from old key to new key then delete old
    if (req.originalName && req.originalName !== name) {
      const oldPw = await this.context.secrets.get(secretKey(req.originalName, 'password'));
      if (oldPw !== undefined && req.password === undefined) {
        await this.context.secrets.store(secretKey(name, 'password'), oldPw);
      }
      const oldPp = await this.context.secrets.get(secretKey(req.originalName, 'passphrase'));
      if (oldPp !== undefined && req.passphrase === undefined) {
        await this.context.secrets.store(secretKey(name, 'passphrase'), oldPp);
      }
      await this.context.secrets.delete(secretKey(req.originalName, 'password'));
      await this.context.secrets.delete(secretKey(req.originalName, 'passphrase'));
    }

    return safeMeta;
  }

  async addSavedPath(presetName: string, remotePath: string): Promise<void> {
    const preset = this.getByName(presetName);
    if (!preset) { return; }
    const normalized = remotePath.replace(/\/$/, '') || '/';
    if (preset.savedPaths.includes(normalized)) { return; }
    await this.save({ preset: { ...preset, savedPaths: [...preset.savedPaths, normalized] }, isNew: false });
  }

  async delete(name: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const existing = this.getAll();
    const updated = existing.filter((p) => p.name !== name);

    await config.update(CONFIG_KEY, updated, vscode.ConfigurationTarget.Global);
    await this.context.secrets.delete(secretKey(name, 'password'));
    await this.context.secrets.delete(secretKey(name, 'passphrase'));
  }

  async clearAll(): Promise<void> {
    const existing = this.getAll();
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_KEY, [], vscode.ConfigurationTarget.Global);

    for (const preset of existing) {
      await this.context.secrets.delete(secretKey(preset.name, 'password'));
      await this.context.secrets.delete(secretKey(preset.name, 'passphrase'));
    }
  }
}
