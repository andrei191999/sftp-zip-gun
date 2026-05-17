#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const parts = [
  'state.js',
  'helpers.js',
  'bridge.js',
  'renderers.js',
  'bootstrap.js',
];

const styleParts = [
  'base.css',
  'views-and-logs.css',
  'manage-view.css',
  'file-table.css',
  'actions-and-groups.css',
  'status.css',
];

export function buildWebviewPanel(root = process.cwd()) {
  const sourceDir = path.join(root, 'src', 'webview', 'panel');
  const styleDir = path.join(root, 'src', 'webview', 'panel-styles');
  const outputScriptPath = path.join(root, 'media', 'panel.js');
  const outputStylePath = path.join(root, 'media', 'panel.css');

  const bundle = parts
    .map((name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').replace(/\s+$/, ''))
    .join('\n\n');

  fs.writeFileSync(outputScriptPath, bundle + '\n', 'utf8');
  console.log('Wrote ' + path.relative(root, outputScriptPath) + ' from ' + parts.length + ' fragments.');

  const styleBundle = styleParts
    .map((name) => fs.readFileSync(path.join(styleDir, name), 'utf8').replace(/\s+$/, ''))
    .join('\n\n');

  fs.writeFileSync(outputStylePath, styleBundle + '\n', 'utf8');
  console.log('Wrote ' + path.relative(root, outputStylePath) + ' from ' + styleParts.length + ' fragments.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildWebviewPanel();
}
