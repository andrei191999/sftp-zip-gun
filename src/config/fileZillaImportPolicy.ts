import type { PresetMeta } from '../types/messages';
import type { FileZillaServerRecord } from './fileZillaParser';

export interface ImportResult {
  presets: Array<PresetMeta & { password?: string }>;
  skipped: number;
  duplicates: number;
}

function makeFingerprint(host: string, username: string, port: number, remoteDir: string): string {
  return `${host}|${username}|${port}|${remoteDir}`;
}

export function applyFileZillaImportPolicy(
  servers: FileZillaServerRecord[],
  existingPresets: PresetMeta[] = [],
): ImportResult {
  const presets: Array<PresetMeta & { password?: string }> = [];
  const seenNames = new Set<string>();
  const existingFingerprints = new Set(
    existingPresets.map(p => makeFingerprint(p.host, p.username, p.port, p.remoteDir))
  );
  const seenFingerprints = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const server of servers) {
    const normalizedName = server.name.trim();
    if (!normalizedName) {
      skipped++;
      continue;
    }

    const fingerprint = makeFingerprint(server.host, server.username, server.port, server.remoteDir);

    if (seenNames.has(normalizedName)) {
      skipped++;
      continue;
    }

    if (existingFingerprints.has(fingerprint) || seenFingerprints.has(fingerprint)) {
      duplicates++;
      continue;
    }

    seenNames.add(normalizedName);
    seenFingerprints.add(fingerprint);

    const preset: PresetMeta & { password?: string } = {
      name: normalizedName,
      host: server.host,
      port: server.port,
      username: server.username,
      remoteDir: server.remoteDir,
      savedPaths: [],
      authType: 'password',
      keyPath: '',
      readOnly: false,
      ...(server.password !== undefined ? { password: server.password } : {}),
    };

    presets.push(preset);
  }

  return { presets, skipped, duplicates };
}
