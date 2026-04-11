## 0. Pre-flight Verification (2 Parallel Agents — Background)

> **Orchestrator note**: Dispatch both agents immediately before starting Phase 1.
> Read `preflight-findings.md` before Phase 3 starts — findings directly affect
> helgerValidator.ts (task 3.7), saxonTracer.ts (task 3.9), and filePicker.ts (task 2.7).

- [x] 0.1 **[Research Agent]** ~~Fetch and analyse~~ **COMPLETE — all findings in `vs-code-extensions/xml-xslt/preflight-findings.md`.** Key results:
  - Helger WSDL confirmed: operation `validate`, SOAPAction `"validate"`, request element `validateRequestInput` with attrs `VESID` + `displayLocale` and child `<ns:XML>` (escaped text); errors are attrs on `<Item>`: `errorLevel`, `errorID`, `errorText`, `errorFieldName`, `errorLocation`, `test`
  - VESID format corrected: use `eu.peppol.bis3:invoice:2025.11.0` / `eu.peppol.bis3:creditnote:2025.11.0` — the old `urn:fdc:peppol.eu:...` format returns HTTP 500
  - Untitled doc URI scheme is `untitled:` (not `vscode-userdata:`); DiagnosticCollection.set() works
  - VS Code auto-hides orphaned separators — no manual items-rebuild needed
  - GCP token refresh: `application/x-www-form-urlencoded` body, fields confirmed
  - Vertex AI: URL confirmed; `anthropic_version` goes in body (underscore, not header); `model` in URL not body

- [x] 0.2 **[Local Inspection Agent]** ~~Check the following locally~~ **PARTIALLY COMPLETE — findings in `vs-code-extensions/xml-xslt/preflight-findings.md`.** Key results:
  - Colleague repo: not yet cloned (deferred to Phase 1 task 1.2); function signatures to be read post-clone
  - Saxon JAR: not yet present (deferred to Phase 1 task 1.4); trace format test to be run post-copy
  - Java process kill: `spawn('java', args, { shell: false })` + `.kill()` terminates JVM immediately on Windows via TerminateProcess — reliable; `shell: true` leaves JVM as orphan — **always use `shell: false`**
  - Test fixtures moved to `vs-code-extensions/xml-xslt/test-fixtures/` (real Peppol BIS 3.0 CreditNotes + SVRL outputs + invalid invoice XMLs)

## 1. Foundation — Main Session (Sequential)

- [ ] 1.1 Create `vs-code-extensions/xml-xslt/xml-xslt-studio/` folder and run `npm init -y`
- [ ] 1.2 Clone `vasilcinandrei/xslt-transformer-vscode` into `vs-code-extensions/xml-xslt/xslt-transformer-vscode/`
- [ ] 1.3 Clone `shoedler/vscode-xsl-transform` into `vs-code-extensions/xml-xslt/vscode-xsl-transform/`
- [ ] 1.4 Copy `lib/saxon-he-10.9.jar`, `lib/classes/XsdValidator.class`, `java/XsdValidator.java` from colleague repo
- [ ] 1.5 Copy `validation-artifacts/` directory (UBL XSD schemas + compiled Schematron XSLTs) from colleague repo
- [ ] 1.6 Copy borrowed `src/` files from colleague repo: `execAsync.ts`, `tempFile.ts`, `javaRunner.ts`, `xsdValidator.ts`, `schematronValidator.ts`, `svrlParser.ts`, `documentDetector.ts`, `diagnosticsReporter.ts`, `xsltTracer.ts`, `errorTraceMapper.ts`, and the entire `src/ai/` folder
- [ ] 1.7 Apply bug fix to `xsdValidator.ts`: capture validation errors from stdout (not only stderr) so errors are not silently dropped on non-zero exit
- [ ] 1.8 Rename `parseXmllintErrors` → `parseValidationErrors` in `diagnosticsReporter.ts` and update all callers
- [ ] 1.9 Create `src/` directory tree: `commands/`, `ui/`, `pipeline/`, `validation/`, `tracing/`, `ai/`, `config/`, `utils/`, `state/`
- [ ] 1.10 Write `tsconfig.json` (`target: ES2020`, `module: commonjs`, `strict: true`, `outDir: dist/`)
- [ ] 1.11 Write `esbuild.config.js` (entry: `src/extension.ts`, outfile: `dist/extension.js`, platform: node, external: vscode, sourcemap: true)
- [ ] 1.12 Write `package.json` skeleton: `name`, `version: 0.1.0`, `engines.vscode: ^1.85.0`, `main: dist/extension.js`, `activationEvents: [onLanguage:xml, onLanguage:xsl]`, `categories`, `keywords`, `scripts: { build, watch, package, test }`
- [ ] 1.13 Install dev dependencies: `typescript`, `esbuild`, `@types/vscode@^1.85.0`, `@vscode/vsce`, `jest`, `ts-jest`, `@types/jest`
- [ ] 1.14 Verify `npm run build` compiles a minimal `src/extension.ts` stub without errors

## 2. Phase 2 — Core Modules (Dispatch 3 Parallel Subagents)

> **Orchestrator note**: Dispatch Agents A, B, C simultaneously. All are independent.
> Phase 3 MUST NOT start until all three agents below are complete.

- [ ] 2.1 **[Agent A]** Write `src/validation/types.ts`: define and export `IssueSeverity` enum (`Error = 0, Warning = 1, Information = 2`) mirroring `vscode.DiagnosticSeverity` numeric values so `diagnosticsReporter.ts` can cast directly; define `ValidationIssue` (severity: IssueSeverity, message, ruleId?, line, column, source: 'local-xsd'|'local-schematron'|'helger'), `UblDocumentInfo` (rootElement, namespace, docType, xsdPath), `SchematronRuleset` enum — zero `vscode` imports
- [ ] 2.2 **[Agent A]** Write `src/config/settings.ts`: `XmlXsltConfig` interface + `getConfig()` typed wrapper over `vscode.workspace.getConfiguration('xmlXslt')` covering all 15 settings, including `xmlXslt.validation.helgerVesidVersion` (string, default `"latest"` — resolves to `"2025.11.0"`; `"previous"` resolves to `"2025.5.0"`; explicit version string used as-is)
- [ ] 2.3 **[Agent B]** Verify `src/utils/execAsync.ts` compiles: exports `execFileAsync(cmd, args, options)` returning `Promise<{stdout, stderr}>`
- [ ] 2.4 **[Agent B]** Verify `src/utils/tempFile.ts` compiles: exports `makeTempFilePath(suffix)` using `os.tmpdir()` + `crypto.randomUUID()`
- [ ] 2.5 **[Agent B]** Adapt `src/utils/javaRunner.ts`: add `enableTracing: boolean` and `traceoutPath?: string` parameters to `runSaxonTransform`; pass `-T -traceout:{path}` to Saxon args when tracing is enabled
- [ ] 2.6 **[Agent C]** Write `src/ui/recentFiles.ts`: `RecentFilesManager` class with `getAll()` (filters non-existent paths via `fs.existsSync`), `push(fsPath)` (deduplicates, caps at maxCount), keyed per file type in `globalState`
- [ ] 2.7 **[Agent C]** Write `src/ui/filePicker.ts`: `pickFile(fileType, context, preselectedPath?)` returning `FilePickResult | undefined`; use `vscode.window.createQuickPick()`; open tabs read from `vscode.window.tabGroups.all`; Browse button via `onDidTriggerButton`; **PI pre-selection**: set `qp.activeItems = [matchingItem]` AFTER assigning `qp.items` — do NOT use `picked: true` on items, it has no effect on `createQuickPick()`; **separator hiding**: VS Code **automatically hides orphaned separators** when the user types a filter — no `onDidChangeValue` items-rebuild is needed (confirmed against VS Code `quickInputList.ts` source); keep `qp.sortByLabel` at its default `false`, otherwise separators are suppressed entirely during filtering

## 3. Phase 3 — Validation + Pipeline (Dispatch 4 Parallel Subagents)

> **Orchestrator note**: Dispatch Agents D, E, F, G simultaneously after Phase 2 is complete.
> Read preflight-findings.md before dispatching — findings directly inform Agents E (Helger format)
> and F (Saxon trace format). After all 4 agents complete, main session writes task 3.13 before Phase 4.

- [ ] 3.1 **[Agent D]** Verify `src/validation/xsdValidator.ts` compiles with the stdout-capture bug fix and exports `validateXsd(xmlContent: string, docInfo: UblDocumentInfo, artifactsPath: string, extensionPath: string): Promise<ValidationIssue[]>`
- [ ] 3.2 **[Agent D]** Verify `src/validation/schematronValidator.ts` exports `validateSchematron(xmlContent: string, rulesets: SchematronRuleset[], artifactsPath: string, extensionPath: string): Promise<ValidationIssue[]>`
- [ ] 3.3 **[Agent D]** Update `src/validation/svrlParser.ts` to map SVRL `flag="error"` → `IssueSeverity.Error` and `flag="warning"` → `IssueSeverity.Warning` using the internal `IssueSeverity` enum from `types.ts` (NOT `vscode.DiagnosticSeverity` — no vscode import allowed here)
- [ ] 3.4 **[Agent D]** Verify `src/validation/documentDetector.ts` covers all UBL 2.1 maindoc types (at minimum: Invoice, CreditNote, Order, OrderResponse, DespatchAdvice, Catalogue, Statement)
- [ ] 3.5 **[Agent D]** Rewrite `src/validation/diagnosticsReporter.ts` with this explicit signature: `reportDiagnostics(local: vscode.DiagnosticCollection, helger: vscode.DiagnosticCollection, outputUri: vscode.Uri, issues: ValidationIssue[], traceMap: Map<number, vscode.Location>): void`; clear both collections for `outputUri` first; route `source === 'helger'` issues to helger collection, all others to local; cast `IssueSeverity` → `vscode.DiagnosticSeverity` directly (numeric values are identical); call `errorTraceMapper.attachRelatedInfo(diagnostic, issue.line, traceMap)` for each diagnostic; if `outputUri` scheme is not `file:` or `untitled:`, fall back to using `vscode.Uri.parse('xml-xslt-output://result')` as a stable fallback URI
- [x] 3.6 **[Agent E]** ~~fetch WSDL~~ **COMPLETE via preflight** — SOAP format fully documented in `preflight-findings.md` Section 1, live test passed. Write the WSDL-verified comment block from preflight-findings.md Section 1 at the top of `helgerValidator.ts` as the spec header, then implement task 3.7.
- [ ] 3.7 **[Agent E]** Write `src/validation/helgerValidator.ts` using confirmed SOAP format from preflight-findings.md. Implementation requirements:

  **VESID catalog** (constant, extend when Peppol publishes new versions):
  ```typescript
  const VESID_CATALOG = [
    { label: 'Peppol BIS 3.0 Invoice (2025.11.0 — current)',      vesid: 'eu.peppol.bis3:invoice:2025.11.0',      docTypes: ['Invoice'] },
    { label: 'Peppol BIS 3.0 Credit Note (2025.11.0 — current)',  vesid: 'eu.peppol.bis3:creditnote:2025.11.0',   docTypes: ['CreditNote'] },
    { label: 'Peppol BIS 3.0 Invoice (2025.5.0 — previous)',      vesid: 'eu.peppol.bis3:invoice:2025.5.0',       docTypes: ['Invoice'] },
    { label: 'Peppol BIS 3.0 Credit Note (2025.5.0 — previous)',  vesid: 'eu.peppol.bis3:creditnote:2025.5.0',    docTypes: ['CreditNote'] },
  ] as const;
  ```

  **VESID detection** — `detectCustomizationId(xmlContent: string): string | undefined`: regex-extract the text content of `<cbc:CustomizationID>` (or any prefix variant). Then `resolveVesidFromProfile(customId, docType, versionKey)` where `versionKey` comes from `config.helgerVesidVersion` (`"latest"` → `"2025.11.0"`, `"previous"` → `"2025.5.0"`, explicit string used as-is). Match `customId.includes('peppol.eu:2017:poacc:billing:3.0')` for Peppol BIS 3.0.

  **QuickPick fallback** — when auto-detect fails (unknown CustomizationID or no CustomizationID present): (1) `vscode.window.showWarningMessage('Could not detect Peppol profile from CustomizationID — select a validation ruleset.')`, (2) `vscode.window.showQuickPick(catalog filtered by docInfo.docType, plus a "Custom VESID..." item at the end)`, (3) if "Custom VESID..." selected: `vscode.window.showInputBox({ prompt: 'Enter VESID', placeHolder: 'eu.peppol.bis3:invoice:2025.11.0' })`; (4) if user cancels at any point: return `[]` (no validation).

  **SOAP functions** (no vscode imports except via the fallback path above):
  - `buildSoapEnvelope(xmlContent: string, vesid: string): string` — use confirmed template from preflight-findings.md Section 1; XML content goes as escaped text inside `<ns:XML>`
  - `postSoap(endpoint: string, body: string, timeout: number): Promise<string>` — Node `https` POST, Content-Type `text/xml; charset=UTF-8`, SOAPAction `"validate"`, throws on non-200 or SOAP Fault
  - `parseSoapResponse(xml: string): ValidationIssue[]` — parse `<Item>` attrs: `errorLevel` (`"ERROR"` → `IssueSeverity.Error`, `"WARN"` → `IssueSeverity.Warning`), `errorID` → `ruleId`, `errorText` → `message`, `errorFieldName` → `line`/`column` (best-effort parse), source `'helger'`
  - `validateHelger(xmlContent: string, docInfo: UblDocumentInfo, config: XmlXsltConfig): Promise<ValidationIssue[]>` — orchestrates: detect VESID (with QuickPick fallback), build envelope, POST, parse response; note: this function calls VS Code UI APIs (QuickPick, InputBox) so it DOES import vscode; the SOAP/parse functions below it do not
- [ ] 3.8 **[Agent F]** Using Saxon trace format from preflight-findings.md: if empirical trace was captured, document the exact line format in a comment at the top of `saxonTracer.ts`; if not, run `java -jar lib/saxon-he-10.9.jar -s:- -xsl:{trivial.xsl} -T -traceout:trace.txt` with a local sample and read the output
- [ ] 3.9 **[Agent F]** Write `src/tracing/saxonTracer.ts`: `parseSaxonTrace(traceFilePath: string): Map<number, vscode.Location>` using the verified trace format from 3.8; return empty Map on any file-not-found, parse error, or empty result — never throw
- [ ] 3.10 **[Agent F]** Adapt `src/tracing/xsltTracer.ts` (fallback): add guard at entry that returns empty result when XSLT output method is `text` or when `enableTracing` is false
- [ ] 3.11 **[Agent F]** Verify `src/tracing/errorTraceMapper.ts` exports `attachRelatedInfo(diagnostic: vscode.Diagnostic, outputLine: number, traceMap: Map<number, vscode.Location>): void`; mutates `diagnostic.relatedInformation` by appending a `DiagnosticRelatedInformation` entry if `traceMap.get(outputLine)` returns a location; message: "Generated by XSLT template at this location"; no-op if key missing
- [ ] 3.12 **[Agent G]** Write `src/pipeline/transformAndValidate.ts`: `runPipeline(opts: PipelineOptions): Promise<PipelineResult>`; sequential steps: (1) Saxon via javaRunner → output string + trace file path, (2) detect UBL doc type via documentDetector, (3) if UBL + autoValidate: run xsdValidator + schematronValidator, (4) if helger enabled: run helgerValidator wrapped in try/catch — on failure emit a status bar warning event via onProgress, (5) parse Saxon trace → traceMap, (6) return `{ output, outputLanguage, isUbl, documentInfo, issues, traceMap }`; no vscode imports except CancellationToken (type only)
- [ ] 3.13 **[Main Session — sequential gate before Phase 4]** Write `src/state/lastTransform.ts`: export `interface LastTransformState { xmlPath: string; xmlContent: string; xsltPath: string; parameters: Record<string, string>; outputUri?: vscode.Uri; outputDestination: 'newTab' | 'saveFile' }` and `getLastTransform(): LastTransformState | undefined` and `setLastTransform(state: LastTransformState): void` backed by a single module-level variable; this is the single source of truth — transformCommand writes it, watchCommand and scenarioCommand read it

## 4. Phase 4 — Commands (Dispatch 5 Parallel Subagents)

> **Orchestrator note**: Dispatch Agents H, I, J, K, L simultaneously after Phase 3 INCLUDING task 3.13.
> Agents J and K import `getLastTransform` from `src/state/lastTransform.ts`.
> Agent H imports `setLastTransform`. No agent modifies files owned by another.

- [ ] 4.1 **[Agent H]** Write `src/commands/transformCommand.ts`: infer file type from active editor extension; if XML active, scan buffer text for `<?xml-stylesheet ... href="...">` PI, resolve href to absolute path via `path.resolve(path.dirname(xmlPath), href)`, pass as `preselectedPath` to `pickFile('xslt', context, resolvedHref)`; call `pickFile()` for the missing file; call `promptForParameters(xsltPath)` (regex scan for `<xsl:param name="...">`, `showInputBox` per param); call `runPipeline()` inside `withProgress` with cancellation token; on success: `const doc = await vscode.workspace.openTextDocument({ content: result.output, language: result.outputLanguage })`, capture `doc.uri` as `outputUri`; call `reportDiagnostics(local, helger, outputUri, result.issues, result.traceMap)`; update status bar; call `setLastTransform({ xmlPath, xmlContent, xsltPath, parameters, outputUri, outputDestination })`
- [ ] 4.2 **[Agent I]** Write `src/commands/validateCommand.ts`: `validateDocument` (runs local XSD + both Schematron rulesets + Helger if enabled on the active editor file); `validateXsdOnly`; `validateBusinessRulesOnly` — all detect UBL type first via documentDetector, show info message if not UBL; use the active editor's `document.uri` as the output URI; clear DiagnosticCollection before each run
- [ ] 4.3 **[Agent J]** Write `src/commands/scenarioCommand.ts`: `runScenario` (read `.vscode/xslt-scenarios.json`, QuickPick list, resolve variables, call pipeline); `saveScenario` (call `getLastTransform()`, `showInputBox` for name, append to or create JSON file); `manageScenarios` (create `{ "scenarios": [] }` skeleton if absent, open in editor); `resolveVariables(p: string, workspaceFolder: string, fileDir: string): string` replaces `${workspaceFolder}` and `${fileDir}`
- [ ] 4.4 **[Agent K]** Write `src/commands/watchCommand.ts`: `toggleWatch()` command; register `vscode.workspace.onDidSaveTextDocument` listener on activation (always registered, gated internally by `isWatchEnabled` flag); listener calls `getLastTransform()` — if saved file path matches `xmlPath` or `xsltPath` and watch is ON: re-call pipeline silently with full stored state; status bar item toggling between `$(eye) Watch: ON` and `$(eye-closed) Watch: OFF`; clicking status bar item calls `toggleWatch()`
- [ ] 4.5 **[Agent L]** Adapt `src/ai/llmClient.ts`: change default provider from Gemini to `anthropic`; add `anthropic-vertex` branch with exact implementation per preflight-findings.md Sections 5–6:
  - (1) Read ADC path from `process.env.GOOGLE_APPLICATION_CREDENTIALS` or platform default (`%APPDATA%\gcloud\application_default_credentials.json` on Windows, `~/.config/gcloud/application_default_credentials.json` on Mac/Linux)
  - (2) Parse ADC JSON. If `type === 'authorized_user'`: POST to `https://oauth2.googleapis.com/token` with **`Content-Type: application/x-www-form-urlencoded`** body (NOT JSON): `grant_type=refresh_token&client_id={client_id}&client_secret={client_secret}&refresh_token={refresh_token}`; use `response.access_token` as bearer token
  - (3) On ADC parse failure or HTTP error from token endpoint: shell out to `gcloud auth print-access-token` as fallback
  - (4) POST to `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/anthropic/models/{model}:rawPredict` with headers `Authorization: Bearer {token}` and `Content-Type: application/json`; request body is the standard Anthropic Messages API payload with two differences: **`model` is NOT in the body** (it is in the URL path), and **`anthropic_version: "vertex-2023-10-16"` IS in the body** (underscore, body field — NOT an `anthropic-version` header)
- [ ] 4.6 **[Agent L]** Adapt `src/ai/aiCodeActionProvider.ts`: restrict `documentSelector` to `[{ language: 'xml' }]`; read diagnostics from both `xmlXslt.local` and `xmlXslt.helger` collections; offer "AI: Fix this error" only for diagnostics whose source is `[Local-SCH]`, `[Local-XSD]`, or `[Helger]`
- [ ] 4.7 **[Agent L]** Write `src/commands/aiCommands.ts`: `fixAllErrors` (collect all diagnostics, build context payload with XSLT content + error list, call llmClient with progress + retry up to maxRetries, apply `WorkspaceEdit`, open diff view); `setApiKey` (`showInputBox` password, `context.secrets.store` under `xmlXslt.ai.apiKey.{provider}`); guard: if provider requires key and none stored, show error with "Set API Key" button

## 5. Phase 5 — Integration — Main Session (Sequential)

- [ ] 5.1 Write `src/extension.ts`: `activate(context)` creates `DiagnosticCollection` instances (`xmlXslt.local`, `xmlXslt.helger`), a `vscode.OutputChannel` named `'XSLT Studio'` (for verbose Saxon/Java stderr and Helger SOAP debug output — never auto-shown, available via View > Output), and a status bar item; runs Java check (`java -version`, one-time warning if not found, warning text written to OutputChannel); registers all 11 commands — `xmlXslt.transform`, `xmlXslt.validateDocument`, `xmlXslt.validateXsdOnly`, `xmlXslt.validateBusinessRulesOnly`, `xmlXslt.runScenario`, `xmlXslt.saveScenario`, `xmlXslt.manageScenarios`, `xmlXslt.toggleWatch`, `xmlXslt.fixAllErrors`, `xmlXslt.setApiKey`, and `xmlXslt.fixThisError` (code action command invoked by `AiCodeActionProvider`, not palette-visible); registers `AiCodeActionProvider`; pushes all disposables to `context.subscriptions`; passes `local`, `helger`, and `outputChannel` to any command that needs them via factory functions
- [ ] 5.2 Complete `package.json` manifest: all 11 command contributions — `xmlXslt.fixThisError` is listed in `contributes.commands` **without a `title`** (internal code action command, not palette-visible; invoked only by `AiCodeActionProvider`); the other 10 commands (`xmlXslt.transform`, `xmlXslt.validateDocument`, `xmlXslt.validateXsdOnly`, `xmlXslt.validateBusinessRulesOnly`, `xmlXslt.runScenario`, `xmlXslt.saveScenario`, `xmlXslt.manageScenarios`, `xmlXslt.toggleWatch`, `xmlXslt.fixAllErrors`, `xmlXslt.setApiKey`) have titles, categories, and icons; `menus["editor/title"]` with `when: resourceExtname == .xml || resourceExtname == .xsl || resourceExtname == .xslt`; `keybindings` with `Ctrl+Shift+T`/`Cmd+Shift+T` for transform and `Ctrl+Shift+V`/`Cmd+Shift+V` for validate, both with `when: editorLangId == xml || editorLangId == xsl`; full `contributes.configuration` schema for all 15 settings (including `xmlXslt.validation.helgerVesidVersion` with enum `["latest", "previous"]` + free-form string, default `"latest"`); `publisher: "am-vs-tools"`, `repository`, `bugs`, `homepage`, `license: MIT`, `"icon": "icon.png"`, `galleryBanner: { "color": "#1e1e1e", "theme": "dark" }` fields; add `"vscode:prepublish": "npm run build"` to scripts
- [ ] 5.3 Run `npm run build` and resolve all TypeScript errors (expect import mismatches between parallel agent outputs — fix interface disagreements against the types defined in task 2.1 and the signature defined in task 3.5)
- [ ] 5.4 Write `.vscodeignore`: exclude `src/`, `java/`, `*.ts`, `*.map`, `esbuild.config.js`, `tsconfig.json`, `jest.config.js`, `node_modules/`, `openspec/`, `.git/`, `preflight-findings.md`
- [ ] 5.5 Write `README.md`: feature list, requirements (Java ≥ 8), quick start, settings table, command reference table
- [ ] 5.6 Write `CHANGELOG.md`: `## [0.1.0] — 2026-04-10` with Added section
- [ ] 5.7 Add `LICENSE` (MIT)
- [ ] 5.8 Create `icon.png` placeholder (128×128 PNG) — a minimal valid PNG is required for `vsce package` to succeed; generate via Node Buffer or any simple script; replace with final artwork before marketplace publish
- [ ] 5.9 Run `vsce package` and verify `.vsix` is produced and size is < 50 MB

## 6. Unit Tests — Main Session (after Phase 5 build passes)

- [ ] 6.1 Write `src/__tests__/svrlParser.test.ts`: use `vs-code-extensions/xml-xslt/test-fixtures/invoice_svrl.xml` and `creditnote_svrl.xml` as real fixtures (read via `fs.readFileSync`); assert `flag="fatal"` → `IssueSeverity.Error`; `flag="warning"` → `IssueSeverity.Warning`; `ruleId` parsed from `id` attribute; missing ruleId → `undefined`
- [ ] 6.2 Write `src/__tests__/documentDetector.test.ts`: use `vs-code-extensions/xml-xslt/test-fixtures/630_IV0021266_405869_SO1035613.xml` (CreditNote) as real fixture; CreditNote namespace → `{ docType: 'CreditNote' }`; also test with inline Invoice namespace string → `{ docType: 'Invoice' }`; unknown namespace → `undefined`
- [ ] 6.3 Write `src/__tests__/helgerValidator.test.ts`: (a) `buildSoapEnvelope(xml, 'eu.peppol.bis3:invoice:2025.11.0')` — assert output contains `VESID="eu.peppol.bis3:invoice:2025.11.0"` and the xml content is XML-escaped inside `<ns:XML>`; (b) `parseSoapResponse` with the live-response fixture from preflight-findings.md Section 1 → `IssueSeverity.Error` items; `IssueSeverity.Warning` items from WARN errorLevel; (c) `detectCustomizationId` with `vs-code-extensions/xml-xslt/test-fixtures/630_IV0021266_405869_SO1035613.xml` → extracts `urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`; (d) `resolveVesidFromProfile` with that CustomizationID + docType `'CreditNote'` + `'latest'` → `'eu.peppol.bis3:creditnote:2025.11.0'`; (e) `resolveVesidFromProfile` with unknown CustomizationID → `undefined`; no network calls in any test
- [ ] 6.4 Write `src/__tests__/saxonTracer.test.ts`: `parseSaxonTrace` with a fixture trace string written to a temp file → correct `Map<number, Location>` entries; empty map on unparseable input; empty map on missing file (no throw)
- [ ] 6.5 Write `src/__tests__/scenarioCommand.test.ts`: `resolveVariables('${workspaceFolder}/a.xml', 'C:/proj', 'C:/proj/src')` → `'C:/proj/a.xml'`; `resolveVariables('${fileDir}/t.xsl', 'C:/proj', 'C:/proj/src')` → `'C:/proj/src/t.xsl'`
- [ ] 6.6 Configure `jest.config.js` with `ts-jest` preset; add `test` script to `package.json`; run `npm test` — all tests must pass

## 7. Verification Checklist — Main Session (Sequential)

- [ ] 7.1 Install the `.vsix` locally: `code --install-extension xml-xslt-studio-0.1.0.vsix`
- [ ] 7.2 Open an XML file → click ⚡ in title bar → QuickPick shows RECENT and OPEN TABS sections for XSLT files
- [ ] 7.3 Open an XSLT file → click ⚡ → QuickPick shows RECENT and OPEN TABS sections for XML files
- [ ] 7.4 Select a file via Browse → confirm it appears at the top of Recent on next invocation
- [ ] 7.5 Open an XML file with `<?xml-stylesheet type="text/xsl" href="...">` → XSLT picker opens with the referenced file pre-selected (highlighted, not auto-confirmed)
- [ ] 7.6 Transform a valid UBL Invoice → output opens beside editor → Problems panel shows `[Local-XSD]` / `[Local-SCH]` results
- [ ] 7.7 Click a validation error → editor navigates to the correct line in the output XML tab
- [ ] 7.8 Verify at least one diagnostic has a Related Information link to the correct XSLT source line
- [ ] 7.9 Transform an intentionally invalid UBL → error count in status bar matches Problems panel count
- [ ] 7.10 Enable `xmlXslt.validation.enableHelger` → validate a Peppol BIS 3.0 CreditNote → `[Helger]` results appear (auto-detected VESID `eu.peppol.bis3:creditnote:2025.11.0`, no picker shown)
- [ ] 7.10b Open an XML with an unknown/absent CustomizationID → Helger validate → warning message appears, QuickPick shows VESID options filtered by doc type, user picks one → validation runs with chosen VESID
- [ ] 7.10c Set `xmlXslt.validation.helgerVesidVersion` to `"previous"` → validate Peppol BIS 3.0 Invoice → VESID resolves to `eu.peppol.bis3:invoice:2025.5.0` (visible in OutputChannel debug output)
- [ ] 7.11 Save a scenario → run via `XSLT: Run Scenario` → correct files and parameters used without prompts
- [ ] 7.12 Enable watch mode → save source XML → transform auto-runs and output tab updates
- [ ] 7.13 Cancel a long-running transform → Saxon process killed → no error notification shown
- [ ] 7.14 Set `xmlXslt.ai.provider` to `anthropic`, set API key, run `UBL: Fix All Errors with AI` → progress shown, WorkspaceEdit applied
- [ ] 7.15 With an XML file focused: press `Ctrl+Shift+T` → XSLT picker opens (not "Reopen Closed Editor"); press `Ctrl+Shift+V` → validation runs
- [ ] 7.16 Type a filter in the file picker that eliminates all items from one section → confirm that section's separator is hidden, not left floating with nothing beneath it
