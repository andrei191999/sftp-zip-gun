import { spawnSync } from 'child_process';

export const ORPHANED_VSCODE_NAMES = new Set(['code.exe', 'code - insiders.exe']);
export const E2E_WORKSPACE_PREFIX = 'sftp-e2e-ws-';
export const E2E_USER_DATA_PREFIX = 'sftp-e2e-user-';
const ACTIVE_RUNNER_NAMES = new Set(['node.exe', 'node', 'npm.exe', 'npm', 'pwsh.exe', 'pwsh', 'powershell.exe', 'powershell']);

function normalizePathForMatch(value) {
  return value
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function tokenizeCommandLine(commandLine) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function getFlagValue(tokens, flagName) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === flagName) {
      const next = tokens[i + 1];
      return next ? next.replace(/^"+|"+$/g, '') : undefined;
    }
    if (token.startsWith(`${flagName}=`)) {
      return token.slice(flagName.length + 1).replace(/^"+|"+$/g, '');
    }
  }
  return undefined;
}

export function isOrphanedVsCodeProcess(processInfo, repoRoot) {
  const name = processInfo.name?.trim().toLowerCase();
  if (!name || !ORPHANED_VSCODE_NAMES.has(name)) {
    return false;
  }

  const commandLine = processInfo.commandLine?.trim();
  if (!commandLine) {
    return false;
  }

  const tokens = tokenizeCommandLine(commandLine);
  const extensionRoot = getFlagValue(tokens, '--extensionDevelopmentPath');
  const userDataDir = getFlagValue(tokens, '--user-data-dir');
  const normalizedRepoRoot = normalizePathForMatch(repoRoot);
  const normalizedExtensionRoot = extensionRoot ? normalizePathForMatch(extensionRoot) : '';
  const normalizedUserDataDir = userDataDir ? normalizePathForMatch(userDataDir) : '';

  if (!normalizedExtensionRoot || normalizedExtensionRoot !== normalizedRepoRoot) {
    return false;
  }

  if (!normalizedUserDataDir.includes(`/${E2E_USER_DATA_PREFIX}`)) {
    return false;
  }

  return tokens.some(token => {
    if (token.startsWith('--')) {
      return false;
    }
    const normalizedToken = normalizePathForMatch(token);
    return normalizedToken.includes(`/${E2E_WORKSPACE_PREFIX}`);
  });
}

function isActiveRunnerProcess(processInfo, repoRoot) {
  const name = processInfo.name?.trim().toLowerCase();
  if (!name || !ACTIVE_RUNNER_NAMES.has(name)) {
    return false;
  }

  const commandLine = processInfo.commandLine?.trim();
  if (!commandLine) {
    return false;
  }

  const normalizedRepoRoot = normalizePathForMatch(repoRoot);
  const normalizedCommandLine = normalizePathForMatch(commandLine);
  if (!normalizedCommandLine.includes(normalizedRepoRoot)) {
    return false;
  }

  return normalizedCommandLine.includes('playwright') || normalizedCommandLine.includes('run-with-cleanup.mjs');
}

function toProcessArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readWindowsProcessSnapshots() {
  const query = [
    '$processes = Get-CimInstance Win32_Process | Where-Object {',
    "  $_.Name -in @('Code.exe', 'Code - Insiders.exe')",
    "  -or $_.Name -in @('node.exe', 'node', 'npm.exe', 'npm', 'pwsh.exe', 'pwsh', 'powershell.exe', 'powershell')",
    '} | Select-Object ProcessId, ParentProcessId, Name, CommandLine',
    '$processes | ConvertTo-Json -Compress',
  ].join(' ');

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (result.status !== 0) {
    return [];
  }

  const output = result.stdout.trim();
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output);
    return toProcessArray(parsed).map(entry => ({
      pid: Number(entry.ProcessId ?? entry.pid),
      parentPid: Number(entry.ParentProcessId ?? entry.parentPid),
      name: String(entry.Name ?? entry.name ?? ''),
      commandLine: entry.CommandLine ?? entry.commandLine ?? '',
    }));
  } catch {
    return [];
  }
}

export function filterOrphanedVsCodeProcesses(processes, repoRoot) {
  const byPid = new Map(
    processes
      .filter(processInfo => Number.isFinite(processInfo.pid))
      .map(processInfo => [processInfo.pid, processInfo])
  );

  return processes.filter(processInfo => {
    if (!isOrphanedVsCodeProcess(processInfo, repoRoot)) {
      return false;
    }

    const parent = byPid.get(processInfo.parentPid);
    return !parent || !isActiveRunnerProcess(parent, repoRoot);
  });
}

export function findOrphanedVsCodeProcesses(repoRoot) {
  return filterOrphanedVsCodeProcesses(readWindowsProcessSnapshots(), repoRoot);
}

export function killProcessTree(pid) {
  try {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function cleanupOrphanedVsCodeProcesses(repoRoot, logger = console) {
  if (process.platform !== 'win32') {
    return 0;
  }

  const matches = findOrphanedVsCodeProcesses(repoRoot);
  let cleaned = 0;

  for (const processInfo of matches) {
    if (Number.isFinite(processInfo.pid) && processInfo.pid > 0 && killProcessTree(processInfo.pid)) {
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.log?.(`[e2e-cleanup] terminated ${cleaned} orphaned VS Code process${cleaned === 1 ? '' : 'es'}.`);
  }

  return cleaned;
}
