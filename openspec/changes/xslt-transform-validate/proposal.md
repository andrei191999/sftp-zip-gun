## Why

VS Code lacks a production-quality XSLT + UBL validation extension: the closest existing option (`xslt-transformer-vscode`) has no context-aware file picking, duplicated pipeline logic, module-level mutable state, no cancellation support, and no bundler — making it slow to activate and hard to extend. This extension starts fresh, borrows the proven low-level utilities (Saxon runner, XSD validator, Schematron artifacts), and adds significantly improved UX and capabilities for teams building UBL / Peppol / EN16931 compliant XML documents.

## What Changes

- New VS Code extension published to the Marketplace as `xml-xslt-studio`
- Introduces a context-aware file picker QuickPick (recent files + open tabs + browse)
- Introduces XSLT transformation via bundled Saxon HE 10.9 JAR using stdin piping
- Introduces local UBL validation (XSD + EN16931 + Peppol Schematron) with Problems panel integration
- Introduces remote Helger WS2 SOAP validation (opt-in, always-latest rules)
- Introduces two-target error tracing: diagnostics on the output XML + Related Information links back to the generating XSLT line (input XML tracing out of scope)
- Introduces named transform scenarios stored in `.vscode/xslt-scenarios.json`
- Introduces watch mode that auto-re-transforms on file save
- Introduces AI-powered fix commands for validation errors (Anthropic Claude default, multi-provider)
- Bundled with esbuild — single output file, scoped activation (`onLanguage:xml`, `onLanguage:xsl`)
- Requires Java in PATH as the only system dependency (Saxon JAR bundled)

## Capabilities

### New Capabilities

- `file-picker`: Context-aware QuickPick with Recent / Open Tabs / Browse sections, fuzzy search, per-filetype MRU list in globalState, processing-instruction pre-selection, and a Browse button opening a filtered file dialog
- `saxon-transform`: XSLT transformation pipeline — Saxon HE JAR invocation via stdin pipe, XSLT parameter injection, output-method detection (xml/html/text), new-tab or save-file output, cancellation support, and progress reporting
- `ubl-local-validation`: Local UBL validation — XSD validation via bundled Java class, EN16931 and Peppol Schematron via Saxon, SVRL parsing, UBL document-type auto-detection, and diagnostics written to the VS Code Problems panel with source tag `[Local]`
- `helger-validation`: Remote validation via Helger phive WS2 SOAP endpoint — VESID auto-mapping from document type, offline resilience (warn + continue), results tagged `[Helger]` in Problems panel, configurable endpoint and timeout
- `xslt-tracing`: Two-target error tracing — (1) diagnostics written directly against the output XML document so clicking an error jumps to the failing line in the result; (2) Related Information links on each diagnostic pointing to the XSLT source line that generated the failing element, built from a Saxon `-T -traceout` output-line → XSLT-line map (fallback: colleague's comment-injection approach). Input XML tracing is explicitly out of scope.
- `transform-scenarios`: Named transform presets — CRUD stored in `.vscode/xslt-scenarios.json`, `${workspaceFolder}` / `${fileDir}` variable substitution, QuickPick runner, and save-current-as-scenario command
- `watch-mode`: Auto-re-transform — `onDidSaveTextDocument` listener filtered to last-used XML/XSLT pair, status bar indicator, opt-in via setting
- `ai-fix-commands`: AI-powered error fixing — reads Problems panel diagnostics, builds XSLT + error context, calls configurable AI provider (Anthropic Claude default, OpenAI / Gemini / Groq / Vertex AI supported), proposes edits as code actions, API key stored in `vscode.SecretStorage`

### Modified Capabilities

*(none — this is a new extension)*

## Impact

- **New repo**: `C:\Workspace\Scripts\vs-code-extensions\xml-xslt\xml-xslt-studio\`
- **Borrowed artifacts** (copied, not modified at the repo level):
  - `lib/saxon-he-10.9.jar`, `lib/classes/XsdValidator.class`, `java/XsdValidator.java`
  - `validation-artifacts/` (UBL 2.1 XSD schemas + compiled Schematron XSLT)
  - Source files from `vasilcinandrei/xslt-transformer-vscode`: `execAsync.ts`, `tempFile.ts`, `javaRunner.ts`, `xsdValidator.ts`, `schematronValidator.ts`, `svrlParser.ts`, `documentDetector.ts`, `diagnosticsReporter.ts`, `xsltTracer.ts`, `errorTraceMapper.ts`, `src/ai/` folder
- **Runtime dependencies**: none (Node built-ins + `vscode` only) — keeping the dependency footprint zero
- **Dev dependencies**: TypeScript, esbuild, `@types/vscode`, `@vscode/vsce`
- **External services**: Helger phive WS2 at `https://peppol.helger.com/wsdvs` (opt-in only)
- **System requirement**: Java (any version ≥ 8) in PATH
- **Marketplace**: requires publisher account, `vsce package` + `vsce publish`
- **VS Code engine**: `^1.85.0` (Dec 2023 — minimum for `vscode.window.tabGroups` Tab API)
