## Context

The extension is built from scratch, borrowing low-level utilities and bundled artifacts from `vasilcinandrei/xslt-transformer-vscode` (colleague) and stdin-piping patterns from `shoedler/vscode-xsl-transform`. The colleague's extension has working Saxon invocation, XSD validation, Schematron validation, SVRL parsing, UBL document detection, XSLT tracing scaffolding, and a full `src/ai/` folder — all usable with targeted bug fixes. The primary problems to solve are UX (no context-aware file picking, no recent files), architecture (duplicated pipeline, module-level mutable state, no cancellation), and packaging (no bundler, always-on activation).

Implementation is carried out via parallel subagents coordinated by a main orchestrator session. Each subagent owns one module group and writes its files independently. The main session handles project scaffold, integration (`extension.ts`, `package.json`), and final packaging.

## Goals / Non-Goals

**Goals:**
- Zero runtime npm dependencies (Node built-ins + `vscode` API only)
- Pure pipeline layer: no VS Code imports below `src/commands/` — everything in `src/pipeline/`, `src/validation/`, `src/utils/` is testable with Jest without a VS Code host
- Single bundled output via esbuild — fast cold start, small VSIX
- Scoped activation: `onLanguage:xml`, `onLanguage:xsl` only
- Two-target error tracing: diagnostics on output XML + Related Information to XSLT source line
- Cancellation propagated through the full pipeline to Java process

**Non-Goals:**
- Input XML tracing (which source data node produced the failing output node) — explicitly out of scope
- XSLT 3.0 streaming or schema-aware transformation (Saxon HE, not PE/EE)
- Bundling a JRE — Java in PATH is the only system requirement
- Offline Schematron rule updates — bundled artifacts are fixed at build time
- Telemetry of any kind

## Decisions

---

### D1: Pure pipeline — no VS Code imports below the command layer

**Decision:** `src/pipeline/`, `src/validation/`, `src/utils/`, `src/tracing/` import nothing from `vscode`. VS Code types (`Uri`, `DiagnosticSeverity`, etc.) that are needed for output are mirrored as plain enums/values in `src/validation/types.ts`. The single VS Code boundary is `src/validation/diagnosticsReporter.ts`, which converts internal types to `vscode.Diagnostic`.

**Why over the alternative (VS Code-coupled modules like the colleague's code):** The pipeline becomes testable with Jest without the `@vscode/test-electron` harness. Progress reporting is an injected `onProgress` callback, not a call to `vscode.window.withProgress`. Cancellation is an injected `CancellationToken` interface, not a VS Code-specific type.

**Trade-off:** Requires maintaining a thin internal `ValidationIssue` type that mirrors `vscode.DiagnosticSeverity`. Acceptable — it's 20 lines.

---

### D2: esbuild as bundler, single entry point

**Decision:** `esbuild.config.js` bundles `src/extension.ts` into `dist/extension.js` with `external: ['vscode']`. Source maps emitted alongside for debugging. Build scripts: `npm run build` (production) and `npm run watch` (incremental).

**Why over webpack:** Zero config overhead, 10× faster builds, no loader ecosystem needed. Why over no bundler: activation time difference is measurable on slower machines; also allows tree-shaking unused code paths.

---

### D3: Saxon invoked via stdin pipe, not temp file

**Decision:** XML content (including unsaved buffer text) is passed to Saxon via `java -jar saxon.jar -s:- -xsl:{path}` where `-s:-` means read source from stdin. The Node `child_process.spawn` `stdin.write` / `stdin.end` pattern is used (borrowed from `shoedler/vscode-xsl-transform`).

**Why over writing to a temp file first:** Handles unsaved editor buffers correctly without a temp file lifecycle. Eliminates a class of race conditions (temp file not flushed before Java reads it). Simpler cancellation — kill the child process, no temp file to clean up.

**Constraint:** `-s:-` only works when Saxon can determine the base URI from the XSLT path (`-xsl:{absolute_path}`). Always pass an absolute XSLT path.

---

### D4: Saxon `-T` flag for XSLT tracing (primary), comment injection (fallback)

**Decision:** `src/tracing/saxonTracer.ts` runs Saxon with `-T -traceout:{tempFile}` and parses the trace output to build a `Map<number, vscode.Location>` from output line → XSLT source location. The colleague's comment-injection approach (`src/tracing/xsltTracer.ts`) is retained as a fallback for stylesheets where `-T` produces no usable mapping (e.g., very short outputs where line numbers collapse).

**Why `-T` over comment injection as primary:** Comment injection requires preprocessing the XSLT (risky for complex stylesheets), is regex-based (fragile), and fails on multi-line generated elements. Saxon's trace is authoritative.

**Saxon `-T` output format** (to be verified against Saxon 10.9):
```
T: match="Invoice" mode="" line=45 module=file:///path/to/style.xsl
```
`saxonTracer.ts` parses `line=N module=file:///...` entries and correlates them with the output line being produced at that point in the trace stream.

**Trade-off:** `-T` adds ~15–30% overhead to transform time. Gated behind `xmlXslt.transform.enableTracing` (default: true). Users with large transforms can disable it.

---

### D5: Diagnostics written against the output document URI

**Decision:** After a transform completes, the extension retains the `vscode.Uri` of the output document (untitled or saved). The `diagnosticsReporter.ts` creates a `vscode.DiagnosticCollection` keyed to that URI, so clicking an error in the Problems panel jumps to the failing line in the output XML tab.

**How for untitled documents:** `vscode.workspace.openTextDocument({ content, language })` returns a `TextDocument` whose `.uri` uses the `untitled:` scheme (e.g. `untitled:Untitled-1`). Diagnostics can be attached to it with the standard `DiagnosticCollection.set(uri, diagnostics)` API and will appear in the Problems panel. Confirmed against VS Code API docs — `vscode-userdata:` is NOT the scheme used here.

**Two collections:** `xmlXslt.local` and `xmlXslt.helger` — separate so local and remote results can be cleared independently (e.g., re-running local without re-calling Helger).

---

### D6: Zero runtime npm dependencies

**Decision:** The Helger SOAP call uses Node's built-in `https` module with a hand-built SOAP envelope string. No `soap`, `axios`, or `node-fetch` packages.

**Why:** Keeps the VSIX small, eliminates supply chain risk, and keeps the `node_modules` audit surface to dev-only tools. The Helger request is a single POST with a fixed envelope shape — a full SOAP client library is significant overkill.

**Risk:** If Helger changes their WSDL, the envelope template needs manual updating. Mitigated by the `helgerEndpoint` setting (user can point at a compatible service) and the fact that Helger phive's public API is stable.

---

### D7: `lastTransform` state — module-level, not persisted

**Decision:** The last-used XML path, XSLT path, and output document URI are stored as module-level variables in `src/commands/transformCommand.ts`. They are NOT persisted to `globalState`.

**Why not persisted:** Stale paths from a previous session cause confusing "file not found" errors when the user clicks the status bar to re-run. Starting fresh each session is safer UX.

**Why module-level (not a class):** The extension has one instance per VS Code window. Module-level state is equivalent to a singleton. A class would add ceremony without benefit.

---

### D8: DiagnosticRelatedInformation for XSLT source link

**Decision:** Each `vscode.Diagnostic` on the output document gets a `relatedInformation` array entry pointing to the XSLT file URI + line number from the Saxon trace map. This follows the same pattern TypeScript uses for "error defined at X" links.

**Lookup:** `traceMap.get(outputLine)` → `vscode.Location(xsltUri, xsltLine)`. If no mapping exists for an output line (trace didn't cover it), the diagnostic is created without relatedInformation — not an error condition.

---

### D9: Subagent orchestration strategy

The implementation uses parallel subagents across five phases. The **main session is the orchestrator** — it runs the scaffold, dispatches parallel agent groups, and handles integration and packaging. Each subagent owns one module group and writes its files to the extension directory.

**Phase 1 — Foundation (main session, sequential):**
- Scaffold `xml-xslt-studio/` folder structure, `package.json` skeleton, `tsconfig.json`, `esbuild.config.js`
- Clone both reference repos into `vs-code-extensions/xml-xslt/`
- Copy borrowed files: `lib/`, `java/`, `validation-artifacts/`, and all borrowed `src/` files
- Apply known bug fixes to `xsdValidator.ts` (capture stdout on failure) and rename `parseXmllintErrors` → `parseValidationErrors`

**Phase 2 — Core modules (3 parallel subagents):**
- **Agent A**: `src/config/settings.ts` (typed config wrapper) + `src/validation/types.ts` (internal types, no vscode imports)
- **Agent B**: Verify and lightly adapt `src/utils/execAsync.ts`, `src/utils/tempFile.ts`, `src/utils/javaRunner.ts`
- **Agent C**: `src/ui/filePicker.ts` (QuickPick with Recent/Tabs/Browse + PI detection) + `src/ui/recentFiles.ts` (MRU manager)

**Phase 3 — Validation + pipeline (4 parallel subagents, after Phase 2):**
- **Agent D**: Finalize `src/validation/` (all borrowed + fixed files): xsdValidator, schematronValidator, svrlParser, documentDetector, diagnosticsReporter
- **Agent E**: `src/validation/helgerValidator.ts` (new — SOAP envelope builder, https POST, response parser, VESID map)
- **Agent F**: `src/tracing/saxonTracer.ts` (new — Saxon `-T` trace parser + Map builder) + adapt `src/tracing/xsltTracer.ts` (fallback) + `src/tracing/errorTraceMapper.ts`
- **Agent G**: `src/pipeline/transformAndValidate.ts` (orchestrates transform → detect UBL → validate local → validate Helger → build trace map)

**Phase 4 — Commands (5 parallel subagents, after Phase 3):**
- **Agent H**: `src/commands/transformCommand.ts` (context-aware dispatch, PI detection call, parameter prompt, output handling, status bar update)
- **Agent I**: `src/commands/validateCommand.ts` (standalone validate command + sub-commands for XSD-only and business-rules-only)
- **Agent J**: `src/commands/scenarioCommand.ts` (CRUD for `.vscode/xslt-scenarios.json`, variable substitution, QuickPick runner)
- **Agent K**: `src/commands/watchCommand.ts` (onDidSaveTextDocument listener, status bar toggle)
- **Agent L**: `src/commands/aiCommands.ts` + adapt `src/ai/` folder (change default provider to Anthropic, add Vertex AI support)

**Phase 5 — Integration + packaging (main session, sequential):**
- `src/extension.ts` — registers all commands, DiagnosticCollections, status bar item, AI code action provider
- `package.json` — complete manifest: all commands, settings, keybindings, menus (editor title bar buttons), activationEvents
- `README.md`, `CHANGELOG.md`, `LICENSE`, `.vscodeignore`
- `vsce package` to verify the VSIX builds cleanly

**Subagent context requirements:** Each subagent receives the full spec for its capability plus the relevant interfaces from `types.ts` and `settings.ts`. Subagents in Phase 3+ also receive the `javaRunner.ts` signature. No subagent modifies files owned by another.

---

### D10: `package.json` activation and menu contributions

**Activation:** `onLanguage:xml` and `onLanguage:xsl` — extension activates only when the user opens an XML or XSLT file. Not `onStartupFinished` (colleague's choice) which activates on every workspace.

**Editor title bar buttons:** Declared as `menus["editor/title"]` contributions with `when` clauses:
```json
"when": "resourceExtname == .xml || resourceExtname == .xsl || resourceExtname == .xslt"
```
Both Transform (⚡) and Validate (✓) buttons appear only when a relevant file is active.

**Keyboard shortcuts:** `Ctrl+Shift+T` / `Cmd+Shift+T` for transform, `Ctrl+Shift+V` / `Cmd+Shift+V` for validate. These override default VS Code bindings only when an XML/XSLT file is focused.

## Risks / Trade-offs

- **[Risk] Saxon `-T` trace format is undocumented / version-specific** → Mitigation: pin to Saxon HE 10.9 (bundled). If the format changes in a future version the user brings their own JAR, saxonTracer.ts needs updating. Document this in CHANGELOG when bumping the JAR.

- **[Risk] Helger phive WS2 SOAP envelope format needs verification against live WSDL** → Mitigation: `helgerValidator.ts` includes a comment pointing to `https://peppol.helger.com/wsdvs?wsdl`. The first integration test must make a real call; mock tests alone are insufficient here.

- **[Risk] Untitled document URI scheme for diagnostics** → The `vscode-userdata:` URI returned for untitled docs may not be stable across VS Code versions. Mitigation: test on VS Code 1.85 and latest stable. If unstable, fall back to reporting diagnostics without a URI (shown as workspace-level warnings).

- **[Risk] `Ctrl+Shift+T` conflicts with "Reopen Closed Tab" in some terminals** → Mitigation: only active when `editorLangId == xml || editorLangId == xsl`. The when clause prevents the conflict in terminal context.

- **[Risk] Subagent file conflicts** → Each subagent writes to a non-overlapping set of files. The only shared surface is `types.ts` and `settings.ts` (written in Phase 2, read-only in Phase 3+). Mitigation: Phase 2 must fully complete before Phase 3 agents are dispatched.

### D11: Vertex AI Claude — ADC without npm packages

**Decision:** The `anthropic-vertex` provider authenticates using GCP Application Default Credentials (ADC) with zero npm packages. The implementation:

1. Reads the ADC file path from `process.env.GOOGLE_APPLICATION_CREDENTIALS` if set (user-specific override), falling back to the platform default (`%APPDATA%\gcloud\application_default_credentials.json` on Windows, `~/.config/gcloud/application_default_credentials.json` on Mac/Linux).
2. Parses the ADC JSON. If `type == "authorized_user"` (the common case after `gcloud auth application-default login`): POST to `https://oauth2.googleapis.com/token` with `{ grant_type: "refresh_token", client_id, client_secret, refresh_token }` using Node's built-in `https` to exchange for a bearer token.
3. If `type == "service_account"` or the token refresh fails: shell out to `gcloud auth print-access-token` as fallback.
4. Calls the Vertex AI endpoint: `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/anthropic/models/{model}:rawPredict` with `Authorization: Bearer {token}`.

**Why over `google-auth-library`:** Keeps D6 (zero runtime npm dependencies). The `authorized_user` ADC format is standard JSON and its token refresh is a single HTTPS POST — no library needed. The `GOOGLE_APPLICATION_CREDENTIALS` env var is the GCP-standard override path; users with non-default ADC locations set this in their system environment.

**Constraint:** The user running the extension must have run `gcloud auth application-default login` at least once (or have a service account key) to populate the ADC file.

---

### D12: Multi-VESID detection and resolution for Helger validation

**Decision:** `helgerValidator.ts` auto-detects which VESID to use by reading `<cbc:CustomizationID>` from the XML content, then cross-referencing a built-in `VESID_CATALOG`. If detection succeeds and a single VESID matches, validation proceeds silently. If no match is found, a `showWarningMessage` informs the user and a `showQuickPick` offers the full catalog filtered by doc type, plus a "Custom VESID..." option that falls through to `showInputBox`.

**VESID catalog (initial — extend as new BIS versions publish):**

| CustomizationID contains | Doc type | VESID |
|---|---|---|
| `peppol.eu:2017:poacc:billing:3.0` | Invoice | `eu.peppol.bis3:invoice:{version}` |
| `peppol.eu:2017:poacc:billing:3.0` | CreditNote | `eu.peppol.bis3:creditnote:{version}` |

Where `{version}` is resolved from the `xmlXslt.validation.helgerVesidVersion` setting (`"latest"` resolves to `"2025.11.0"`; `"previous"` resolves to `"2025.5.0"`; any explicit version string like `"2025.11.0"` is used as-is).

**New config setting:** `xmlXslt.validation.helgerVesidVersion` (string, default `"latest"`) — allows pinning to a previous version for regression testing. Enum values shown in settings UI: `"latest"`, `"previous"`, or free-form string for custom VESIDs.

**Detection implementation:**
```typescript
function detectCustomizationId(xmlContent: string): string | undefined {
    const m = xmlContent.match(/<(?:\w+:)?CustomizationID[^>]*>([^<]+)/);
    return m?.[1].trim();
}
function resolveVesidFromProfile(customId: string, docType: string, versionKey: string): string | undefined {
    const version = versionKey === 'latest' ? '2025.11.0'
                  : versionKey === 'previous' ? '2025.5.0'
                  : versionKey;
    if (customId.includes('peppol.eu:2017:poacc:billing:3.0')) {
        if (docType === 'Invoice')    return `eu.peppol.bis3:invoice:${version}`;
        if (docType === 'CreditNote') return `eu.peppol.bis3:creditnote:${version}`;
    }
    return undefined;
}
```

**QuickPick fallback (when auto-detect fails):**
```typescript
// Show warning, then offer picker
await vscode.window.showWarningMessage(
    `No recognized Peppol profile in CustomizationID. Select a validation ruleset.`
);
const choice = await vscode.window.showQuickPick([
    { label: 'Peppol BIS 3.0 Invoice (2025.11.0 — current)',    description: 'eu.peppol.bis3:invoice:2025.11.0',    docTypes: ['Invoice'] },
    { label: 'Peppol BIS 3.0 Credit Note (2025.11.0 — current)', description: 'eu.peppol.bis3:creditnote:2025.11.0', docTypes: ['CreditNote'] },
    { label: 'Peppol BIS 3.0 Invoice (2025.5.0 — previous)',    description: 'eu.peppol.bis3:invoice:2025.5.0',    docTypes: ['Invoice'] },
    { label: 'Peppol BIS 3.0 Credit Note (2025.5.0 — previous)', description: 'eu.peppol.bis3:creditnote:2025.5.0', docTypes: ['CreditNote'] },
    { label: 'Custom VESID...', description: 'Enter a VESID manually' },
].filter(item => !item.docTypes || item.docTypes.includes(docInfo.docType ?? '')),
    { title: 'Select Helger Validation Profile', placeHolder: 'Could not infer from document' }
);
if (!choice) return []; // user cancelled
const vesid = choice.label === 'Custom VESID...'
    ? await vscode.window.showInputBox({ prompt: 'Enter VESID', placeHolder: 'eu.peppol.bis3:invoice:2025.11.0' })
    : choice.description;
if (!vesid) return []; // user cancelled custom input
```

**Why this approach over a single hardcoded VESID:** Peppol publishes new BIS versions roughly every 6 months. Each new version supersedes the previous one with a mandatory transition date. Hardcoding a single VESID means the extension silently sends wrong-version validation requests (which currently returns HTTP 500 or stale results) until the next extension release. The catalog + setting approach lets users pin to a previous version during grace periods and let the extension auto-track `"latest"` otherwise.

**Trade-off:** The catalog requires manual maintenance when Peppol publishes a new BIS version. Mitigated by: (1) the catalog is a small constant in one file; (2) the `helgerVesidVersion` setting lets users unblock themselves without waiting for an extension release.

---

## Open Questions

- **Helger VESID version strings**: The VESID map in `helgerValidator.ts` uses version `3.15.0` — verify current Peppol BIS 3.0 version against the live Helger service before first publish.
- **Saxon `-T` trace output format**: Needs empirical verification with Saxon HE 10.9. Run a test transform with `-T -traceout:trace.txt` and inspect the format before implementing the parser.
- **AI code action provider registration**: The colleague's `aiCodeActionProvider.ts` registers as a `CodeActionsProvider` for all documents. Scope this to XML only via `documentSelector`.
