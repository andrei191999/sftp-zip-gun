import { XMLParser } from 'fast-xml-parser';

export interface FileZillaServerRecord {
  name: string;
  host: string;
  port: number;
  username: string;
  remoteDir: string;
  password?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  parseTagValue: true,
});

function decodePassword(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === 'object') {
    const text = (raw as Record<string, unknown>)['#text'];
    if (typeof text === 'string' && text.length > 0) {
      return Buffer.from(text, 'base64').toString('utf8');
    }
    return undefined;
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return Buffer.from(raw, 'base64').toString('utf8');
  }
  return undefined;
}

function extractServers(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

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

function getServersNode(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const fz3 = parsed['FileZilla3'];
  if (fz3 !== null && typeof fz3 === 'object') {
    const fz3Node = fz3 as Record<string, unknown>;
    const servers = fz3Node['Servers'];
    if (servers !== null && typeof servers === 'object') {
      return servers as Record<string, unknown>;
    }
  }

  const servers = parsed['Servers'];
  if (servers !== null && typeof servers === 'object') {
    return servers as Record<string, unknown>;
  }

  return undefined;
}

export function parseFileZillaServers(xmlContent: string): FileZillaServerRecord[] {
  const parsed = parser.parse(xmlContent) as Record<string, unknown>;
  const serversNode = getServersNode(parsed);
  if (!serversNode) {
    return [];
  }

  return extractServers(serversNode)
    .filter(server => getNumber(server, 'Protocol') === 1)
    .map((server): FileZillaServerRecord => {
      const remoteDirRaw = server['RemoteDir'];
      const remoteDir =
        typeof remoteDirRaw === 'string' && remoteDirRaw.length > 0
          ? remoteDirRaw
          : '/';

      return {
        name: getString(server, 'Name'),
        host: getString(server, 'Host'),
        port: getNumber(server, 'Port') || 22,
        username: getString(server, 'User'),
        remoteDir,
        password: decodePassword(server['Pass']),
      };
    });
}
