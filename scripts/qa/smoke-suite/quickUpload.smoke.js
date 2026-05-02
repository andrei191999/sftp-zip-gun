const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const QA_ROOT = process.env.SFTP_ZIP_GUN_QA_ROOT;
const SMOKE_MODE = process.env.SFTP_ZIP_GUN_SMOKE_MODE || 'dev';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, errorMessage, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(250);
  }
  throw new Error(errorMessage);
}

async function activateExtension() {
  const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'sftp-zip-gun');
  assert.ok(extension, 'sftp-zip-gun extension was not loaded in the test host.');
  await extension.activate();
}

function qaPrivateKeyPath() {
  return path.join(QA_ROOT, 'keys', 'qa_ed25519');
}

function remoteMountPath(user, remoteDir, fileName) {
  return path.join(QA_ROOT, 'data', user, remoteDir.replace(/^\/+/, ''), fileName);
}

async function resetAndSeedPreset(preset) {
  await vscode.commands.executeCommand('sftpZipGun._test.resetState');
  await vscode.commands.executeCommand('sftpZipGun._test.seedPresets', {
    presets: [{
      preset,
      isNew: true,
      password: preset.authType === 'password' ? 'pwpass' : undefined,
      passphrase: preset.authType === 'key' ? '' : undefined,
    }],
    state: { lastPresetName: preset.name },
  });
}

async function createLocalFile(prefix) {
  const filePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}.txt`);
  fs.writeFileSync(filePath, `smoke:${prefix}:${Date.now()}`, 'utf8');
  return filePath;
}

async function assertUploadRecorded(expectedPresetName, expectedFileName) {
  const history = await waitFor(async () => {
    const entries = await vscode.commands.executeCommand('sftpZipGun._test.getHistory');
    return Array.isArray(entries) && entries.length > 0 ? entries : null;
  }, 'Timed out waiting for upload history.');

  const entry = history.find((item) => item.presetName === expectedPresetName && item.files?.includes(expectedFileName));
  assert.ok(entry, `Missing history entry for ${expectedPresetName} / ${expectedFileName}.`);
  assert.strictEqual(entry.result, 'success');
}

async function runQuickUpload(preset, remoteUser, remoteDir) {
  await resetAndSeedPreset(preset);

  const localFile = await createLocalFile(preset.name.toLowerCase().replace(/\s+/g, '-'));
  const fileName = path.basename(localFile);
  const remotePath = remoteMountPath(remoteUser, remoteDir, fileName);

  await vscode.commands.executeCommand('sftpZipGun.quickUpload', vscode.Uri.file(localFile));

  await waitFor(() => fs.existsSync(remotePath), `Timed out waiting for uploaded file ${remotePath}.`, 45000);
  await assertUploadRecorded(preset.name, fileName);

  return { localFile, fileName, remotePath };
}

describe('SFTP Zip Gun quickUpload smoke', () => {
  before(async function () {
    this.timeout(120000);
    assert.ok(QA_ROOT, 'SFTP_ZIP_GUN_QA_ROOT must be set for smoke tests.');
    await activateExtension();
  });

  it('uploads with password auth and records history', async function () {
    this.timeout(120000);

    const preset = {
      name: 'QA Password',
      host: '127.0.0.1',
      port: 2222,
      username: 'pwuser',
      remoteDir: '/store',
      savedPaths: ['/store', '/drop'],
      authType: 'password',
      keyPath: '',
      readOnly: false,
    };

    const result = await runQuickUpload(preset, 'pwuser', '/store');
    assert.ok(fs.existsSync(result.remotePath), 'Uploaded file was not retained in the host-mounted password fixture directory.');
  });

  it('uploads with key auth and retains earlier uploads', async function () {
    this.timeout(120000);

    const passwordDir = path.join(QA_ROOT, 'data', 'pwuser', 'store');
    const beforeFiles = new Set(fs.existsSync(passwordDir) ? fs.readdirSync(passwordDir) : []);

    const preset = {
      name: 'QA Key',
      host: '127.0.0.1',
      port: 2222,
      username: 'keyuser',
      remoteDir: '/store',
      savedPaths: ['/store', '/drop'],
      authType: 'key',
      keyPath: qaPrivateKeyPath(),
      readOnly: false,
    };

    const result = await runQuickUpload(preset, 'keyuser', '/store');
    assert.ok(fs.existsSync(result.remotePath), 'Uploaded file was not retained in the host-mounted key fixture directory.');

    for (const existing of beforeFiles) {
      assert.ok(
        fs.existsSync(path.join(passwordDir, existing)),
        `Expected previous password upload ${existing} to remain after later smoke runs.`
      );
    }
  });

  if (SMOKE_MODE === 'vsix') {
    it('packaged build quickUpload smoke', async function () {
      this.timeout(120000);

      const preset = {
        name: 'QA Packaged',
        host: '127.0.0.1',
        port: 2222,
        username: 'pwuser',
        remoteDir: '/store',
        savedPaths: ['/store', '/drop'],
        authType: 'password',
        keyPath: '',
        readOnly: false,
      };

      const result = await runQuickUpload(preset, 'pwuser', '/store');
      assert.ok(fs.existsSync(result.remotePath), 'Packaged smoke upload did not reach the fixture.');
    });
  }
});
