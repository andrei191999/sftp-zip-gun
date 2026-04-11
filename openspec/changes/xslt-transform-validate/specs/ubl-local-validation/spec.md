## ADDED Requirements

### Requirement: UBL document type auto-detection
The extension SHALL detect whether an XML document is a UBL 2.1 document by inspecting its root element namespace. If the root element namespace matches any known UBL 2.1 document type namespace (e.g., `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`), the extension SHALL identify the document type (e.g., `Invoice`) and select the corresponding XSD schema path from `validation-artifacts/xsd/ubl-2.1/maindoc/`. Non-UBL documents SHALL be silently skipped during auto-validation.

#### Scenario: UBL Invoice detected by namespace
- **WHEN** an XML document's root element has namespace `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`
- **THEN** the extension identifies it as document type `Invoice` and selects `UBL-Invoice-2.1.xsd`

#### Scenario: Non-UBL XML skipped silently
- **WHEN** the output XML document has a root element with an unrecognised namespace
- **THEN** no local validation runs and no error or warning notification is shown

---

### Requirement: XSD validation via bundled Java class
The extension SHALL validate a UBL document against its corresponding XSD schema by invoking the bundled `XsdValidator.class` via Java. Validation errors SHALL be captured from both stdout and stderr. Each error SHALL be parsed into a line number and message. The source tag for XSD errors SHALL be `[Local-XSD]`.

#### Scenario: Valid UBL document passes XSD validation
- **WHEN** a valid UBL Invoice XML is validated against the bundled XSD
- **THEN** no XSD diagnostics are added to the Problems panel

#### Scenario: Invalid UBL document reports XSD errors with line numbers
- **WHEN** a UBL Invoice is missing a required element per the XSD
- **THEN** the Problems panel shows one or more errors with the source `[Local-XSD]` and a non-zero line number pointing into the output document

---

### Requirement: Schematron validation via Saxon
The extension SHALL validate a UBL document against the compiled EN16931 Schematron XSLT (`validation-artifacts/schematron/en16931/EN16931-UBL-validation.xslt`) and the compiled Peppol BIS 3.0 XSLT (`validation-artifacts/schematron/peppol/PEPPOL-EN16931-UBL.xslt`) by running Saxon on each. The SVRL output SHALL be parsed to extract rule ID, severity (error/warning), message, and XPath location. The source tag for Schematron errors SHALL be `[Local-SCH]`.

#### Scenario: EN16931 rule violation reported
- **WHEN** a UBL Invoice violates EN16931 business rule `BR-01` (missing seller name)
- **THEN** the Problems panel shows an error with message containing `[BR-01]` and source `[Local-SCH]`

#### Scenario: Peppol rule violation reported
- **WHEN** a UBL Invoice violates a Peppol-specific rule
- **THEN** the Problems panel shows a diagnostic with source `[Local-SCH]` and the Peppol rule ID in the message

#### Scenario: Warning-severity rules shown as warnings
- **WHEN** an SVRL result has `flag="warning"`
- **THEN** the corresponding Problems panel entry has Warning severity (yellow), not Error (red)

---

### Requirement: Auto-validate after transform
When a transform completes and the output is detected as a UBL document, the extension SHALL automatically run local validation if `xmlXslt.validation.autoValidateAfterTransform` is true (default). If false, validation SHALL only run when explicitly triggered.

#### Scenario: Auto-validation runs after successful UBL transform
- **WHEN** a transform produces a UBL Invoice output and `autoValidateAfterTransform` is true
- **THEN** local XSD and Schematron validation run automatically and results appear in the Problems panel without any additional user action

#### Scenario: Auto-validation skipped when disabled
- **WHEN** `xmlXslt.validation.autoValidateAfterTransform` is false
- **THEN** no validation runs automatically after a transform; the Problems panel is not updated

---

### Requirement: Standalone validate commands
The extension SHALL register the following commands available from the command palette when an XML file is active:
- `UBL: Validate Document` — runs all enabled local validators
- `UBL: Validate XSD Only` — runs XSD validation only
- `UBL: Validate Business Rules Only` — runs both Schematron rulesets only

#### Scenario: Validate Document runs all local validators
- **WHEN** the user runs `UBL: Validate Document` on a UBL Invoice file
- **THEN** XSD and both Schematron rulesets run and all results appear in the Problems panel

#### Scenario: Validate XSD Only skips Schematron
- **WHEN** the user runs `UBL: Validate XSD Only`
- **THEN** only XSD errors appear in the Problems panel; no Schematron results are shown

#### Scenario: Validate Business Rules Only skips XSD
- **WHEN** the user runs `UBL: Validate Business Rules Only`
- **THEN** only Schematron results appear; no XSD errors are shown
