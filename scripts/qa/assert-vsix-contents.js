const fs = require('fs');
const path = require('path');
const { PackageManager, listFiles } = require('@vscode/vsce');

const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/extension.js',
  'media/panel.html',
  'media/panel.js',
  'media/panel.css',
  'media/vsc-logo.png',
];

const deniedPatterns = [
  /^\.env(?:\.|$)/,
  /^\.mcp\.json$/,
  /^AGENTS\.md$/,
  /^bash\.exe\.stackdump$/,
  /^\.agents\//,
  /^\.code-review-graph\//,
  /^playwright-report\//,
  /^test-results\//,
  /^scripts\//,
  /^src\//,
  /^docs\//,
  /^openspec\//,
  /^\.codex\//,
  /^\.claude\//,
  /^\.superpowers\//,
  /^\.vscode\//,
  /^\.vscode-test\//,
  /^\.git\//,
  /^\.gitignore$/,
  /^tsconfig(?:\..*)?\.json$/,
  /^jest\.config\.js$/,
  /^jest\.transform\.js$/,
  /^node_modules\/.*\/\.github\//,
  /^node_modules\/.*\/test\//,
  /^node_modules\/.*\/tests\//,
  /^node_modules\/.*\/example\//,
  /^node_modules\/.*\/examples\//,
  /^node_modules\/.*\/docs\//,
  /^node_modules\/.*\/doc\//,
  /^node_modules\/.*\/coverage\//,
  /^node_modules\/.*\/benchmark\//,
  /^node_modules\/.*\/benchmarks\//,
  /^node_modules\/.*\/README[^/]*$/i,
  /^node_modules\/.*\/CHANGELOG[^/]*$/i,
  /^node_modules\/.*\/HISTORY[^/]*$/i,
  /^node_modules\/.*\/\.eslintrc[^/]*$/i,
  /^node_modules\/.*\/\.eslintignore$/i,
  /^node_modules\/.*\/WORKSPACE$/i,
  /^node_modules\/.*\/Makefile$/i,
  /^node_modules\/.*\/util\/build_pagent\.bat$/i,
  /\.vsix$/,
  /\.map$/,
];

const contentChecks = [
  {
    path: 'README.md',
    denied: [
      /docs\/internal\/README\.md/,
      /AGENTS\.md/,
      /openspec\/changes\//,
      /Internal maintenance docs/i,
      /Internal repo guidance/i,
    ],
  },
  {
    path: 'media/panel.js',
    denied: [
      /\/home\/user\/\.ssh\/id_rsa/,
      /[A-Za-z]:\\\\Users\\\\/,
      /C:\\\\Workspace\\\\/,
      /file:\/\/\/C:\//,
    ],
  },
];

async function main() {
  const entries = (await listFiles({
    cwd: process.cwd(),
    packageManager: PackageManager.None,
  }))
    .map((entry) => entry.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  const missing = required.filter((entry) => !entries.includes(entry));
  const denied = entries.filter((entry) => deniedPatterns.some((pattern) => pattern.test(entry)));
  const contentViolations = [];

  for (const check of contentChecks) {
    const filePath = path.join(process.cwd(), check.path);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of check.denied) {
      if (pattern.test(content)) {
        contentViolations.push(`${check.path} matches ${pattern}`);
      }
    }
  }

  if (missing.length || denied.length || contentViolations.length) {
    if (missing.length) {
      console.error('Missing required VSIX entries:');
      for (const entry of missing) {
        console.error(`- ${entry}`);
      }
    }
    if (denied.length) {
      console.error('Denied VSIX entries found:');
      for (const entry of denied) {
        console.error(`- ${entry}`);
      }
    }
    if (contentViolations.length) {
      console.error('Denied VSIX content patterns found:');
      for (const violation of contentViolations) {
        console.error(`- ${violation}`);
      }
    }
    process.exit(1);
  }

  console.log(`VSIX contents check passed (${entries.length} entries).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
