---
name: vs-code-ext-creator
description: Use when Andrei asks to create, scaffold, or extend a VS Code extension. Covers manifest conventions, bundler setup, credential handling, webview security, testing, publishing, and the parallel subagent build pattern for the am-vs-tools publisher.
---

# Skill: VS Code Extension Authoring for Andrei (am-vs-tools)

**Trigger:** Invoke this skill whenever Andrei asks to create, scaffold, build, or extend a VS Code extension.

---

## 1. High-Level Preferences

- Language: **TypeScript**.
- Publisher ID: **`am-vs-tools`** — used in `package.json` `publisher` field **only**, not in command or config IDs.
- Extensions are built primarily for **VS Code Desktop** (not web) unless explicitly stated.
- Secrets must be stored using **VS Code SecretStorage** (`context.secrets`) — never in plain-text settings.
- Extensions should:
  - Respect VS Code UX guidelines.
  - Use narrow activation events (never `"*"`).
  - Avoid unnecessary custom UI.
  - Work correctly in Remote SSH, WSL, and Dev Container environments (see section 10).

When in doubt, aim for a clean, minimal, "native VS Code" feel.

---

## 2. Default Workflow for a New Extension

When Andrei asks for help starting a new extension from scratch, follow this sequence:

1. **Clarify the problem & domain**
   - Ask what the extension should do, who it's for, and the typical workflow.
   - Ask whether it needs:
     - Commands only.
     - Context menus.
     - Tree views or webviews.
     - Diagnostics / Problems pane output.

2. **Name and IDs**
   - Propose:
     - A short, lowercase `name` (e.g., `sftp-upload`, `xml-xslt-studio`).
     - A human-friendly `displayName`.
     - An **extension-specific** command/config namespace (e.g., `sftpUpload.`, `xmlXslt.`) — derived from the extension name, distinct from the publisher ID `am-vs-tools`.
   - Hard-code `publisher: "am-vs-tools"` unless Andrei says otherwise.

3. **Scaffold**
   - **Preferred (manual):** Create the folder structure and files directly — gives full control over bundler, no webpack defaults to strip out.
     - Directories: `src/`, `media/` (if webview), `dist/` (gitignored), `spikes/` (throwaway proofs)
     - Files: `package.json`, `tsconfig.json`, `esbuild.config.js`, `.vscodeignore`
   - **Alternative (Yeoman):** `npx --package yo --package generator-code -- yo code` with New Extension (TypeScript) — then immediately replace the generated webpack setup with esbuild (see section 5).
   - After scaffolding:
     - Set `publisher` to `am-vs-tools`.
     - Set `engines.vscode` to the minimum version that exposes all APIs you need (see section 4).
     - Set `main` to `"./dist/extension.js"` (esbuild output, not `./out/`).

4. **Run validation spikes before writing extension code**
   - Create throwaway scripts in `spikes/` to verify each external dependency and VS Code API assumption.
   - Common spikes: library connectivity, XML parsing field paths, bundle verification, webview message round-trip.
   - Delete `spikes/` after all pass.

5. **Plan manifest structure**
   - Before writing code, design:
     - `activationEvents` — as specific as possible.
     - `contributes.commands` — minimal, well-named commands.
     - Optional `contributes.menus`, `views`, and `configuration`.

6. **Implement core command flow**
   - Start from `src/extension.ts`.
   - Implement the minimal "happy path" first.
   - Use `context.subscriptions` for all disposables.

7. **Add tests**
   - Unit tests (`jest` + `ts-jest`) for pure pipeline/utility logic with no VS Code host dependency.
   - Integration tests (`@vscode/test-cli` + `mocha`) for commands that require the VS Code host.

8. **Wire basic publishing**
   - Ensure build script produces `dist/extension.js`.
   - Add `.vscodeignore` (see section 11).
   - Explain manual publishing steps (`vsce package`, `vsce publish`).

---

## 3. Manifest Conventions

When generating or editing `package.json`, follow these conventions:

```jsonc
{
  "publisher": "am-vs-tools",
  "engines": { "vscode": "^1.XX.0" },  // set based on APIs used — see section 4
  "main": "./dist/extension.js",
  "icon": "icon.png",                   // 128×128 PNG at repo root, required for Marketplace
  "categories": ["Other"],
  "activationEvents": [],
  "contributes": {}
}
```

- Prefer `activationEvents` like:
  - `onCommand:sftpUpload.openPanel`
  - `onLanguage:xml` / `onLanguage:xsl`
  - `onView:myExt.someView`
  - Avoid `"*"`.

- Command IDs and config keys use an **extension-specific namespace**, NOT `am-vs-tools.`:

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "sftpUpload.openPanel",
        "title": "Open SFTP Upload Panel",
        "category": "SFTP Upload",
        "icon": "$(cloud-upload)"
      }
    ],
    "configuration": {
      "title": "SFTP Upload",
      "properties": {
        "sftpUpload.presets": {
          "type": "array",
          "markdownDescription": "Named SFTP presets (non-sensitive fields only)."
        }
      }
    }
  }
}
```

- `am-vs-tools` is the Marketplace publisher identity — it belongs in `publisher` only.
- For settings that need per-workspace vs. global scoping, set `"scope"` explicitly on configuration properties.
- Code action commands invoked only by a `CodeActionsProvider` (not the palette) should be listed in `contributes.commands` **without a `title`** — this hides them from the palette while still registering them.

---

## 4. VS Code Engine Version

Set `engines.vscode` to the **lowest version that exposes all APIs the extension requires**. Do not default to a recent version without checking.

| Feature / API | Minimum `engines.vscode` |
|---|---|
| `ExtensionContext.secrets` (SecretStorage) | `^1.74.0` |
| `vscode.window.tabGroups` Tab API | `^1.85.0` |
| Inline values / inlay hints | `^1.67.0` |
| Notebook API | `^1.68.0` |

When no specific API drives the version, use `^1.80.0` (Dec 2023) as a reasonable default — but always verify.

---

## 5. Bundler — esbuild (Required)

Use **esbuild** for all new extensions. Do not use webpack.

**Why:** esbuild is 10–100× faster, has a simpler config, produces smaller output, and is the current VS Code extension template recommendation.

### Install

```bash
npm install -D esbuild
```

### Build script in `package.json`

```jsonc
{
  "scripts": {
    "compile":   "esbuild src/extension.ts --bundle --platform=node --external:vscode --outfile=dist/extension.js --sourcemap",
    "watch":     "npm run compile -- --watch",
    "package":   "vsce package",
    "typecheck": "tsc --noEmit"
  }
}
```

### `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "outDir": "dist",   // tsc is type-check only (--noEmit); esbuild produces actual output
    "lib": ["ES2020"]
  }
}
```

### Critical points

- `--external:vscode` tells esbuild not to bundle the `vscode` module (provided at runtime by VS Code host).
- `tsc` is used **only** for type-checking (`npm run typecheck`), not for producing build artifacts.
- `dist/` is the bundled output. The `src/` TypeScript source is never shipped in the VSIX.
- Verify esbuild excluded `vscode` correctly: `node -e "require('./dist/extension.js')"` should fail with "Cannot find module 'vscode'" — not any other error. This confirms the external flag worked.

---

## 6. Secret & Credential Handling Rules

When the extension needs passwords, tokens, or keys:

1. **Never** propose storing them in:
   - `settings.json` / workspace settings.
   - Environment variables inside the extension.
   - Custom config files in the workspace.
   - `globalState` or any synced storage.

2. Always use `ExtensionContext.secrets`:

```ts
// Store
await context.secrets.store('sftpUpload.preset.DEV.password', value);

// Read
const password = await context.secrets.get('sftpUpload.preset.DEV.password');

// Delete (e.g., on preset removal)
await context.secrets.delete('sftpUpload.preset.DEV.password');
await context.secrets.delete('sftpUpload.preset.DEV.passphrase');
```

3. Key naming convention: `{extensionNamespace}.{resource}.{identifier}.{field}`
   - e.g., `sftpUpload.preset.DEV.password`, `xmlXslt.ai.apiKey.anthropic`

4. Never log secrets (or partial secrets) to the output channel.

5. **Never include credential fields in messages sent to the webview** — even in `HostMessage` types. Send only `PresetMeta[]` (non-sensitive); accept `PresetWithCredentials` only in the `webview→host` direction.

6. Settings schema in `package.json` must **not** define `password` or `passphrase` properties — no credential field should appear in any configuration schema.

When generating code, always follow these rules by default.

---

## 7. Testing Defaults

Use **two testing layers**:

### Layer 1 — Unit tests (jest + ts-jest)

For pure pipeline/utility logic with no VS Code host dependency:

```bash
npm install -D jest ts-jest @types/jest
```

```js
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts']
};
```

Good candidates: parsers (SVRL, XML, trace files), data transformers, schema mappers, business logic functions, TypeScript type exhaustiveness checks.

**Advantage:** Fast, no VS Code instance needed, runs in CI without `xvfb`.

### Layer 2 — Integration tests (@vscode/test-cli + mocha)

For commands, extension activation, and webview round-trips that require the VS Code host:

```bash
npm install -D @vscode/test-cli @vscode/test-electron mocha @types/mocha
```

Provide at least:
- One test that activates the extension and checks commands are registered.
- One test that exercises a key command against a real workspace fixture.

### Test scripts in `package.json`

```jsonc
{
  "scripts": {
    "test":       "jest",
    "test:vscode": "vscode-test"
  }
}
```

---

## 8. UX Guidance

When proposing UI or behavior:

- Prefer:
  - Command Palette entries.
  - Context menus limited by meaningful `when` clauses (e.g., `resourceExtname == .xml`, `resourceLangId == xml`).
  - Activity Bar views only when necessary.

- Use:
  - `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true })` for long operations.
  - Diagnostics for errors that map naturally to files/locations.
  - **Output channels** (`vscode.OutputChannel`) for verbose/debug logs (e.g., raw Java/Saxon stderr, SOAP call details). Do not auto-show the output channel — let users open it via View > Output.
  - `vscode.StatusBarItem` for persistent, glanceable state (active preset, upload progress, watch mode).

- Avoid:
  - Overloading the UI with many commands or views.
  - Global activation for trivial features.
  - Hardcoded colours in webview CSS — always use VS Code CSS variables.

---

## 9. Webview Rules (Security-Critical)

Follow these rules whenever building a webview panel.

### 9.1 CSP nonce injection

Generate a fresh nonce per panel creation:

```ts
import * as crypto from 'crypto';
const nonce = crypto.randomBytes(16).toString('hex');
```

Embed in the CSP meta tag and on every `<script>` and `<style>` tag:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'nonce-{{nonce}}';
           style-src ${webview.cspSource} 'nonce-{{nonce}}';">
<link nonce="{{nonce}}" href="{{cssUri}}" rel="stylesheet">
<script nonce="{{nonce}}" src="{{scriptUri}}"></script>
```

The host replaces `{{nonce}}`, `{{cspSource}}`, `{{cssUri}}`, `{{scriptUri}}` via `String.replace()` before setting `webview.html`. Use exactly these placeholder strings — any other syntax will silently break CSP and asset loading.

### 9.2 Asset URIs

Convert all file paths to webview-safe URIs before injection:

```ts
const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.css'));
const jsUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.js'));
```

Never use raw `file://` paths in webview HTML.

### 9.3 `acquireVsCodeApi()` — one call only

```js
// CORRECT — at module top level, outside any function
const vscode = acquireVsCodeApi();
function post(msg) { vscode.postMessage(msg); }
```

Calling `acquireVsCodeApi()` more than once throws a runtime error in the webview context.

### 9.4 No inline event handlers

```html
<!-- WRONG — blocked by CSP nonce policy -->
<button onclick="doSomething()">Upload</button>

<!-- CORRECT -->
<button id="uploadBtn">Upload</button>
```
```js
// panel.js
document.getElementById('uploadBtn').addEventListener('click', () => { ... });
```

### 9.5 VS Code CSS variables only

```css
/* CORRECT */
body {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}
input { border: 1px solid var(--vscode-input-border); }

/* WRONG — hardcoded colours break theming */
body { background: #1e1e1e; color: #d4d4d4; }
```

Never use hex values, `rgb()`, `hsl()`, or named colour keywords (except `transparent` and `inherit`).

Required VS Code variables: `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-input-background`, `--vscode-input-border`, `--vscode-button-background`, `--vscode-button-foreground`, `--vscode-list-activeSelectionBackground`, `--vscode-font-family`, `--vscode-font-size`.

### 9.6 Single panel instance pattern

```ts
class MyPanel {
  static currentPanel: MyPanel | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri) {
    if (MyPanel.currentPanel) {
      MyPanel.currentPanel._panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('myPanel', 'My Panel', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    });
    MyPanel.currentPanel = new MyPanel(panel);
  }

  dispose() {
    MyPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
  }
}
```

- `retainContextWhenHidden: true` preserves JS state across tab switches (but not VS Code reloads).
- Use `getState()`/`setState()` webview API to persist critical state (last folder, last preset) to `globalState` for reload recovery.
- Post initial data messages (`presets`, `state`) immediately after setting `webview.html`, without waiting for webview requests.

---

## 10. Remote SSH / WSL / Dev Container Compatibility

When accessing the local filesystem, prefer `vscode.workspace.fs` over Node's `fs`:

```ts
// CORRECT — works in Remote SSH, WSL, Dev Containers
const entries = await vscode.workspace.fs.readDirectory(folderUri);

// WRONG in remote contexts — refers to the remote machine's FS
import * as fs from 'fs';
const entries = fs.readdirSync('/path');
```

**Exception:** If you need a real local writable temp path (e.g., for building a ZIP archive to upload via an npm library that requires real paths), use `os.tmpdir()`. The ZIP creation step is always local regardless of the remote connection.

---

## 11. `.vscodeignore`

Always add `.vscodeignore` to prevent shipping source and dev files in the VSIX:

```
src/
node_modules/
*.ts
*.map
tsconfig.json
esbuild.config.js
jest.config.js
.vscode-test.js
openspec/
docs/
spikes/
.git/
```

Check VSIX contents with `vsce ls` before publishing. Target size: under 50 MB for most extensions.

---

## 12. Publishing Advice

When Andrei asks about publishing:

- Assume manual publishing unless he explicitly asks for CI/CD.
- Steps to recommend:
  1. Ensure `publisher` is `am-vs-tools` and `version` is incremented in `package.json`.
  2. Ensure `icon.png` (128×128 PNG) exists at the repo root — `vsce package` fails without it.
  3. Run `npm run typecheck` — zero TypeScript errors before packaging.
  4. Run `vsce package` for local testing → install with `code --install-extension *.vsix`.
  5. Run `vsce publish` for release — requires a Personal Access Token from the VS Code Marketplace.
  6. Set `"vscode:prepublish": "npm run compile"` in scripts so `vsce package` always builds first.

Marketplace restrictions to mention if relevant:
- No SVG icons (must be PNG/JPG).
- External images in README must be HTTPS.
- Maximum 30 keywords.
- `publisher` must exist in the Marketplace (created via Azure DevOps) before `vsce publish`.

---

## 13. Parallel Subagent Build Pattern

For large extensions with independent modules, use a parallel subagent orchestration strategy:

1. **Author shared contracts first** (discriminated-union message types, shared data types, settings interface) in the main session. These become the read-only interfaces that all agents depend on.

2. **Dispatch parallel subagents** for independent leaf modules — those with no runtime dependency on each other. They only meet inside the integration layer.

3. **Gate phases** — Phase N+1 must not start until all Phase N agents are complete. The shared types file is read-only after the main session writes it.

4. **Reassemble in main session** — write the integration layer (`extension.ts`, `SftpPanel.ts`) that wires all modules together.

5. **Review checkpoints** between phases:
   - **After parallel phase:** Verify all module exports match the shared contract; no inline message shapes.
   - **After integration:** Verify routing exhaustiveness, disposable cleanup, singleton invariants.
   - **Final:** CSP audit, credential audit, `vsce package` clean run.

Leaf modules are parallel-eligible when their only shared surface is a read-only types file written before dispatch.

---

## 14. How to Use This Skill

A coding assistant should:

1. Invoke this skill whenever Andrei requests help with a VS Code extension.
2. Follow the workflow in section 2 for new extensions.
3. Use the conventions and rules here as defaults unless Andrei explicitly overrides them.
4. For large extensions with independent modules, apply the parallel subagent pattern in section 13.

This keeps all future extension projects consistent and aligned with Andrei's preferences.
