const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[rawKey] = next;
      index += 1;
      continue;
    }

    parsed[rawKey] = true;
  }
  return parsed;
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function createWorkspaceRoot(providedRoot) {
  if (providedRoot) {
    return ensureDir(path.resolve(providedRoot));
  }

  return fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-gun-smoke-workspace-'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDevelopmentPath = path.resolve(args.extensionPath || path.join(__dirname, '..', '..'));
  const extensionTestsPath = path.join(__dirname, 'smoke-suite', 'index.js');
  const workspaceRoot = createWorkspaceRoot(args.workspace);
  const userDataDir = ensureDir(path.resolve(args.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-gun-user-'))));
  const extensionsDir = ensureDir(path.resolve(args.extensionsDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-gun-exts-'))));
  const smokeMode = args.mode || process.env.SFTP_ZIP_GUN_SMOKE_MODE || 'dev';

  process.env.SFTP_ZIP_GUN_QA_ROOT = path.resolve(
    args.qaRoot || process.env.SFTP_ZIP_GUN_QA_ROOT || path.join(os.tmpdir(), 'sftp-zip-gun-qa')
  );
  process.env.SFTP_ZIP_GUN_SMOKE_MODE = smokeMode;
  process.env.SFTP_ZIP_GUN_TEST_MODE = '1';

  const { runTests } = require('@vscode/test-electron');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        SFTP_ZIP_GUN_QA_ROOT: process.env.SFTP_ZIP_GUN_QA_ROOT,
        SFTP_ZIP_GUN_SMOKE_MODE: smokeMode,
        SFTP_ZIP_GUN_TEST_MODE: '1',
      },
      launchArgs: [
        workspaceRoot,
        '--disable-extensions',
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
