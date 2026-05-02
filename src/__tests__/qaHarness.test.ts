import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function toPowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

describe('QA harness PowerShell helpers', () => {
  it('repairs a stale users.conf directory before writing the config file', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-gun-qa-users-conf-'));
    const qaRoot = path.join(tempRoot, 'sftp-zip-gun-qa');
    const configRoot = path.join(qaRoot, 'config');
    const configPath = path.join(configRoot, 'users.conf');
    fs.mkdirSync(configPath, { recursive: true });

    const scriptPath = path.join(process.cwd(), 'scripts', 'qa', 'Common.ps1');
    const command = [
      `$env:TEMP='${toPowerShellLiteral(tempRoot)}'`,
      `. '${toPowerShellLiteral(scriptPath)}'`,
      'Ensure-QARootLayout',
      'Write-QAUsersConfig',
    ].join('; ');

    expect(() => {
      execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).not.toThrow();

    const stat = fs.statSync(configPath);
    expect(stat.isFile()).toBe(true);

    const content = fs.readFileSync(configPath, 'utf8').trim().split(/\r?\n/);
    expect(content).toEqual([
      'pwuser:pwpass:1001:100:store,drop',
      'keyuser::1002:100:store,drop',
    ]);
  });

  it('removes stale keypair directory targets before key generation', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-gun-qa-keys-'));
    const qaRoot = path.join(tempRoot, 'sftp-zip-gun-qa');
    const keyRoot = path.join(qaRoot, 'keys');
    const publicKeyPath = path.join(keyRoot, 'qa_ed25519.pub');
    fs.mkdirSync(publicKeyPath, { recursive: true });

    const scriptPath = path.join(process.cwd(), 'scripts', 'qa', 'Common.ps1');
    const command = [
      `$env:TEMP='${toPowerShellLiteral(tempRoot)}'`,
      `. '${toPowerShellLiteral(scriptPath)}'`,
      'Ensure-QARootLayout',
      "Remove-StaleQATarget -Path (Get-QAPublicKeyPath)",
    ].join('; ');

    expect(() => {
      execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).not.toThrow();

    expect(fs.existsSync(publicKeyPath)).toBe(false);
  });
});
