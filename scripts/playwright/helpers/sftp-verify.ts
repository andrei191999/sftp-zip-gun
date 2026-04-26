import fs from 'fs';
import path from 'path';
import os from 'os';

const QA_ROOT =
  process.env.SFTP_ZIP_GUN_QA_ROOT ??
  path.join(os.tmpdir(), 'sftp-zip-gun-qa');

export function storeDir(user: 'pwuser' | 'keyuser'): string {
  return path.join(QA_ROOT, 'data', user, 'store');
}

export function assertFileExists(dir: string, name: string): void {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    throw new Error(`Expected file missing: ${p}`);
  }
}

export function assertFileAbsent(dir: string, name: string): void {
  const p = path.join(dir, name);
  if (fs.existsSync(p)) {
    throw new Error(`File should not exist: ${p}`);
  }
}

/** Returns all filenames currently in dir (empty array if dir missing). */
export function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/**
 * Waits up to timeoutMs for a predicate to return true, polling every 500 ms.
 * Use this to wait for SFTP-uploaded files to appear on the host mount.
 */
export async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 45_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timeout: ${message}`);
}
