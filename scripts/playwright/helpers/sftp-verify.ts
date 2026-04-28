import type { TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';

const QA_ROOT =
  process.env.SFTP_ZIP_GUN_QA_ROOT ??
  path.join(os.tmpdir(), 'sftp-zip-gun-qa');

export function storeDir(user: 'pwuser' | 'keyuser'): string {
  return path.join(QA_ROOT, 'data', user, 'store');
}

export interface RemoteTestDir {
  remoteDir: string;
  hostDir: string;
}

export function slugForRemotePath(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');

  return slug || 'unnamed';
}

export function makeRemoteTestDir(
  testInfo: TestInfo,
  user: 'pwuser' | 'keyuser',
  label?: string
): RemoteTestDir {
  const specSlug = slugForRemotePath(
    path.basename(testInfo.file, path.extname(testInfo.file))
  );
  const testSlug = slugForRemotePath(label ?? testInfo.title);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.]/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  const workerDir = `w${testInfo.parallelIndex}-worker${testInfo.workerIndex}`;
  const relativeDir = path.posix.join(
    'e2e',
    workerDir,
    specSlug,
    `${testSlug}-${timestamp}-${suffix}`
  );
  const hostDir = path.join(storeDir(user), relativeDir);
  fs.mkdirSync(hostDir, { recursive: true });

  return {
    hostDir,
    remoteDir: `/store/${relativeDir}`,
  };
}

export function clearRemoteDir(hostDir: string): void {
  if (!fs.existsSync(hostDir)) {
    return;
  }

  const qaRoot = path.resolve(QA_ROOT);
  const resolvedHostDir = path.resolve(hostDir);
  const relative = path.relative(qaRoot, resolvedHostDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clear path outside QA root: ${hostDir}`);
  }

  for (const entry of fs.readdirSync(hostDir)) {
    fs.rmSync(path.join(hostDir, entry), { recursive: true, force: true });
  }
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
