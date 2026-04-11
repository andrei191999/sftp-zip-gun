## ADDED Requirements

### Requirement: Multi-provider AI client
The extension SHALL support the following AI providers via `xmlXslt.ai.provider`: `anthropic` (default — direct API), `anthropic-vertex` (Anthropic Claude via GCP Vertex AI using Application Default Credentials), `openai`, `gemini`, and `groq`. The default model for each provider SHALL be: Anthropic → `claude-sonnet-4-6`, OpenAI → `gpt-4o`, Gemini → `gemini-1.5-pro`, Groq → `llama-3.1-70b-versatile`. The model SHALL be overridable via `xmlXslt.ai.model`.

#### Scenario: Anthropic is the default provider
- **WHEN** `xmlXslt.ai.provider` is unset or set to `anthropic`
- **THEN** AI requests are sent to the Anthropic API using the stored API key

#### Scenario: Vertex AI uses ADC — no API key required
- **WHEN** `xmlXslt.ai.provider` is `anthropic-vertex` and `xmlXslt.ai.vertexProject` is set
- **THEN** the extension reads the ADC file from the `GOOGLE_APPLICATION_CREDENTIALS` environment variable path (if set) or the platform default ADC location, uses it to obtain a bearer token via OAuth2 token refresh or `gcloud auth print-access-token` fallback, and no API key is required or read from SecretStorage

---

### Requirement: API key management
For providers that require an API key (`anthropic`, `openai`, `gemini`, `groq`), the extension SHALL store the key in `vscode.SecretStorage` under the key `xmlXslt.ai.apiKey.{provider}`. The command `UBL: Set AI API Key` SHALL prompt the user for the key via `showInputBox` (password type) and store it. If no key is stored and the provider requires one, the extension SHALL show an error notification with a button to invoke the set-key command.

#### Scenario: API key stored in SecretStorage
- **WHEN** the user runs `UBL: Set AI API Key` and enters a key
- **THEN** the key is stored via `context.secrets.store` and not written to any file

#### Scenario: Missing API key shows actionable error
- **WHEN** the user invokes an AI command without a stored key for the current provider
- **THEN** an error notification appears with a "Set API Key" button that invokes `UBL: Set AI API Key`

---

### Requirement: Fix All Errors with AI command
The command `UBL: Fix All Errors with AI` SHALL read all current diagnostics from the `xmlXslt.local` and `xmlXslt.helger` collections for the active document, build a context payload (XSLT file content + list of errors with rule ID, message, line number, and element path), send it to the configured AI provider, and apply the returned XSLT edit. The command SHALL show a progress notification during the AI request. Retry logic SHALL be controlled by `xmlXslt.ai.maxRetries` (default: 3).

#### Scenario: Command sends XSLT and errors to AI
- **WHEN** the Problems panel contains 3 validation errors and the user runs `UBL: Fix All Errors with AI`
- **THEN** the AI receives the full XSLT file content and all 3 error descriptions in the prompt

#### Scenario: AI response applied as edit to XSLT file
- **WHEN** the AI returns a targeted XSLT edit
- **THEN** the extension applies the edit to the XSLT file using a `WorkspaceEdit` and opens a diff view for the user to review

#### Scenario: Retry on AI failure up to maxRetries
- **WHEN** the AI request fails (network error or non-200 response)
- **THEN** the extension retries up to `maxRetries` times before showing an error notification

---

### Requirement: Code action lightbulb integration
The extension SHALL register a `CodeActionsProvider` for XML documents that offers an "AI: Fix this error" quick fix for each diagnostic in the `xmlXslt.local` and `xmlXslt.helger` collections. Activating the quick fix SHALL send only that single error to the AI provider (not all errors) for a targeted fix suggestion.

#### Scenario: Lightbulb appears on validation error line
- **WHEN** the cursor is on a line with a `[Local-SCH]` or `[Helger]` diagnostic
- **THEN** a lightbulb icon appears and "AI: Fix this error" is listed as a quick fix option

#### Scenario: Single-error fix sends targeted context
- **WHEN** the user selects "AI: Fix this error" for rule `BR-01`
- **THEN** only the `BR-01` error details are sent to the AI, not the full error list
