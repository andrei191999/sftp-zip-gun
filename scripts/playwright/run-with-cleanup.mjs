import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { cleanupOrphanedVsCodeProcesses } from './helpers/orphaned-vscode.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const playwrightCli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');

const args = process.argv.slice(2);
let result;

try {
  cleanupOrphanedVsCodeProcesses(repoRoot);
  result = spawnSync(process.execPath, [playwrightCli, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
} finally {
  cleanupOrphanedVsCodeProcesses(repoRoot);
}

if (result?.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result?.status ?? 1);
