## ADDED Requirements

### Requirement: Context-aware file type inference
The extension SHALL infer which file type to prompt for based on the active editor. If the active editor contains an XML file, the picker SHALL prompt for an XSLT stylesheet. If the active editor contains an XSL or XSLT file, the picker SHALL prompt for an XML input file. If neither is active, the picker SHALL prompt for XML first, then XSLT.

#### Scenario: XML file active triggers XSLT picker
- **WHEN** the user invokes the transform command with an XML file in the active editor
- **THEN** the QuickPick title reads "Select XSLT Stylesheet" and lists XSLT files only

#### Scenario: XSLT file active triggers XML picker
- **WHEN** the user invokes the transform command with an XSL or XSLT file in the active editor
- **THEN** the QuickPick title reads "Select XML Input" and lists XML files only

#### Scenario: No relevant file active triggers dual prompt
- **WHEN** the user invokes the transform command with a non-XML/XSLT file active (or no editor open)
- **THEN** the extension prompts for an XML file first, then an XSLT file sequentially

---

### Requirement: QuickPick with sectioned items
The file picker QuickPick SHALL display items in two labelled sections: "RECENT" (MRU list) and "OPEN TABS" (currently open editors of the correct file type). Files already shown in RECENT SHALL NOT be duplicated in OPEN TABS. The picker SHALL support fuzzy search across all items. A "Browse filesystem" button SHALL appear in the QuickPick toolbar.

#### Scenario: Recent and open tabs shown in separate sections
- **WHEN** the user opens the file picker and has both recent files and open tabs of the correct type
- **THEN** the QuickPick displays a "RECENT" separator followed by recent items, then an "OPEN TABS" separator followed by tab items, with no duplicates across sections

#### Scenario: Empty recent list shows only open tabs
- **WHEN** the user opens the file picker for the first time with no recent files recorded
- **THEN** the QuickPick shows only the "OPEN TABS" section (if any tabs are open) with no "RECENT" separator

#### Scenario: Browse button opens OS file dialog
- **WHEN** the user clicks the folder icon button in the QuickPick toolbar
- **THEN** the OS file dialog opens filtered to the correct extension(s) (.xml or .xsl/.xslt)

#### Scenario: Fuzzy search filters across sections
- **WHEN** the user types a search term in the QuickPick input
- **THEN** both RECENT and OPEN TABS items are filtered by the search term, with section separators hidden if their section has no matches

---

### Requirement: MRU list persistence
The extension SHALL maintain a per-file-type most-recently-used (MRU) list stored in `ExtensionContext.globalState`. The list SHALL store absolute file paths. The maximum list size SHALL be configurable via `xmlXslt.recentFiles.maxCount` (default: 10). When a file is selected from any source (recent, tab, or browse), it SHALL be moved to the top of the MRU list for its file type. Paths that no longer exist on disk SHALL be silently excluded from the displayed list.

#### Scenario: Selected file moves to top of recent list
- **WHEN** the user selects a file that is already in the recent list
- **THEN** that file appears at the top of the "RECENT" section on the next invocation

#### Scenario: Browse selection is added to recent list
- **WHEN** the user selects a file via the Browse button
- **THEN** that file's path is prepended to the MRU list and persists across VS Code restarts

#### Scenario: List is capped at maxCount
- **WHEN** the MRU list already contains `maxCount` items and a new file is added
- **THEN** the oldest entry is dropped so the list remains at `maxCount` items

#### Scenario: Non-existent paths are excluded from display
- **WHEN** the MRU list contains a path to a file that has since been deleted
- **THEN** that path does not appear in the QuickPick (it is silently filtered out before display)

---

### Requirement: Processing instruction pre-selection
If the active XML file contains an `<?xml-stylesheet type="text/xsl" href="...">` processing instruction, the extension SHALL pre-select (highlight as active) the referenced stylesheet in the XSLT picker. The user SHALL be able to override the pre-selection by choosing a different item. If the href is a relative path, it SHALL be resolved relative to the XML file's directory.

#### Scenario: PI stylesheet pre-selected in picker
- **WHEN** the active XML file contains `<?xml-stylesheet type="text/xsl" href="transform.xsl">` and `transform.xsl` is resolvable
- **THEN** the XSLT picker opens with `transform.xsl` highlighted as the active item

#### Scenario: PI pre-selection can be overridden
- **WHEN** the XSLT picker opens with a pre-selected item from a PI
- **THEN** the user can navigate to and confirm a different item, and that item is used for the transform

#### Scenario: Missing PI results in no pre-selection
- **WHEN** the active XML file contains no `<?xml-stylesheet?>` processing instruction
- **THEN** the XSLT picker opens with no item pre-selected
