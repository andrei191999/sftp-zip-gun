## ADDED Requirements

### Requirement: Helger WS2 SOAP call
When `xmlXslt.validation.enableHelger` is true, the extension SHALL send the XML document content to the Helger phive WS2 SOAP endpoint (`xmlXslt.validation.helgerEndpoint`, default: `https://peppol.helger.com/wsdvs`) via HTTPS POST with a SOAP 1.1 envelope. The request SHALL include the XML content and the VESID string for the detected document type. The HTTP timeout SHALL be controlled by `xmlXslt.validation.helgerTimeout` (default: 10000 ms). No authentication is required.

#### Scenario: Helger call sent for detected UBL Invoice
- **WHEN** `enableHelger` is true and the output document is detected as a UBL Invoice
- **THEN** a SOAP POST is made to the configured endpoint with the Invoice XML and the Invoice VESID

#### Scenario: Helger disabled — no request made
- **WHEN** `enableHelger` is false
- **THEN** no network request is made regardless of document type

---

### Requirement: VESID resolution from CustomizationID

The extension SHALL determine the Helger VESID by reading `<cbc:CustomizationID>` from the XML document and matching it against an internal catalog. The catalog maps known CustomizationID patterns to VESID strings for each document type. The active VESID version is controlled by the `xmlXslt.validation.helgerVesidVersion` setting (default: `"latest"`, which resolves to `"2025.11.0"`; `"previous"` resolves to `"2025.5.0"`; any other string is used as-is).

#### Scenario: Peppol BIS 3.0 Invoice — VESID auto-detected
- **WHEN** the document is a UBL Invoice with CustomizationID containing `peppol.eu:2017:poacc:billing:3.0` and `helgerVesidVersion` is `"latest"`
- **THEN** the SOAP request includes VESID `eu.peppol.bis3:invoice:2025.11.0` and no picker is shown

#### Scenario: Peppol BIS 3.0 Credit Note — VESID auto-detected
- **WHEN** the document is a UBL CreditNote with CustomizationID containing `peppol.eu:2017:poacc:billing:3.0`
- **THEN** the SOAP request includes VESID `eu.peppol.bis3:creditnote:2025.11.0`

#### Scenario: Version override via setting
- **WHEN** `helgerVesidVersion` is `"previous"` and the document is a Peppol BIS 3.0 Invoice
- **THEN** the SOAP request includes VESID `eu.peppol.bis3:invoice:2025.5.0`

---

### Requirement: QuickPick fallback when VESID cannot be inferred

If no CustomizationID is present, or the CustomizationID does not match any known catalog entry, the extension SHALL:
1. Show a warning message: "Could not detect Peppol profile from CustomizationID — select a validation ruleset."
2. Present a QuickPick listing all catalog entries applicable to the detected document type, plus a "Custom VESID..." option.
3. If the user selects "Custom VESID...", show an InputBox for manual VESID entry.
4. If the user cancels at any point, skip Helger validation and return no diagnostics.

Document types with no catalog entries at all (e.g., `OrderResponse`) SHALL show the full catalog unfiltered with the same warning.

#### Scenario: Unknown CustomizationID — picker shown
- **WHEN** the document has a CustomizationID not in the catalog
- **THEN** a warning message is shown and a QuickPick lists available VESIDs filtered by doc type

#### Scenario: User cancels picker — no Helger call
- **WHEN** the VESID picker is shown and the user presses Escape
- **THEN** no SOAP request is made and no error notification is shown

#### Scenario: User selects "Custom VESID..." — InputBox appears
- **WHEN** the user selects "Custom VESID..." from the picker
- **THEN** an InputBox appears pre-filled with a VESID example; the entered value is used for the SOAP call

#### Scenario: No CustomizationID present — picker shown
- **WHEN** the XML document contains no `<cbc:CustomizationID>` element
- **THEN** the same warning and QuickPick flow applies

#### Scenario: Non-Invoice/CreditNote type — full catalog shown unfiltered
- **WHEN** the document type is `OrderResponse` and no catalog entries match it
- **THEN** the QuickPick shows all catalog entries (unfiltered) with the warning

---

### Requirement: Helger results in Problems panel
Errors and warnings returned by the Helger service SHALL be added to the VS Code Problems panel under the `xmlXslt.helger` diagnostic collection. Each diagnostic SHALL include the rule ID in brackets (e.g., `[BR-01]`) if provided by the service response. The source label SHALL be `[Helger]`. Helger diagnostics SHALL be cleared and replaced on each new validation run.

#### Scenario: Helger error appears with source label
- **WHEN** the Helger service returns a validation error for rule `PEPPOL-EN16931-R001`
- **THEN** the Problems panel shows an error with `[Helger]` as the source and `[PEPPOL-EN16931-R001]` in the message

#### Scenario: Previous Helger results cleared on re-run
- **WHEN** a second validation runs on the same document
- **THEN** the previous `[Helger]` diagnostics are replaced, not appended to

---

### Requirement: Offline resilience
If the Helger request times out or fails with a network error, the extension SHALL NOT show an error notification. Instead, it SHALL show a brief status bar warning (e.g., "Helger unavailable — local only") that auto-dismisses after 5 seconds. Local validation SHALL still run and its results SHALL appear normally.

#### Scenario: Network timeout shows status bar warning only
- **WHEN** the Helger endpoint is unreachable and the request times out
- **THEN** a status bar warning appears briefly, no error notification is shown, and local validation results are still reported

#### Scenario: Local validation unaffected by Helger failure
- **WHEN** the Helger request fails for any reason
- **THEN** XSD and Schematron results still appear in the Problems panel under `[Local-XSD]` and `[Local-SCH]`
