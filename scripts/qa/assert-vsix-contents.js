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
  /^\.vscode\//,
  /^\.vscode-test\//,
  /^\.git\//,
  /^\.gitignore$/,
  /^tsconfig(?:\..*)?\.json$/,
  /^jest\.config\.js$/,
  /^jest\.transform\.js$/,
  /\.vsix$/,
  /\.map$/,
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

  if (missing.length || denied.length) {
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
    process.exit(1);
  }

  console.log(`VSIX contents check passed (${entries.length} entries).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
