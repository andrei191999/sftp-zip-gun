import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { cleanupOrphanedVsCodeProcesses } from './helpers/orphaned-vscode.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const playwrightCli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');

cleanupOrphanedVsCodeProcesses(repoRoot);

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [playwrightCli, ...args], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
