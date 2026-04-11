## ADDED Requirements

### Requirement: Saxon invocation via stdin pipe
The extension SHALL invoke Saxon HE by passing XML content via stdin (`-s:-`) and the XSLT path as an absolute file URI (`-xsl:{absolutePath}`). The Saxon JAR SHALL be the bundled `lib/saxon-he-10.9.jar` by default, overridable via `xmlXslt.saxon.jarPath`. The Java executable SHALL default to `java` (PATH resolution), overridable via `xmlXslt.java.path`. The full transformed output SHALL be captured from stdout.

#### Scenario: Successful transform of unsaved buffer
- **WHEN** the user triggers a transform on an XML file with unsaved edits
- **THEN** the current buffer text (not the on-disk version) is piped to Saxon and the transform output reflects the unsaved content

#### Scenario: Transform failure surfaces Saxon error message
- **WHEN** Saxon exits with a non-zero code (e.g., malformed XML or XSLT error)
- **THEN** the extension shows a VS Code error notification containing the actual Saxon error text from stderr, not a generic "Transform failed" message

#### Scenario: Custom Saxon JAR is used when configured
- **WHEN** `xmlXslt.saxon.jarPath` is set to a non-empty path
- **THEN** that JAR is passed to the Java invocation instead of the bundled JAR

---

### Requirement: Java availability check on activation
On extension activation, the extension SHALL verify that Java is accessible by running `{javaPath} -version`. If Java is not found or exits with an error, the extension SHALL display a one-time warning notification with a link to Java installation docs. The extension SHALL still activate fully — commands are registered but will show an actionable error if invoked without Java.

#### Scenario: Java found on activation — no warning shown
- **WHEN** the extension activates and `java -version` exits with code 0
- **THEN** no Java warning notification is shown

#### Scenario: Java missing — warning shown once
- **WHEN** the extension activates and `java -version` fails or is not found
- **THEN** a warning notification is shown offering to open Java installation documentation, and this notification is not repeated on subsequent activations during the same session

---

### Requirement: XSLT parameter injection
After file selection, the extension SHALL scan the selected XSLT file for `<xsl:param name="...">` declarations using a regex. If any parameters are found, the extension SHALL prompt the user for each parameter value via `showInputBox` (one per parameter, skippable by leaving blank). Non-empty parameter values SHALL be passed to Saxon as `-param:name=value` arguments.

#### Scenario: Parameters found — user prompted per parameter
- **WHEN** the XSLT file contains `<xsl:param name="env"/>` and `<xsl:param name="lang"/>`
- **THEN** the extension shows two sequential input boxes, one for `env` and one for `lang`

#### Scenario: Blank parameter value is skipped
- **WHEN** the user leaves an input box blank for a parameter
- **THEN** that parameter is not passed to Saxon (Saxon uses the default value declared in the XSLT)

#### Scenario: No parameters — prompt skipped entirely
- **WHEN** the XSLT file contains no `<xsl:param>` declarations
- **THEN** no input boxes are shown and the transform proceeds immediately after file selection

---

### Requirement: Output method detection and destination
The extension SHALL detect the XSLT output method by scanning for `<xsl:output method="...">` in the stylesheet. The detected method SHALL determine the language of the opened output document (`xml`, `html`, or `text`). The output destination SHALL be controlled by `xmlXslt.transform.outputDestination`: `newTab` (default) opens the output as an untitled document in `ViewColumn.Beside`; `saveFile` opens a save dialog with a default filename derived from `xmlXslt.transform.outputFileNaming`.

#### Scenario: XML output opens in new tab as XML language
- **WHEN** the XSLT declares `<xsl:output method="xml">` and outputDestination is `newTab`
- **THEN** the output opens in a new editor tab beside the current editor with the XML language mode set

#### Scenario: HTML output opens as HTML language
- **WHEN** the XSLT declares `<xsl:output method="html">` and outputDestination is `newTab`
- **THEN** the output opens with the HTML language mode set

#### Scenario: Save dialog uses naming pattern
- **WHEN** outputDestination is `saveFile` and outputFileNaming is `{name}.out.xml`
- **THEN** the save dialog pre-fills with the input XML basename (without extension) plus `.out.xml`

#### Scenario: No xsl:output defaults to XML
- **WHEN** the XSLT contains no `<xsl:output>` declaration
- **THEN** the output document opens with the XML language mode

---

### Requirement: Cancellation support
The transform command SHALL support cancellation via VS Code's progress notification cancel button. When the user cancels, the extension SHALL terminate the running Java/Saxon process and close the progress notification without showing an error message.

#### Scenario: Cancel terminates Saxon process
- **WHEN** a transform is in progress and the user clicks Cancel in the progress notification
- **THEN** the Saxon Java process is killed, no output document is opened, and no error notification is shown

---

### Requirement: Verbose output channel

The extension SHALL create a `vscode.OutputChannel` named `'XSLT Studio'` during activation. All Saxon stdout and stderr output SHALL be written to this channel after each transform invocation. The channel SHALL NOT be shown automatically (`outputChannel.show()` is never called by the extension) — it is available via View > Output for debugging. The Java availability check result (`java -version` output) SHALL also be written to the channel on activation.

#### Scenario: Saxon stderr written to output channel on transform error
- **WHEN** Saxon exits with a non-zero code and produces stderr output
- **THEN** the full stderr text is written to the `'XSLT Studio'` output channel; the error notification shown to the user contains only the key error message, not the full Saxon trace

#### Scenario: Output channel not auto-shown
- **WHEN** any transform or validation runs (success or failure)
- **THEN** the output channel is not forcibly revealed — the user must open it manually if needed
