## ADDED Requirements

### Requirement: Watch mode toggle
The extension SHALL provide the command `XSLT: Toggle Watch Mode` that enables or disables watch mode. The current state SHALL be reflected in a status bar item on the right side. When enabled, the status bar item SHALL display "$(eye) Watch: ON"; when disabled, it SHALL display "$(eye-closed) Watch: OFF". The initial state SHALL be determined by `xmlXslt.watch.enabled` (default: false). Clicking the status bar item SHALL also toggle watch mode.

#### Scenario: Watch mode enabled — status bar updates
- **WHEN** the user runs `XSLT: Toggle Watch Mode` while watch is OFF
- **THEN** the status bar item changes to "$(eye) Watch: ON"

#### Scenario: Watch mode disabled — status bar updates
- **WHEN** the user runs `XSLT: Toggle Watch Mode` while watch is ON
- **THEN** the status bar item changes to "$(eye-closed) Watch: OFF"

#### Scenario: Clicking status bar toggles watch
- **WHEN** the user clicks the watch status bar item
- **THEN** watch mode toggles (same as invoking the command)

---

### Requirement: Auto-re-transform on file save
When watch mode is enabled, the extension SHALL listen to `vscode.workspace.onDidSaveTextDocument`. If the saved file is the XML source or the XSLT stylesheet used in the most recent transform, the extension SHALL automatically re-run the transform with the same inputs and parameters. The re-run SHALL use the same output destination as the previous transform. No QuickPick or parameter prompts SHALL appear during a watch-triggered re-run.

#### Scenario: Saving source XML triggers re-transform
- **WHEN** watch mode is ON and the user saves the XML file used in the last transform
- **THEN** the transform runs automatically with the same XSLT and parameters, updating the output

#### Scenario: Saving XSLT triggers re-transform
- **WHEN** watch mode is ON and the user saves the XSLT stylesheet used in the last transform
- **THEN** the transform runs automatically with the same XML and parameters

#### Scenario: Saving unrelated file does not trigger re-transform
- **WHEN** watch mode is ON and the user saves a file that was not part of the last transform
- **THEN** no transform runs

#### Scenario: Watch mode OFF — no auto re-transform
- **WHEN** watch mode is OFF and the user saves the source XML
- **THEN** no transform runs automatically

---

### Requirement: Watch mode requires a prior transform
Watch mode SHALL only trigger re-transforms after at least one manual transform has been run in the current session. If watch mode is enabled but no transform has been run yet, saving an XML or XSLT file SHALL NOT trigger a transform.

#### Scenario: No prior transform — watch save is a no-op
- **WHEN** watch mode is ON but no transform has been run in the current session
- **THEN** saving any XML or XSLT file does not trigger a transform and no error is shown
