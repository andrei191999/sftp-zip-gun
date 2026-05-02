import assert from 'node:assert/strict';
import { E2E_USER_DATA_PREFIX, E2E_WORKSPACE_PREFIX, filterOrphanedVsCodeProcesses, isOrphanedVsCodeProcess } from './orphaned-vscode.mjs';

const repoRoot = process.cwd();
const normalizedRepoRoot = repoRoot.replace(/\\/g, '/').toLowerCase();
const e2eUserDir = `X:\\synthetic-temp\\${E2E_USER_DATA_PREFIX}abc123`;
const e2eWorkspaceDir = `X:\\synthetic-temp\\${E2E_WORKSPACE_PREFIX}abc123`;

{
  const commandLine = [
    'Code.exe',
    `--extensionDevelopmentPath="${repoRoot}"`,
    '--disable-updates',
    '--no-sandbox',
    `--user-data-dir="${e2eUserDir}"`,
    `"${e2eWorkspaceDir}"`,
  ].join(' ');

  assert.equal(
    isOrphanedVsCodeProcess({ name: 'Code.exe', commandLine }, repoRoot),
    true
  );
}

{
  const commandLine = [
    'Code.exe',
    '--folder-uri',
    '"file:///X:/synthetic-project"',
    '--user-data-dir="X:\\synthetic-profile\\Code"',
  ].join(' ');

  assert.equal(
    isOrphanedVsCodeProcess({ name: 'Code.exe', commandLine }, repoRoot),
    false
  );
}

{
  const commandLine = [
    'Code.exe',
    '--extensionDevelopmentPath="X:\\synthetic\\other-extension"',
    `--user-data-dir="${e2eUserDir}"`,
    `"${e2eWorkspaceDir}"`,
  ].join(' ');

  assert.equal(
    isOrphanedVsCodeProcess({ name: 'Code.exe', commandLine }, repoRoot),
    false
  );
}

{
  const commandLine = [
    'Code.exe',
    `--extensionDevelopmentPath="${repoRoot}"`,
    `--user-data-dir="${e2eUserDir}"`,
    '"X:\\synthetic-temp\\some-other-workspace"',
  ].join(' ');

  assert.equal(
    isOrphanedVsCodeProcess({ name: 'Code.exe', commandLine }, repoRoot),
    false
  );
}

{
  const commandLine = [
    'CODE.EXE',
    `--extensionDevelopmentPath="${normalizedRepoRoot.toUpperCase()}"`,
    `--user-data-dir="${e2eUserDir}"`,
    `"${e2eWorkspaceDir}"`,
  ].join(' ');

  assert.equal(
    isOrphanedVsCodeProcess({ name: 'code.exe', commandLine }, repoRoot),
    true
  );
}

{
  const child = {
    pid: 9001,
    parentPid: 4001,
    name: 'Code.exe',
    commandLine: [
      'Code.exe',
      `--extensionDevelopmentPath="${repoRoot}"`,
      `--user-data-dir="${e2eUserDir}"`,
      `"${e2eWorkspaceDir}"`,
    ].join(' '),
  };
  const parent = {
    pid: 4001,
    name: 'node.exe',
    commandLine: `node ${normalizedRepoRoot}/scripts/playwright/run-with-cleanup.mjs test`,
  };

  assert.deepEqual(filterOrphanedVsCodeProcesses([child, parent], repoRoot), []);
}

console.log('orphaned-vscode matcher assertions passed');
