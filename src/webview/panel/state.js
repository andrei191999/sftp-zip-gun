// state.js — extracted from media/panel.js
// Shared webview state and persistence live here; this fragment must load first.

// panel.js — SFTP Zip Gun webview UI
//
// All user-controlled values (preset names, file names, paths, log text) are inserted
// exclusively via el.textContent, el.value, or el.setAttribute — never via innerHTML.
//
// acquireVsCodeApi() is called EXACTLY ONCE at module top level.
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  view: 'upload',           // 'upload' | 'manage'
  presets: [],              // PresetMeta[]
  selectedPresetName: null,
  lastPresetName: null,
  files: [],                // FileEntry[]
  anchorFile: null,         // string: absolute path of the anchor file
  modeAnchors: {},          // { [mode]: absPath } — per-mode anchor memory
  modeSelectedFiles: {},    // { [mode]: Set<string> } — selectedFiles snapshot per non-zip_gun mode
  selectedFiles: new Set(),
  mode: 'pistol_file',      // 'zip_canon' | 'pistol_file' | 'zip_gun'
  folderPath: null,
  uploading: false,
  openFiles: [],            // [{path, name}] from VS Code open tabs
  sectionCollapsed: { local: false },
  logs: [],                 // { level: string, text: string, ts: string, category: string }[]
  newPresetNames: {},          // session-only: { [name]: true } for names added this session (cleared on edit)
  logFilter: new Set(['upload', 'conn', 'import', 'accounts', 'sys']),  // session-only
  logActiveTab: null,     // session-only: null | 'log' | 'history' — starts collapsed
  historyFilter: { result: 'all', mode: 'all' },  // session-only
  history: [],              // HistoryEntry[]
  remoteBrowse: null,       // null | { path: string, entries: RemoteEntry[], loading: boolean }
  remoteBrowseCtx: null,    // 'send-to' | 'form-default' | 'form-bookmark' | null
  importPending: false,     // true while FileZilla import is in progress
  zipBaseName: null,        // string | null — user override for zip base name
  fileGroups: [],           // [{filePath: string, groupId: number}]
  groups: [],               // [{id: number, label: string}]
  nextGroupId: 1,
  groupNaming: 'anchor',    // 'anchor' | 'base-counter' | 'base-timestamp'
  namingBase: '',
  groupAnchors: {},         // { [groupId]: absPath } — per-group anchor
  groupCollapsed: {},       // { [groupId]: boolean } — collapsed state per group
  ungroupedCollapsed: false, // session-only: collapse the Ungrouped section in zip_gun
  zipGunMemory: null,       // session-only snapshot: saved when leaving zip_gun with groups
  selectedPath: null,       // string | null — selected remote path ('__add_new__' = add-path mode)
  addPathValue: '',         // string — text in the "add new path" input
  pendingDeleteName: null,  // string | null — preset name awaiting inline delete confirmation
  uploadProgressText: null, // string | null — live upload progress shown in log box footer
  fileUploadStatuses: {},   // { [absPath]: StatusTrail } — pistol_file and zip_canon source rows
  groupUploadStatuses: {},  // { [groupId]: StatusTrail } — zip_gun group headers and member rows
  modeFileStatuses:  {},   // { [mode]: fileUploadStatuses snapshot } — saved on mode switch
  modeGroupStatuses: {},   // { [mode]: groupUploadStatuses snapshot } — saved on mode switch
  // Manage view state
  editingPreset: null,      // PresetMeta | null  (null = adding new)
  showPresetForm: false,
  formAuthType: 'password', // 'password' | 'key' — tracks auth radio inside form
  formDraft: null,          // preserved form values across browse round-trips
  connectionStatus: {},     // { [presetName]: 'pending' | 'ok' | 'fail' }
};

// ---------------------------------------------------------------------------
// Restore persisted state (mode + selectedPresetName survive tab switches)
// ---------------------------------------------------------------------------

const _saved = vscode.getState();
if (_saved) {
  if (_saved.mode) { state.mode = _saved.mode; }
  if (_saved.selectedPresetName) { state.selectedPresetName = _saved.selectedPresetName; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_CAP = 500;

function pad2(n) { return String(n).padStart(2, '0'); }

function nowHHMMSS() {
  var d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function pushLog(text, level, category) {
  var lvl = level || 'info';
  state.logs.push({ level: lvl, text: text, ts: nowHHMMSS(), category: category || '' });
  if (state.logs.length > LOG_CAP) { state.logs.shift(); }
}

var _lastSavedMode = null;
var _lastSavedPresetName = null;
var _updateFileControlsFn = null; // set by renderUploadView; called by buildFileTable checkbox handlers
var _fileTableContainer  = null; // set by buildFileTable; used by baseInput live-update
var _fileTableFilterStr  = '';   // set by buildFileTable
var _fileTableOpenRows   = [];   // set by buildFileTable
var _fireBtnRef = null;           // set by renderUploadView; updated by updateFireState()
function saveViewState() {
  if (state.mode === _lastSavedMode && state.selectedPresetName === _lastSavedPresetName) { return; }
  _lastSavedMode = state.mode;
  _lastSavedPresetName = state.selectedPresetName;
  vscode.setState({ mode: state.mode, selectedPresetName: state.selectedPresetName });
}

// persistState: posts to the host (triggers a globalState write). Call only on
// meaningful user actions — not during upload progress ticks.
function persistState() {
  saveViewState();
  vscode.postMessage({
    kind: 'setState',
    payload: {
      lastFolder: state.folderPath || undefined,
      lastPresetName: state.selectedPresetName || undefined,
      mode: state.mode,
      anchorFile: state.anchorFile || undefined,
      sectionCollapsed: state.sectionCollapsed,
      groupCollapsed: Object.keys(state.groupCollapsed).length ? state.groupCollapsed : undefined,
    }
  });
}

function getSelectedPreset() {
  return state.presets.find(function (p) { return p.name === state.selectedPresetName; }) || null;
}

