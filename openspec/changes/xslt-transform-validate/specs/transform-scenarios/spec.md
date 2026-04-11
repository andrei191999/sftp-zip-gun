## ADDED Requirements

### Requirement: Scenario file schema and storage
The extension SHALL store transform scenarios in `.vscode/xslt-scenarios.json` at the workspace root. Each scenario SHALL be a JSON object with the fields: `name` (string, required), `xml` (string, required), `xslt` (string, required), `parameters` (object, optional), `outputDestination` (enum `newTab`|`saveFile`, optional), and `outputPath` (string, optional). The file SHALL use the following top-level structure: `{ "scenarios": [ ... ] }`.

#### Scenario: Valid scenario file is parsed correctly
- **WHEN** `.vscode/xslt-scenarios.json` contains one scenario with all required fields
- **THEN** the extension can read and run that scenario without error

#### Scenario: Missing scenario file returns empty list gracefully
- **WHEN** no `.vscode/xslt-scenarios.json` exists in the workspace
- **THEN** the `XSLT: Run Scenario` command shows an empty QuickPick and offers to create the file, rather than throwing an error

---

### Requirement: Variable substitution in scenario paths
Scenario `xml`, `xslt`, and `outputPath` fields SHALL support the variables `${workspaceFolder}` (absolute path to the workspace root) and `${fileDir}` (directory of the currently active editor file). Variables SHALL be resolved at run time, not stored resolved.

#### Scenario: workspaceFolder resolved at run time
- **WHEN** a scenario has `"xml": "${workspaceFolder}/input/invoice.xml"` and the workspace root is `C:/Projects/myapp`
- **THEN** the resolved XML path used for the transform is `C:/Projects/myapp/input/invoice.xml`

#### Scenario: fileDir resolved to active editor directory
- **WHEN** a scenario has `"xslt": "${fileDir}/transform.xsl"` and the active file is `C:/Projects/myapp/src/data.xml`
- **THEN** the resolved XSLT path is `C:/Projects/myapp/src/transform.xsl`

---

### Requirement: Run Scenario command
The extension SHALL provide the command `XSLT: Run Scenario` that opens a QuickPick listing all scenarios from `.vscode/xslt-scenarios.json`. Selecting a scenario SHALL run it immediately through the existing transform pipeline with the scenario's parameters. The command SHALL be available always (not gated on file type).

#### Scenario: Scenario selected and run immediately
- **WHEN** the user runs `XSLT: Run Scenario`, selects "Invoice → UBL Output", and confirms
- **THEN** the transform runs with the scenario's xml, xslt, and parameters, identical to a manual transform with those same inputs

---

### Requirement: Save Current as Scenario command
After a successful transform, the extension SHALL make the command `XSLT: Save Current as Scenario` available. Invoking it SHALL prompt for a scenario name via `showInputBox`, then append a new scenario to `.vscode/xslt-scenarios.json` (creating the file if absent) with the last-used XML path, XSLT path, and parameters.

#### Scenario: Scenario saved with last transform inputs
- **WHEN** the user ran a transform using `invoice.xml` + `transform.xsl` with parameter `env=prod`, then invokes `Save Current as Scenario` and names it "Prod Invoice"
- **THEN** `.vscode/xslt-scenarios.json` gains a new entry: `{ "name": "Prod Invoice", "xml": "...", "xslt": "...", "parameters": { "env": "prod" } }`

#### Scenario: Save command unavailable before first transform
- **WHEN** no transform has been run in the current session
- **THEN** the `XSLT: Save Current as Scenario` command is visible but shows an informational message explaining that a transform must be run first

---

### Requirement: Manage Scenarios command
The extension SHALL provide the command `XSLT: Manage Scenarios` that opens `.vscode/xslt-scenarios.json` in the VS Code editor for direct editing. If the file does not exist, the extension SHALL create it with an empty `{ "scenarios": [] }` skeleton before opening it.

#### Scenario: Manage Scenarios opens the file for editing
- **WHEN** the user runs `XSLT: Manage Scenarios` and the file exists
- **THEN** `.vscode/xslt-scenarios.json` opens in a VS Code editor tab

#### Scenario: Manage Scenarios creates skeleton file if absent
- **WHEN** the user runs `XSLT: Manage Scenarios` and no scenario file exists
- **THEN** the extension creates `.vscode/xslt-scenarios.json` with `{ "scenarios": [] }` and then opens it
