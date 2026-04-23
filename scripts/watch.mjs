#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildWebviewPanel } from './build-webview-panel.mjs';
import { createExtensionWatchContext } from './build-extension.mjs';

const root = process.cwd();
const webviewDirs = [
  path.join(root, 'src', 'webview', 'panel'),
  path.join(root, 'src', 'webview', 'panel-styles'),
];

let rebuildTimer;

function scheduleWebviewBuild(triggerPath) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    try {
      buildWebviewPanel(root);
      if (triggerPath) {
        console.log(`Rebuilt webview after change: ${path.relative(root, triggerPath)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Webview rebuild failed: ${message}`);
    }
  }, 50);
}

buildWebviewPanel(root);

for (const dir of webviewDirs) {
  fs.watch(dir, { recursive: true }, (_eventType, fileName) => {
    scheduleWebviewBuild(fileName ? path.join(dir, fileName) : dir);
  });
}

const ctx = await createExtensionWatchContext(root);
await ctx.watch();
console.log('Watching extension and webview sources for changes...');
