import { XMLParser } from 'fast-xml-parser';
import { PresetMeta } from '../types/messages';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  parseTagValue: true,
});

export interface ImportResult {
  presets: Array<PresetMeta & { password?: string }>;
  skipped: number;
  duplicates: number;
}

function decodePassword(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  // Object form: { '#text': '<base64str>', '@_encoding': 'base64' }
  if (typeof raw === 'object') {
    const text = (raw as Record<string, unknown>)['#text'];
    if (typeof text === 'string' && text.length > 0) {
      return Buffer.from(text, 'base64').toString('utf8');
    }
    return undefined;
  }
  // Plain string (legacy format)
  if (typeof raw === 'string' && raw.length > 0) {
    return Buffer.from(raw, 'base64').toString('utf8');
  }
  return undefined;
}

function extractServers(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

  // Collect <Server> elements directly under this node
  const serverRaw = node['Server'];
  if (Array.isArray(serverRaw)) {
    for (const s of serverRaw) {
      if (s !== null && typeof s === 'object') {
        results.push(s as Record<string, unknown>);
      }
    }
  } else if (serverRaw !== null && typeof serverRaw === 'object') {
    results.push(serverRaw as Record<string, unknown>);
  }

  // Recurse into <Folder> elements
  const folderRaw = node['Folder'];
  const folders: Array<Record<string, unknown>> = [];
  if (Array.isArray(folderRaw)) {
    for (const f of folderRaw) {
      if (f !== null && typeof f === 'object') {
        folders.push(f as Record<string, unknown>);
      }
    }
  } else if (folderRaw !== null && typeof folderRaw === 'object') {
    folders.push(folderRaw as Record<string, unknown>);
  }

  for (const folder of folders) {
    results.push(...extractServers(folder));
  }

  return results;
}

function getString(node: Record<string, unknown>, key: string): string {
  const val = node[key];
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number') {
    return String(val);
  }
  return '';
}

function getNumber(node: Record<string, unknown>, key: string): number {
  const val = node[key];
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export function parseFileZillaXml(xmlContent: string, existingPresets: PresetMeta[] = []): ImportResult {
  const parsed = parser.parse(xmlContent) as Record<string, unknown>;

  // Navigate to Servers container: FileZilla3 > Servers (or directly Servers at root)
  let serversNode: Record<string, unknown> | undefined;

  const fz3 = parsed['FileZilla3'];
  if (fz3 !== null && typeof fz3 === 'object') {
    const fz3Node = fz3 as Record<string, unknown>;
    const servers = fz3Node['Servers'];
    if (servers !== null && typeof servers === 'object') {
      serversNode = servers as Record<string, unknown>;
    }
  }

  if (!serversNode) {
    const servers = parsed['Servers'];
    if (servers !== null && typeof servers === 'object') {
      serversNode = servers as Record<string, unknown>;
    }
  }

  if (!serversNode) {
    return { presets: [], skipped: 0, duplicates: 0 };
  }

  const rawServers = extractServers(serversNode);

  const presets: Array<PresetMeta & { password?: string }> = [];
  const seenNames = new Set<string>();
  // Fingerprint = host|username — used to detect same-account duplicates
  const existingFingerprints = new Set(existingPresets.map(p => `${p.host}|${p.username}`));
  const seenFingerprints = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const server of rawServers) {
    const protocol = getNumber(server, 'Protocol');
    if (protocol !== 1) {
      continue;
    }

    const name = getString(server, 'Name');
    if (!name) {
      skipped++;
      continue;
    }

    if (seenNames.has(name)) {
      skipped++;
      continue;
    }

    const host = getString(server, 'Host');
    const username = getString(server, 'User');
    const fingerprint = `${host}|${username}`;

    if (existingFingerprints.has(fingerprint) || seenFingerprints.has(fingerprint)) {
      duplicates++;
      continue;
    }

    seenNames.add(name);
    seenFingerprints.add(fingerprint);

    const port = getNumber(server, 'Port') || 22;
    const remoteDirRaw = server['RemoteDir'];
    const remoteDir =
      typeof remoteDirRaw === 'string' && remoteDirRaw.length > 0
        ? remoteDirRaw
        : '/';

    const password = decodePassword(server['Pass']);

    const preset: PresetMeta & { password?: string } = {
      name,
      host,
      port,
      username,
      remoteDir,
      savedPaths: [],
      authType: 'password',
      keyPath: '',
      readOnly: false,
      ...(password !== undefined ? { password } : {}),
    };

    presets.push(preset);
  }

  return { presets, skipped, duplicates };
}
