import type { PresetMeta } from '../types/messages';
import { applyFileZillaImportPolicy, type ImportResult } from './fileZillaImportPolicy';
import { parseFileZillaServers } from './fileZillaParser';

export type { ImportResult };

export function parseFileZillaXml(xmlContent: string, existingPresets: PresetMeta[] = []): ImportResult {
  const servers = parseFileZillaServers(xmlContent);
  return applyFileZillaImportPolicy(servers, existingPresets);
}
