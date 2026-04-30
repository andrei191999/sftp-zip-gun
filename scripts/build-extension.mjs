#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, context } from 'esbuild';

function getBuildOptions(root = process.cwd()) {
  return {
    entryPoints: [path.join(root, 'src', 'extension.ts')],
    bundle: true,
    platform: 'node',
    external: ['vscode', 'ssh2-sftp-client'],
    outfile: path.join(root, 'dist', 'extension.js'),
    sourcemap: true,
    logLevel: 'info',
  };
}

export async function buildExtension(root = process.cwd()) {
  await build(getBuildOptions(root));
}

export async function createExtensionWatchContext(root = process.cwd()) {
  return context(getBuildOptions(root));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildExtension();
}
