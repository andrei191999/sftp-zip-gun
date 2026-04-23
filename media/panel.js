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
  history: [],              // HistoryEntry[]
  showHistory: false,
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

// helpers.js — extracted from media/panel.js
// Pure-ish helpers and DOM utilities. This fragment depends on state.js being loaded first.

function formatTimestamp(d) {
  return (
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    'T' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

var STATUS_GLYPHS = {
  archive: '\ud83d\udddc', // clamp 🗜
  upload: '\u2191', // up arrow ↑
  queued: '\u2013', // en dash –
  done: '\u2713', // check mark ✓
  cancelled: '\u2298', // circled division slash ⊘
  error: '\u2717', // ballot x ✗
};

function normalizeFolderPath(folderPath) {
  return (folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
}

function getFileName(path) {
  return normalizeFolderPath(path).split('/').pop() || '';
}

function buildAbsoluteFilePath(folderPath, fileName) {
  var folder = normalizeFolderPath(folderPath);
  return folder ? folder + '/' + fileName : fileName;
}

function getDefaultSelectedFiles(folderPath, files) {
  return new Set(
    files
      .filter(function(f) { return !f.isDirectory; })
      .map(function(f) { return buildAbsoluteFilePath(folderPath, f.name); })
  );
}

function clearUploadProgressRows() {
  document.querySelectorAll('td.uploading-cell').forEach(function(td) {
    td.classList.remove('uploading-cell');
    var bar = td.querySelector('.upload-progress-bar');
    if (bar) { bar.remove(); }
  });
}

function applyProgressBar(td, percent) {
  if (!td) { return; }
  td.classList.add('uploading-cell');
  var bar = td.querySelector('.upload-progress-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'upload-progress-bar';
    td.appendChild(bar);
  }
  bar.style.width = percent + '%';
}

function resetLocalDatasetState() {
  state.selectedFiles = new Set();
  state.anchorFile = null;
  state.modeAnchors = {};
  state.modeSelectedFiles = {};
  state.zipBaseName = null;
  state.groups = [];
  state.fileGroups = [];
  state.groupAnchors = {};
  state.groupCollapsed = {};
  state.ungroupedCollapsed = false;
  state.nextGroupId = 1;
  state.zipGunMemory = null;
  state.fileUploadStatuses = {};
  state.groupUploadStatuses = {};
  state.uploadProgressText = null;
  clearUploadProgressRows();
}

function getParentFolderPath(filePath) {
  return normalizeFolderPath(filePath).replace(/\/[^/]+$/, '');
}

function shouldKeepListedFilePath(filePath, folderPath, validLocalFilePaths) {
  var normalizedFilePath = normalizeFolderPath(filePath);
  return getParentFolderPath(normalizedFilePath) !== folderPath || validLocalFilePaths.has(normalizedFilePath);
}

function pruneListedSelectionSet(selectionLike, folderPath, validLocalFilePaths) {
  var next = new Set();
  if (!selectionLike) { return next; }
  var values = selectionLike instanceof Set
    ? Array.from(selectionLike)
    : Array.isArray(selectionLike)
      ? selectionLike
      : [];
  values.forEach(function(filePath) {
    if (shouldKeepListedFilePath(filePath, folderPath, validLocalFilePaths)) {
      next.add(filePath);
    }
  });
  return next;
}

function reconcileListedGroupState(groups, fileGroups, groupAnchors) {
  var nextGroups = groups.filter(function(group) {
    return fileGroups.some(function(fileGroup) { return fileGroup.groupId === group.id; });
  });
  var validGroupIds = new Set(nextGroups.map(function(group) { return String(group.id); }));
  var nextGroupAnchors = {};

  Object.keys(groupAnchors || {}).forEach(function(groupId) {
    if (!validGroupIds.has(String(groupId))) { return; }
    var members = fileGroups.filter(function(fileGroup) { return String(fileGroup.groupId) === String(groupId); });
    if (members.length === 0) { return; }
    var currentAnchor = groupAnchors[groupId];
    nextGroupAnchors[groupId] = members.some(function(fileGroup) { return fileGroup.filePath === currentAnchor; })
      ? currentAnchor
      : members[0].filePath;
  });

  return {
    groups: nextGroups,
    groupAnchors: nextGroupAnchors,
    validGroupIds: validGroupIds,
  };
}

function reconcileListedFolderState(folderPath, files) {
  var normalizedFolderPath = normalizeFolderPath(folderPath);
  var validLocalFilePaths = new Set(
    files
      .filter(function(file) { return !file.isDirectory; })
      .map(function(file) { return buildAbsoluteFilePath(folderPath, file.name); })
  );

  state.selectedFiles = pruneListedSelectionSet(state.selectedFiles, normalizedFolderPath, validLocalFilePaths);

  Object.keys(state.modeSelectedFiles || {}).forEach(function(mode) {
    state.modeSelectedFiles[mode] = pruneListedSelectionSet(
      state.modeSelectedFiles[mode],
      normalizedFolderPath,
      validLocalFilePaths
    );
  });

  if (state.anchorFile && !shouldKeepListedFilePath(state.anchorFile, normalizedFolderPath, validLocalFilePaths)) {
    state.anchorFile = null;
  }

  Object.keys(state.modeAnchors || {}).forEach(function(mode) {
    var anchorFile = state.modeAnchors[mode];
    if (anchorFile && !shouldKeepListedFilePath(anchorFile, normalizedFolderPath, validLocalFilePaths)) {
      delete state.modeAnchors[mode];
    }
  });

  state.fileGroups = state.fileGroups.filter(function(fileGroup) {
    return shouldKeepListedFilePath(fileGroup.filePath, normalizedFolderPath, validLocalFilePaths);
  });

  var reconciledGroups = reconcileListedGroupState(state.groups, state.fileGroups, state.groupAnchors);
  state.groups = reconciledGroups.groups;
  state.groupAnchors = reconciledGroups.groupAnchors;

  Object.keys(state.groupCollapsed || {}).forEach(function(groupId) {
    if (!reconciledGroups.validGroupIds.has(String(groupId))) {
      delete state.groupCollapsed[groupId];
    }
  });

  Object.keys(state.groupUploadStatuses || {}).forEach(function(groupId) {
    if (!reconciledGroups.validGroupIds.has(String(groupId))) {
      delete state.groupUploadStatuses[groupId];
    }
  });

  Object.keys(state.fileUploadStatuses || {}).forEach(function(filePath) {
    if (!shouldKeepListedFilePath(filePath, normalizedFolderPath, validLocalFilePaths)) {
      delete state.fileUploadStatuses[filePath];
    }
  });

  if (state.groups.length === 0) {
    state.nextGroupId = 1;
  }

  if (state.zipGunMemory) {
    var memorySelectedFiles = Array.from(
      pruneListedSelectionSet(state.zipGunMemory.selectedFiles, normalizedFolderPath, validLocalFilePaths)
    );
    var memoryFileGroups = (state.zipGunMemory.fileGroups || []).filter(function(fileGroup) {
      return shouldKeepListedFilePath(fileGroup.filePath, normalizedFolderPath, validLocalFilePaths);
    });
    var memoryGroups = reconcileListedGroupState(
      state.zipGunMemory.groups || [],
      memoryFileGroups,
      state.zipGunMemory.groupAnchors || {}
    );

    state.zipGunMemory = (memorySelectedFiles.length === 0 && memoryGroups.groups.length === 0)
      ? null
      : {
          groups: memoryGroups.groups,
          fileGroups: memoryFileGroups,
          groupAnchors: memoryGroups.groupAnchors,
          nextGroupId: memoryGroups.groups.length === 0 ? 1 : state.zipGunMemory.nextGroupId,
          groupNaming: state.zipGunMemory.groupNaming,
          namingBase: state.zipGunMemory.namingBase,
          selectedFiles: memorySelectedFiles,
        };
  }
}

function buildZipGunGroupPayload() {
  return state.groups.map(function(group) {
    var groupFiles = state.fileGroups
      .filter(function(fileGroup) { return fileGroup.groupId === group.id; })
      .map(function(fileGroup) { return fileGroup.filePath; })
      .sort();
    var anchor = state.groupAnchors[group.id] || groupFiles[0] || '';
    return {
      id: group.id,
      label: group.label,
      files: groupFiles,
      anchorFile: anchor,
    };
  }).filter(function(group) {
    return group.files.length > 0;
  });
}

function hasActionableZipGunGroups() {
  return buildZipGunGroupPayload().length > 0;
}

function cloneStatusTrail(existing) {
  return existing
    ? {
        batch: existing.batch || null,
        zipped: !!existing.zipped,
        archive: existing.archive || null,
        upload: existing.upload || null,
      }
    : {
        batch: null,
        zipped: false,
        archive: null,
        upload: null,
      };
}

function advanceStatusTrail(existing, status) {
  var trail = cloneStatusTrail(existing);
  if (status === 'queued') {
    if (!trail.archive && !trail.upload) { trail.batch = 'queued'; }
    return trail;
  }
  trail.batch = null;
  if (status === 'zipping') {
    trail.zipped = true;
    trail.archive = 'zipping';
    trail.upload = null;
    return trail;
  }
  if (status === 'uploading') {
    if (trail.zipped || trail.archive) {
      trail.zipped = true;
      trail.archive = (trail.archive === 'error' || trail.archive === 'cancelled') ? trail.archive : 'done';
      trail.upload = 'uploading';
    } else {
      trail.upload = 'uploading';
    }
    return trail;
  }
  if (status === 'done') {
    if (trail.zipped || trail.archive) {
      trail.zipped = true;
      trail.archive = (trail.archive === 'error' || trail.archive === 'cancelled') ? trail.archive : 'done';
      trail.upload = 'done';
    } else {
      trail.upload = 'done';
    }
    return trail;
  }
  if (trail.zipped || trail.archive) {
    trail.zipped = true;
    if (trail.upload) {
      trail.archive = (trail.archive === 'error' || trail.archive === 'cancelled') ? trail.archive : 'done';
      trail.upload = status;
    } else {
      trail.archive = status;
      trail.upload = null;
    }
  } else {
    trail.upload = status;
  }
  return trail;
}

function createStatusIcon(stage, status) {
  var span = document.createElement('span');
  var glyph = STATUS_GLYPHS.upload;
  if (stage === 'archive') {
    glyph = STATUS_GLYPHS.archive;
  } else if (stage === 'batch') {
    glyph = STATUS_GLYPHS.queued;
  } else if (status === 'done') {
    glyph = STATUS_GLYPHS.done;
  } else if (status === 'cancelled') {
    glyph = STATUS_GLYPHS.cancelled;
  } else if (status === 'error') {
    glyph = STATUS_GLYPHS.error;
  }
  span.textContent = glyph;
  span.className = 'status-icon status-icon-' + stage + ' status-icon-' + status;
  if (status === 'zipping' || status === 'uploading') { span.className += ' spinner'; }
  span.title = stage === 'archive'
    ? (status === 'done' ? 'Archive ready' : status === 'cancelled' ? 'Archive cancelled' : status === 'error' ? 'Archive failed' : 'Creating archive')
    : stage === 'batch'
      ? 'Included in the batch but not transferred'
      : (status === 'done' ? 'Upload complete' : status === 'cancelled' ? 'Upload cancelled' : status === 'error' ? 'Upload failed' : 'Uploading');
  return span;
}

function renderStatusTrail(container, trail) {
  clearEl(container);
  if (!trail) { return; }
  var holder = document.createElement('span');
  holder.className = 'status-trail';
  if (trail.batch && !trail.archive && !trail.upload) {
    holder.appendChild(createStatusIcon('batch', trail.batch));
  } else if (trail.zipped) {
    if (trail.archive) { holder.appendChild(createStatusIcon('archive', trail.archive)); }
    if (trail.upload) { holder.appendChild(createStatusIcon('upload', trail.upload)); }
  } else if (trail.upload) {
    holder.appendChild(createStatusIcon('upload', trail.upload));
  }
  if (holder.childNodes.length > 0) {
    container.appendChild(holder);
  }
}

function queueFileStatuses(filePaths) {
  filePaths.forEach(function(filePath) {
    state.fileUploadStatuses[filePath] = advanceStatusTrail(state.fileUploadStatuses[filePath], 'queued');
  });
}

function queueGroupStatuses(groups) {
  groups.forEach(function(group) {
    state.groupUploadStatuses[group.id] = advanceStatusTrail(state.groupUploadStatuses[group.id], 'queued');
  });
}

function formatBytes(n) {
  if (!n || n === 0) { return '\u2014'; }
  if (n < 1024) { return n + ' B'; }
  if (n < 1048576) { return (n / 1024).toFixed(1) + ' KB'; }
  return (n / 1048576).toFixed(1) + ' MB';
}

function computeZipName() {
  if (!state.anchorFile) { return ''; }
  var base = getFileName(state.anchorFile);
  var noExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return noExt + '_' + formatTimestamp(new Date()) + '.zip';
}

function computeZipNameForGroup(group) {
  var groupFiles = state.fileGroups.filter(function(fg) { return fg.groupId === group.id; });
  if (groupFiles.length === 0) { return '(empty)'; }
  var anchor = state.groupAnchors[group.id] || groupFiles[0].filePath;
  var anchorBase = getFileName(anchor).replace(/\.[^.]+$/, '');
  var groupIndex = state.groups.findIndex(function(g) { return g.id === group.id; }) + 1;
  if (state.groupNaming === 'anchor') {
    return anchorBase + '_YYYYMMDD.zip';
  } else if (state.groupNaming === 'base-counter') {
    var pad = String(state.groups.length).length;
    return (state.namingBase || 'batch') + '_' + String(groupIndex).padStart(pad, '0') + '.zip';
  } else {
    return (state.namingBase || 'batch') + '_YYYYMMDD_HHmmss_' + groupIndex + '.zip';
  }
}

function isAnchorFile(fileName) {
  if (!state.anchorFile) { return false; }
  var base = getFileName(state.anchorFile);
  return base === fileName;
}

function autoGroupByName() {
  state.groups = [];
  state.fileGroups = [];
  state.groupAnchors = {};
  state.nextGroupId = 1;

  // Group selected files by filename stem (basename without extension)
  var stemMap = {};
  Array.from(state.selectedFiles).forEach(function(fp) {
    var name = getFileName(fp) || fp;
    var stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
    if (!stemMap[stem]) { stemMap[stem] = []; }
    stemMap[stem].push(fp);
  });

  // Create a group for each stem
  Object.keys(stemMap).sort().forEach(function(stem) {
    var files = stemMap[stem];
    var gid = state.nextGroupId++;
    state.groups.push({ id: gid, label: 'G' + gid });
    files.forEach(function(fp) {
      state.fileGroups.push({ filePath: fp, groupId: gid });
    });
    // Auto-anchor: first file alphabetically in the group
    var sortedFiles = files.slice().sort();
    state.groupAnchors[gid] = sortedFiles[0];
  });
}

// ---------------------------------------------------------------------------
// DOM helpers — all user values go through these, never through innerHTML
// ---------------------------------------------------------------------------

function el(tag, attrs, text) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (k === 'className') { node.className = attrs[k]; }
      else if (k === 'style') { node.style.cssText = attrs[k]; }
      else { node.setAttribute(k, attrs[k]); }
    });
  }
  if (text != null) { node.textContent = String(text); }
  return node;
}

function clearEl(node) {
  while (node.firstChild) { node.removeChild(node.firstChild); }
}

// Build a styled log box and append it to container. Returns the <pre>.
function buildLogBox(container) {
  var pre = el('pre', { className: 'log-box' });
  var visible = state.logs.filter(function (entry) {
    if (entry.level === 'session') { return true; }  // separators always show
    if (!entry.category) { return true; }            // uncategorised always show
    return state.logFilter.has(entry.category);
  });
  visible.forEach(function (entry) {
    var line = document.createElement('div');
    if (entry.level === 'session') {
      line.className = 'log-session';
      line.textContent = '\u2500\u2500 ' + entry.text + ' \u2500\u2500';
    } else {
      var ts = document.createElement('span');
      ts.className = 'log-ts';
      ts.textContent = (entry.ts || '') + ' ';
      line.appendChild(ts);
      if (entry.category) {
        var catSpan = document.createElement('span');
        catSpan.className = 'log-cat log-cat-' + entry.category;
        catSpan.textContent = '[' + entry.category + '] ';
        line.appendChild(catSpan);
      }
      var txt = document.createElement('span');
      txt.className = 'log-' + entry.level;
      txt.textContent = entry.text;
      line.appendChild(txt);
    }
    pre.appendChild(line);
  });
  if (state.uploading && state.uploadProgressText) {
    var pLine = document.createElement('div');
    pLine.className = 'log-progress';
    var pCat = document.createElement('span');
    pCat.className = 'log-cat log-cat-upload';
    pCat.textContent = '[upload] ';
    var pTxt = document.createElement('span');
    pTxt.textContent = state.uploadProgressText;
    pLine.appendChild(pCat);
    pLine.appendChild(pTxt);
    pre.appendChild(pLine);
  }
  container.appendChild(pre);
  // Defer scroll until the element is in the DOM and fully laid out.
  requestAnimationFrame(function () { pre.scrollTop = pre.scrollHeight; });
  return pre;
}

// Render a row of category filter toggle buttons above the log box.
function renderLogFilterBar(container) {
  var CATS = ['upload', 'conn', 'import', 'accounts', 'sys'];
  var bar = el('div', { className: 'log-filter-row' });

  var allActive = CATS.every(function (c) { return state.logFilter.has(c); });
  var allBtn = el('button', { className: allActive ? 'active' : 'secondary' }, 'All');
  allBtn.title = 'Show all log categories';
  allBtn.addEventListener('click', function () {
    if (allActive) {
      CATS.forEach(function (c) { state.logFilter.delete(c); });
    } else {
      CATS.forEach(function (c) { state.logFilter.add(c); });
    }
    render();
  });
  bar.appendChild(allBtn);

  CATS.forEach(function (cat) {
    var active = state.logFilter.has(cat);
    var btn = el('button', { className: active ? 'active' : 'secondary' }, cat);
    btn.title = 'Show only ' + cat + ' log entries';
    btn.addEventListener('click', function () {
      if (state.logFilter.has(cat)) { state.logFilter.delete(cat); }
      else { state.logFilter.add(cat); }
      render();
    });
    bar.appendChild(btn);
  });

  container.appendChild(bar);
}

// ---------------------------------------------------------------------------
// Message handling (HostToWebview)
// ---------------------------------------------------------------------------

// bridge.js — extracted from media/panel.js
// Host-to-webview message bridge. This fragment depends on helpers.js and renderers.js.

window.addEventListener('message', function (event) {
  var msg = event.data;
  switch (msg.kind) {

    case 'filesListed': {
      var p = msg.payload;
      var nextFolder = normalizeFolderPath(p.folderPath);
      var currentNorm = normalizeFolderPath(state.folderPath);
      var isNewDataset = !currentNorm || currentNorm !== nextFolder;
      if (isNewDataset) {
        resetLocalDatasetState();
      } else {
        reconcileListedFolderState(p.folderPath, p.files);
      }
      state.folderPath = p.folderPath;
      state.files = p.files;
      if (isNewDataset) {
        state.selectedFiles = getDefaultSelectedFiles(p.folderPath, p.files);
      }
      persistState();
      break;
    }

    case 'uploadProgress': {
      var p = msg.payload;
      state.uploadProgressText = (p.currentFile ? p.currentFile + ' \u2014 ' : '') + p.percent + '%';
      var fp = p.currentFilePath || null;
      var matchedRows = [];
      var rows = document.querySelectorAll('#file-list tr');
      rows.forEach(function(row) {
        var rowFilePath = row.dataset.filepath;
        var match = rowFilePath && (fp
          ? rowFilePath === fp
          : getFileName(rowFilePath) === p.currentFile);
        if (match) {
          matchedRows.push(row);
          applyProgressBar(row.querySelector('td.filename-cell'), p.percent);
        }
      });
      if (matchedRows.length === 0) {
        Object.keys(state.fileUploadStatuses).forEach(function(filePath) {
          var trail = state.fileUploadStatuses[filePath];
          var row = null;
          if (!trail || !trail.zipped || trail.upload !== 'uploading') { return; }
          row = Array.from(rows).find(function(candidate) {
            return candidate.dataset.filepath === filePath;
          }) || null;
          if (!row) { return; }
          applyProgressBar(row.querySelector('td.filename-cell'), p.percent);
        });
      }
      return;  // skip render() — wiping the DOM removes the progress bar
    }

    case 'fileStatus': {
      var fstatus = msg.payload;
      if (fstatus.filePath != null) {
        state.fileUploadStatuses[fstatus.filePath] = advanceStatusTrail(state.fileUploadStatuses[fstatus.filePath], fstatus.status);
        var row = document.querySelector('#file-list tr[data-filepath="' + String(fstatus.filePath).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (row) {
          var cell = row.querySelector('td.file-status-cell');
          if (cell) { renderStatusTrail(cell, state.fileUploadStatuses[fstatus.filePath]); }
        }
      }
      if (fstatus.groupId != null) {
        state.groupUploadStatuses[fstatus.groupId] = advanceStatusTrail(state.groupUploadStatuses[fstatus.groupId], fstatus.status);
        var hdr = document.querySelector('#file-list tr.group-header-row[data-groupid="' + fstatus.groupId + '"]');
        if (hdr) {
          var icon = hdr.querySelector('.group-status-icon');
          if (icon) { renderStatusTrail(icon, state.groupUploadStatuses[fstatus.groupId]); }
          // Propagate to all file rows in this group
          var fileRows = document.querySelectorAll('#file-list tr[data-groupid="' + fstatus.groupId + '"]');
          fileRows.forEach(function(row) {
            var cell = row.querySelector('td.file-status-cell');
            if (cell) { renderStatusTrail(cell, state.groupUploadStatuses[fstatus.groupId]); }
          });
        }
      }
      return;  // skip render()
    }

    case 'uploadDone': {
      var p = msg.payload;
      state.uploading = false;
      state.uploadProgressText = null;
      clearUploadProgressRows();
      var bytesInfo = p.bytesTransferred > 0 ? ' \u00b7 ' + formatBytes(p.bytesTransferred) : '';
      pushLog('Complete \u2192 ' + p.remoteFile + bytesInfo, 'success', 'upload');
      break;
    }

    case 'uploadError': {
      var p = msg.payload;
      state.uploading = false;
      state.uploadProgressText = null;
      clearUploadProgressRows();
      pushLog(p.message, 'error', 'upload');
      break;
    }

    case 'presets': {
      var p = msg.payload;
      state.presets = p.presets;
      state.lastPresetName = p.lastPresetName || null;
      if (!state.selectedPresetName && state.lastPresetName) {
        state.selectedPresetName = state.lastPresetName;
      }
      if (state.selectedPresetName && !state.presets.find(function (pr) { return pr.name === state.selectedPresetName; })) {
        state.selectedPresetName = state.presets.length ? state.presets[0].name : null;
      }
      if (!state.selectedPresetName && state.presets.length) {
        state.selectedPresetName = state.presets[0].name;
      }
      break;
    }

    case 'presetSaved': {
      var saved = msg.payload.preset;
      // Remove old entry by original name if it exists (handles rename)
      state.presets = state.presets.filter(function (p) { return p.name === saved.name || !msg.payload.originalName || p.name !== msg.payload.originalName; });
      var idx = state.presets.findIndex(function (p) { return p.name === saved.name; });
      if (idx >= 0) { state.presets[idx] = saved; }
      else { state.presets.push(saved); }
      // isNew comes from the host — reliable even when a 'presets' refresh arrives first
      if (msg.payload.isNew) { state.newPresetNames[saved.name] = true; }
      state.selectedPresetName = saved.name;
      state.showPresetForm = false;
      state.editingPreset = null;
      state.formDraft = null;
      // Clean up old connection status entry on rename
      if (msg.payload.originalName && msg.payload.originalName !== saved.name) {
        delete state.connectionStatus[msg.payload.originalName];
      }
      // Auto-test connection after every save
      state.connectionStatus[saved.name] = 'pending';
      vscode.postMessage({ kind: 'testConnection', payload: { presetName: saved.name } });
      break;
    }

    case 'presetDeleted': {
      state.presets = state.presets.filter(function (p) { return p.name !== msg.payload.name; });
      delete state.connectionStatus[msg.payload.name];
      if (state.selectedPresetName === msg.payload.name) {
        state.selectedPresetName = state.presets.length ? state.presets[0].name : null;
      }
      break;
    }

    case 'connectionTested': {
      var p = msg.payload;
      state.connectionStatus[p.presetName] = p.success ? 'ok' : 'fail';
      var icon = p.success ? '\u2713' : '\u2717';
      pushLog(icon + ' ' + p.presetName + ': ' + p.message, p.success ? 'success' : 'error', 'conn');
      break;
    }

    case 'history': {
      state.history = msg.payload.entries.slice(0, 50);
      break;
    }

    case 'openFiles': {
      state.openFiles = msg.payload.files;
      break;
    }

    case 'state': {
      var p = msg.payload;
      if (p.lastFolder && !state.folderPath)                  { state.folderPath = p.lastFolder; }
      if (p.lastPresetName && !state.selectedPresetName)      { state.selectedPresetName = p.lastPresetName; }
      if (p.mode)                                             { state.mode = p.mode; }
      if (p.anchorFile)                                       { state.anchorFile = p.anchorFile; }
      if (p.sectionCollapsed)                                 { state.sectionCollapsed = p.sectionCollapsed; }
      if (p.groupCollapsed)                                   { state.groupCollapsed = p.groupCollapsed; }
      break;
    }

    case 'remoteDirListed': {
      var p = msg.payload;
      state.remoteBrowse = { path: p.path, entries: p.entries, loading: false };
      break;
    }

    case 'folderPinned': {
      // preset data refreshed by the preceding 'presets' message from refreshPresets()
      state.remoteBrowse = null;
      state.remoteBrowseCtx = null;
      state.selectedPath = null;
      state.addPathValue = '';
      break;
    }

    case 'fileZillaImported': {
      var p = msg.payload;
      state.presets = p.presets;
      state.importPending = false;
      // newPresetNames comes from the host — reliable even when 'presets' refreshes arrive first
      (p.newPresetNames || []).forEach(function (name) { state.newPresetNames[name] = true; });
      pushLog('FileZilla import: ' + p.added + ' added, ' + p.duplicates + ' duplicate(s), ' + p.skipped + ' skipped (of ' + p.total + ' found).', 'info', 'import');
      // Auto-test all presets that don't already have a status
      p.presets.forEach(function (pr) {
        if (!state.connectionStatus[pr.name]) {
          state.connectionStatus[pr.name] = 'pending';
          vscode.postMessage({ kind: 'testConnection', payload: { presetName: pr.name } });
        }
      });
      break;
    }

    case 'log': {
      var p = msg.payload;
      var lvl = p.level === 'error' ? 'error' : p.level === 'warn' ? 'warn' : 'info';
      var cat = p.category || 'sys';
      if (p.replace && state.logs.length > 0) {
        // Find the last entry with the same category so an interleaved entry
        // from a different category (e.g. a cancel message) is not overwritten.
        // If no same-category entry exists, push a new entry instead of replacing
        // an unrelated one (which would be the old buggy behaviour).
        var targetIdx = -1;
        for (var ri = state.logs.length - 1; ri >= 0; ri--) {
          if (state.logs[ri].category === cat) { targetIdx = ri; break; }
        }
        if (targetIdx >= 0) {
          state.logs[targetIdx] = { level: lvl, text: p.text, ts: nowHHMMSS(), category: cat };
        } else {
          pushLog(p.text, lvl, cat);
        }
      } else {
        pushLog(p.text, lvl, cat);
      }
      break;
    }

    default:
      break;
  }
  render();
});

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

// renderers.js — extracted from media/panel.js
// View rendering and DOM composition. This fragment depends on state.js and helpers.js.

function renderTabBar(app) {
  var bar = el('div', { className: 'view-tab-bar' });
  [
    { value: 'upload', label: 'Transfer files' },
    { value: 'manage', label: 'Manage connections' },
  ].forEach(function (tab) {
    var t = el('div', { className: 'view-tab' + (state.view === tab.value ? ' active' : '') }, tab.label);
    t.addEventListener('click', function () {
      if (state.view === tab.value) { return; }
      state.view = tab.value;
      render();
    });
    bar.appendChild(t);
  });
  app.appendChild(bar);
}

function render() {
  var scrollY = window.scrollY || 0;
  var app = document.getElementById('app');
  if (!app) { return; }

  if (state.remoteBrowse !== null) {
    renderRemoteBrowseOverlay(app);
    window.scrollTo(0, scrollY);
    return;
  }

  clearEl(app);
  renderTabBar(app);

  if (state.view === 'manage') {
    renderManageView(app);
  } else {
    renderUploadView(app);
  }

  saveViewState();
  window.scrollTo(0, scrollY);
}

// ---------------------------------------------------------------------------
// Upload view
// ---------------------------------------------------------------------------

function renderUploadView(app) {
  // ---- Account row ----
  var rowDest = el('div', { className: 'row row-nowrap' });
  rowDest.appendChild(el('label', null, 'Account'));

  var select = document.createElement('select');
  select.id = 'preset-select';
  select.style.flex = '1';
  select.style.minWidth = '0';
  state.presets.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.name;
    var connFail = state.connectionStatus[p.name] === 'fail';
    opt.textContent = (connFail ? '\u26A0 ' : '') + (p.readOnly ? '\uD83D\uDD12 ' : '')
      + p.name + ' \u2014 ' + p.username + ':' + p.host;
    if (p.name === state.selectedPresetName) { opt.selected = true; }
    select.appendChild(opt);
  });
  var _selOpt = select.options[select.selectedIndex];
  if (_selOpt) { select.title = _selOpt.textContent; }
  rowDest.appendChild(select);

  var connBtn = el('button', { className: 'secondary conn-test-btn' });
  var connIcon = el('span', { className: 'conn-icon' }, '\u21bb');
  connBtn.appendChild(connIcon);
  var _connStatus = state.connectionStatus[state.selectedPresetName];
  if      (_connStatus === 'ok')      { connBtn.className += ' conn-test-ok';      connBtn.title = 'Connected'; }
  else if (_connStatus === 'fail')    { connBtn.className += ' conn-test-fail';    connBtn.title = 'Connection failed'; }
  else if (_connStatus === 'pending') { connBtn.className += ' conn-test-pending'; connBtn.title = 'Testing\u2026'; }
  else                                { connBtn.title = 'Test connection'; }
  connBtn.addEventListener('click', function() {
    var pr = getSelectedPreset();
    if (pr) {
      state.connectionStatus[pr.name] = 'pending';
      render();
      vscode.postMessage({ kind: 'testConnection', payload: { presetName: pr.name } });
    }
  });
  rowDest.appendChild(connBtn);

  app.appendChild(rowDest);

  // ---- Send to row ----
  var preset = getSelectedPreset();
  var sendToSelect = null;
  var addPathInput = null;
  var browseNewBtn = null;
  var setDefaultBtn = null;
  var bookmarkNewBtn = null;
  var useOnceBtn = null;

  var rowSendTo = el('div', { className: 'row row-nowrap' });
  rowSendTo.appendChild(el('label', { title: 'The remote directory where files will be uploaded' }, 'Send to'));

  if (preset) {
    sendToSelect = document.createElement('select');
    sendToSelect.id = 'send-to-select';

    var optDefault = document.createElement('option');
    optDefault.value = '__default__';
    optDefault.textContent = (preset.remoteDir || '/') + ' (default)' + (preset.readOnly ? ' \uD83D\uDD12' : '');
    sendToSelect.appendChild(optDefault);

    (preset.savedPaths || []).forEach(function (sp) {
      var opt = document.createElement('option');
      opt.value = sp;
      opt.textContent = sp;
      sendToSelect.appendChild(opt);
    });

    // Show a temporary one-time entry if selectedPath is not a known bookmark
    if (state.selectedPath && state.selectedPath !== '__add_new__' && state.selectedPath !== '__default__') {
      var isKnown = (preset.savedPaths || []).includes(state.selectedPath);
      if (!isKnown) {
        var optTemp = document.createElement('option');
        optTemp.value = state.selectedPath;
        optTemp.textContent = state.selectedPath + ' (one-time)';
        sendToSelect.appendChild(optTemp);
      }
    }

    var optAdd = document.createElement('option');
    optAdd.value = '__add_new__';
    optAdd.textContent = '+ Add new path\u2026';
    sendToSelect.appendChild(optAdd);

    // Restore current selection
    if (state.selectedPath !== null) {
      sendToSelect.value = state.selectedPath;
    }

    rowSendTo.appendChild(sendToSelect);
    sendToSelect.style.minWidth = '0';
    var _sendOpt = sendToSelect.options[sendToSelect.selectedIndex];
    if (_sendOpt) { sendToSelect.title = _sendOpt.textContent; }

    // Inline "Set as default" when a saved bookmark is the active selection
    if (state.selectedPath && state.selectedPath !== '__add_new__') {
      var inlineSetDefaultBtn = el('button', { className: 'secondary' }, 'Set as default');
      inlineSetDefaultBtn.addEventListener('click', function () {
        var pr = getSelectedPreset();
        if (!pr) { return; }
        vscode.postMessage({ kind: 'pinFolder', payload: { presetName: pr.name, remotePath: state.selectedPath } });
      });
      rowSendTo.appendChild(inlineSetDefaultBtn);
    }
  }
  app.appendChild(rowSendTo);

  // ---- Add new path row (visible when __add_new__ is selected) ----
  if (preset && state.selectedPath === '__add_new__') {
    var rowAddPath = el('div', { className: 'row', style: 'flex-wrap:wrap;gap:6px;' });
    rowAddPath.appendChild(el('label', null, ''));

    addPathInput = document.createElement('input');
    addPathInput.type = 'text';
    addPathInput.placeholder = '/remote/path';
    addPathInput.style.flex = '1';
    addPathInput.value = state.addPathValue || '';
    rowAddPath.appendChild(addPathInput);

    browseNewBtn   = el('button', { className: 'secondary' }, '\uD83D\uDCC2 Browse\u2026');
    setDefaultBtn  = el('button', { className: 'secondary' }, 'Set as default');
    bookmarkNewBtn = el('button', { className: 'secondary' }, 'Bookmark');
    useOnceBtn     = el('button', null, 'Use once');

    rowAddPath.appendChild(browseNewBtn);
    rowAddPath.appendChild(setDefaultBtn);
    rowAddPath.appendChild(bookmarkNewBtn);
    rowAddPath.appendChild(useOnceBtn);
    app.appendChild(rowAddPath);
  }

  // ---- Local folder row ----
  var rowFolder = el('div', { className: 'row row-nowrap' });
  rowFolder.appendChild(el('label', null, 'Local folder'));
  var changeFolderBtn = document.createElement('button');
  changeFolderBtn.className = 'secondary folder-btn';
  changeFolderBtn.title = state.folderPath || '';
  changeFolderBtn.disabled = state.uploading;
  changeFolderBtn.appendChild(document.createTextNode('\uD83D\uDCC2 '));
  var _pathSpan = document.createElement('span');
  _pathSpan.className = 'folder-path-text';
  _pathSpan.textContent = state.folderPath ? state.folderPath.replace(/\\/g, '/') : 'Change\u2026';
  changeFolderBtn.appendChild(_pathSpan);
  rowFolder.appendChild(changeFolderBtn);
  app.appendChild(rowFolder);

  // ---- Mode toggle — three-way segmented button ----
  var rowMode = el('div', { className: 'row' });
  rowMode.appendChild(el('label', { title: 'Controls how files are bundled: one zip, separate files, or per-group zips' }, 'Mode'));
  var modeBtn = document.createElement('button');
  modeBtn.className = 'mode-toggle';
  var modeSpans = [
    { value: 'zip_canon',   label: 'ZIP Canon',   title: 'One shot. All bullets zipped into a single archive and uploaded.' },
    { value: 'pistol_file', label: 'Pistol File', title: 'Each bullet uploaded as its own separate file. No zipping.' },
    { value: 'zip_gun',     label: 'ZIP Gun',     title: 'Bullets grouped into squads. Each group becomes its own zip, uploaded in sequence.' },
  ];
  modeSpans.forEach(function (item) {
    var modeSlug = item.value.replace(/_/g, '-');
    var span = el('span', { className: 'mode-half mode-half-' + modeSlug + (state.mode === item.value ? ' active' : ''), title: item.title }, item.label);
    span.addEventListener('click', function () {
      if (item.value === state.mode) { return; }
      // Save anchor for the mode we're leaving, restore for the mode we're entering
      state.modeAnchors[state.mode] = state.anchorFile;
      if (item.value === 'zip_gun' && state.mode !== 'zip_gun') {
        // Save canon/pistol selectedFiles so they survive the round-trip through zip_gun
        state.modeSelectedFiles[state.mode] = new Set(state.selectedFiles);
        if (state.zipGunMemory !== null) {
          // Restore last zip_gun snapshot
          var mem = state.zipGunMemory;
          state.groups        = mem.groups;
          state.fileGroups    = mem.fileGroups;
          state.groupAnchors  = mem.groupAnchors;
          state.nextGroupId   = mem.nextGroupId;
          state.groupNaming   = mem.groupNaming;
          state.namingBase    = mem.namingBase;
          state.selectedFiles = new Set(mem.selectedFiles);
        } else {
          state.selectedFiles.clear();
          state.groups       = [];
          state.fileGroups   = [];
          state.groupAnchors = {};
          state.nextGroupId  = 1;
        }
      } else if (state.mode === 'zip_gun' && item.value !== 'zip_gun') {
        // Save zip_gun state (only if groups are non-empty, so we don't wipe existing memory)
        if (state.groups.length > 0) {
          state.zipGunMemory = {
            groups:       state.groups.slice(),
            fileGroups:   state.fileGroups.slice(),
            groupAnchors: Object.assign({}, state.groupAnchors),
            nextGroupId:  state.nextGroupId,
            groupNaming:  state.groupNaming,
            namingBase:   state.namingBase,
            selectedFiles: Array.from(state.selectedFiles),
          };
        }
        // Restore the target mode's previously saved files
        var saved = state.modeSelectedFiles[item.value];
        if (saved) { state.selectedFiles = new Set(saved); }
      }
      state.mode = item.value;
      state.anchorFile = state.modeAnchors[item.value] || null;
      state.zipBaseName = null;
      persistState();
      render();
    });
    modeBtn.appendChild(span);
  });
  rowMode.appendChild(modeBtn);
  app.appendChild(rowMode);

  // ---- File sections (Open files merged with Local folder, shared search) ----
  var localFolderNorm = normalizeFolderPath(state.folderPath);
  // Open files not already in the local folder
  var openFileRows = state.openFiles
    .filter(function(of) {
      var ofFolderNorm = (of.path || '').replace(/\\/g, '/').replace(/\/[^/]+$/, '');
      return ofFolderNorm !== localFolderNorm;
    })
    .map(function(of) {
      var ofFolder = of.path.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
      return { filePath: of.path, fileName: of.name, folderPath: ofFolder };
    });

  var localFileCount = state.files.filter(function(f){ return !f.isDirectory; }).length;
  var totalFileCount = localFileCount + openFileRows.length;
  var localLabel = 'Files' + (state.folderPath ? ' \u2014 ' + getFileName(state.folderPath) : '');
  var sectionFiles = el('div', { id: 'section-files' });
  sectionFiles.appendChild(buildCollapsibleHeader('local', localLabel, totalFileCount));

  var fileListContainer = null;
  var toggleSelectBtn = null, counterSpan = null, fileFilter = null;
  var newGroupBtn = null, clearGroupsBtn = null, resetAllBtn = null;
  if (!state.sectionCollapsed.local && (state.files.length > 0 || openFileRows.length > 0)) {
    var localBody = el('div', { className: 'section-body' });
    var rowFileCtrl = el('div', { className: 'file-controls' });
    toggleSelectBtn = el('button', { className: 'secondary' }, '...');
    counterSpan = el('span', { style: 'opacity:0.7;' }, '');
    resetAllBtn = el('button', { className: 'secondary' }, '\u21ba Reset local state');
    resetAllBtn.disabled = state.uploading;
    resetAllBtn.title = 'Clear local file and group selections, anchors, and upload badges';
    if (state.mode === 'zip_gun') {
      newGroupBtn = el('button', { className: 'secondary' }, '\u2192 New Group');
      newGroupBtn.disabled = state.uploading;
      newGroupBtn.title = 'Create a new upload group \u2014 assign files to it using the Group column';
      clearGroupsBtn = el('button', { className: 'secondary' }, '\u00d7 Clear groups');
      clearGroupsBtn.disabled = state.uploading;
      clearGroupsBtn.title = 'Remove all group assignments \u2014 files revert to Ungrouped';
      rowFileCtrl.appendChild(toggleSelectBtn);
      rowFileCtrl.appendChild(counterSpan);
      rowFileCtrl.appendChild(newGroupBtn);
      rowFileCtrl.appendChild(clearGroupsBtn);
      rowFileCtrl.appendChild(resetAllBtn);
    } else {
      rowFileCtrl.appendChild(toggleSelectBtn);
      rowFileCtrl.appendChild(counterSpan);
      rowFileCtrl.appendChild(resetAllBtn);
    }
    fileFilter = el('input', { type: 'text', placeholder: 'Filter files\u2026', style: 'flex:1;min-width:120px;' });
    rowFileCtrl.appendChild(fileFilter);
    localBody.appendChild(rowFileCtrl);
    fileListContainer = el('div', { id: 'file-list' });
    localBody.appendChild(fileListContainer);
    buildFileTable(fileListContainer, '', openFileRows);
    sectionFiles.appendChild(localBody);
  }

  function updateFileControls() {
    if (!toggleSelectBtn || !counterSpan) { return; }
    var folder = normalizeFolderPath(state.folderPath);
    var selectableCount = state.files.filter(function (f) {
      return !f.isDirectory;
    }).length + openFileRows.length;
    var selectedCount = state.files.filter(function (f) {
      if (f.isDirectory) { return false; }
      var absPath = folder ? folder + '/' + f.name : f.name;
      return state.selectedFiles.has(absPath);
    }).length + openFileRows.filter(function(of) {
      return state.selectedFiles.has(of.filePath);
    }).length;
    var label;
    var toggleTitle;
    if (selectedCount === 0) {
      label = '\u2611 Select all';
      toggleTitle = 'Select all files in this folder';
    } else if (selectedCount === selectableCount) {
      label = '\u2610 Deselect all';
      toggleTitle = 'Deselect all files';
    } else {
      label = '\u229f Select all';
      toggleTitle = 'Select all files';
    }
    toggleSelectBtn.textContent = label;
    toggleSelectBtn.title = toggleTitle;
    if (state.mode === 'zip_gun') {
      var groupedCount = state.fileGroups.length;
      var gc = state.groups.length;
      var checkedCount = state.selectedFiles.size;
      var checkedLabel = checkedCount > 0 ? ' (' + checkedCount + ' selected)' : '';
      counterSpan.textContent = groupedCount + ' files in ' + gc + ' group' + (gc !== 1 ? 's' : '') + checkedLabel;
    } else {
      counterSpan.textContent = selectedCount + ' / ' + selectableCount;
    }
    updateFireState();
  }
  _updateFileControlsFn = updateFileControls;
  if (!state.sectionCollapsed.local && (state.files.length > 0 || openFileRows.length > 0)) {
    updateFileControls();
  }

  app.appendChild(sectionFiles);

  // ---- ZIP Gun naming strategy row (placed after file list) ----
  if (state.mode === 'zip_gun') {
    var rowNaming = el('div', { className: 'row' });
    rowNaming.appendChild(el('label', null, 'Naming'));
    var namingOpts = [
      { value: 'anchor', label: 'Anchor' },
      { value: 'base-counter', label: 'Base + Counter' },
      { value: 'base-timestamp', label: 'Base + Timestamp' },
    ];
    var namingGroup = el('div', { style: 'display:flex;gap:12px;flex:1;' });
    namingOpts.forEach(function(opt) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'groupNaming';
      radio.value = opt.value;
      radio.checked = state.groupNaming === opt.value;
      var optValue = opt.value;
      radio.addEventListener('change', function() {
        if (radio.checked) { state.groupNaming = optValue; render(); }
      });
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(opt.label));
      namingGroup.appendChild(lbl);
    });
    rowNaming.appendChild(namingGroup);
    app.appendChild(rowNaming);

    if (state.groupNaming !== 'anchor') {
      var rowBase = el('div', { className: 'row' });
      rowBase.appendChild(el('label', null, 'Base name'));
      var baseInput = el('input', { type: 'text', placeholder: 'e.g. batch', style: 'flex:1;' });
      baseInput.value = state.namingBase || '';
      baseInput.addEventListener('input', function() {
        state.namingBase = baseInput.value;
        if (_fileTableContainer) { buildFileTable(_fileTableContainer, _fileTableFilterStr, _fileTableOpenRows); }
      });
      rowBase.appendChild(baseInput);
      app.appendChild(rowBase);
    }
  }

  // ---- ZIP name row ----
  var anchorBase = getFileName(state.anchorFile);
  var anchorStem = anchorBase.includes('.') ? anchorBase.slice(0, anchorBase.lastIndexOf('.')) : anchorBase;
  var sectionZip = el('div', { id: 'section-zipname', style: 'margin-top:12px;' });
  var zipNameInput = null;
  if (state.mode === 'zip_canon') {
    var rowZip = el('div', { className: 'row' });
    rowZip.appendChild(el('label', null, 'Archive name'));
    zipNameInput = document.createElement('input');
    zipNameInput.type = 'text';
    zipNameInput.value = state.zipBaseName || anchorStem;
    zipNameInput.placeholder = state.anchorFile ? (anchorStem + '_YYYYMMDDTHHMMSS.zip') : 'e.g. batch_upload';
    zipNameInput.style.flex = '1';
    zipNameInput.addEventListener('input', function () {
      state.zipBaseName = zipNameInput.value.trim() || null;
    });
    rowZip.appendChild(zipNameInput);
    rowZip.appendChild(el('span', { style: 'opacity:0.6;font-size:0.85em;margin-left:4px;' }, '+timestamp.zip'));
    sectionZip.appendChild(rowZip);
    if (!state.anchorFile) {
      sectionZip.appendChild(el('div', { style: 'opacity:0.55;font-size:0.8em;margin-top:2px;' }, 'No anchor pinned \u2014 first selected file used for naming'));
    }
  }
  app.appendChild(sectionZip);


  // ---- Upload controls ----
  var rowUpload = el('div', { className: 'row', style: 'justify-content:center;' });
  var uploadBtn = el('button', { className: 'btn-fire' }, 'FIRE');
  _fireBtnRef = uploadBtn;
  var noFiles = state.mode === 'zip_gun'
    ? !hasActionableZipGunGroups()
    : state.selectedFiles.size === 0;
  uploadBtn.disabled = state.uploading || !state.selectedPresetName || noFiles;
  if (uploadBtn.disabled && !state.uploading) {
    var hints = [];
    if (!state.selectedPresetName) { hints.push('no account selected'); }
    if (noFiles) {
      hints.push(state.mode === 'zip_gun'
        ? 'check files and assign to groups'
        : 'no files selected');
    }
    uploadBtn.title = hints.join(' \u00b7 ');
  } else if (!uploadBtn.disabled) {
    uploadBtn.title = 'Upload the selected files to the remote server';
  }
  var stopBtn = el('button', { className: 'btn-hold', style: 'margin-left:12px;' }, 'HOLD');
  stopBtn.disabled = !state.uploading;
  stopBtn.title = 'Abort the current upload';
  rowUpload.appendChild(uploadBtn);
  rowUpload.appendChild(stopBtn);
  app.appendChild(rowUpload);

  // ---- Log output ----
  var rowLog = el('div', { className: 'row', style: 'flex-direction:column;align-items:stretch;' });
  renderLogFilterBar(rowLog);
  buildLogBox(rowLog);
  app.appendChild(rowLog);

  // ---- History toggle ----
  var rowHistBtn = el('div', { className: 'row' });
  var historyBtn = el('button', { className: 'secondary', title: 'View past upload sessions' }, '\uD83D\uDCCB History');
  rowHistBtn.appendChild(historyBtn);
  app.appendChild(rowHistBtn);

  // ---- History section ----
  var sectionHistory = el('div', { id: 'section-history' });
  if (state.showHistory) {
    buildHistory(sectionHistory);
  }
  app.appendChild(sectionHistory);

  // ---- Event listeners ----

  select.addEventListener('change', function () {
    state.selectedPresetName = select.value;
    state.selectedPath = null;
    state.addPathValue = '';
    delete state.connectionStatus[select.value];
    persistState();
    render();
  });

  if (sendToSelect) {
    sendToSelect.addEventListener('change', function () {
      var val = sendToSelect.value;
      state.selectedPath = (val === '__default__') ? null : val;
      if (val !== '__add_new__') { state.addPathValue = ''; }
      render();
    });
  }

  if (addPathInput) {
    addPathInput.addEventListener('input', function () {
      state.addPathValue = addPathInput.value;
    });

    browseNewBtn.addEventListener('click', function () {
      var pr = getSelectedPreset();
      if (!pr) { return; }
      var startPath = state.addPathValue.trim() || pr.remoteDir || '/';
      state.remoteBrowseCtx = 'send-to';
      state.remoteBrowse = { path: startPath, entries: [], loading: true };
      render();
      vscode.postMessage({ kind: 'browseRemoteDir', payload: { presetName: pr.name, path: startPath } });
    });

    setDefaultBtn.addEventListener('click', function () {
      var pr = getSelectedPreset();
      var p = state.addPathValue.trim();
      if (!pr || !p) { return; }
      vscode.postMessage({ kind: 'pinFolder', payload: { presetName: pr.name, remotePath: p } });
    });

    bookmarkNewBtn.addEventListener('click', function () {
      var pr = getSelectedPreset();
      var p = state.addPathValue.trim();
      if (!pr || !p) { return; }
      vscode.postMessage({ kind: 'bookmarkPath', payload: { presetName: pr.name, remotePath: p } });
      state.selectedPath = p;
      state.addPathValue = '';
      render();
    });

    useOnceBtn.addEventListener('click', function () {
      var p = state.addPathValue.trim();
      if (!p) { return; }
      state.selectedPath = p;
      state.addPathValue = '';
      render();
    });
  }

  changeFolderBtn.addEventListener('click', function () {
    vscode.postMessage({ kind: 'pickFolder' });
  });

  if (!state.sectionCollapsed.local && fileListContainer) {
    toggleSelectBtn.addEventListener('click', function () {
      var folder = normalizeFolderPath(state.folderPath);
      var selectableFiles = state.files.filter(function (f) { return !f.isDirectory; });
      var isGrouped = function(ap) {
        return state.mode === 'zip_gun' && state.fileGroups.some(function(fg) { return fg.filePath === ap; });
      };
      // In zip_gun, "all selected" means all UNGROUPED files are selected
      var allLocalSelected = selectableFiles.every(function (f) {
        var absPath = folder ? folder + '/' + f.name : f.name;
        if (isGrouped(absPath)) { return true; } // grouped files don't count
        return state.selectedFiles.has(absPath);
      });
      var allOpenSelected = openFileRows.every(function (of) {
        if (isGrouped(of.filePath)) { return true; }
        return state.selectedFiles.has(of.filePath);
      });
      var ungroupedLocalCount = state.mode === 'zip_gun'
        ? selectableFiles.filter(function(f) { return !isGrouped(folder ? folder + '/' + f.name : f.name); }).length
        : selectableFiles.length;
      var ungroupedOpenCount = state.mode === 'zip_gun'
        ? openFileRows.filter(function(of) { return !isGrouped(of.filePath); }).length
        : openFileRows.length;
      var allSelected = allLocalSelected && allOpenSelected
                     && (ungroupedLocalCount + ungroupedOpenCount > 0);
      if (allSelected) {
        // Deselect all (clear selection regardless of group status)
        selectableFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          state.selectedFiles.delete(absPath);
        });
        openFileRows.forEach(function (of) { state.selectedFiles.delete(of.filePath); });
      } else {
        // Select only ungrouped files in zip_gun, all files otherwise
        selectableFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          if (isGrouped(absPath)) { return; }
          state.selectedFiles.add(absPath);
        });
        openFileRows.forEach(function (of) {
          if (isGrouped(of.filePath)) { return; }
          state.selectedFiles.add(of.filePath);
        });
      }
      buildFileTable(fileListContainer, fileFilter.value, openFileRows);
      updateFileControls();
    });

    fileFilter.addEventListener('input', function () {
      buildFileTable(fileListContainer, fileFilter.value, openFileRows);
    });

    if (newGroupBtn) {
      newGroupBtn.addEventListener('click', function() {
        var checked = Array.from(state.selectedFiles);
        if (checked.length === 0) { return; }
        var gid = state.nextGroupId++;
        state.groups.push({ id: gid, label: 'G' + gid });
        var affectedGroups = new Set();
        checked.forEach(function(fp) {
          var existing = state.fileGroups.find(function(fg) { return fg.filePath === fp; });
          if (existing) { affectedGroups.add(existing.groupId); }
          state.fileGroups = state.fileGroups.filter(function(fg) { return fg.filePath !== fp; });
          state.fileGroups.push({ filePath: fp, groupId: gid });
        });
        affectedGroups.forEach(reconcileGroup);
        state.groupAnchors[gid] = checked.slice().sort()[0];
        state.selectedFiles.clear();
        persistState();
        buildFileTable(fileListContainer, fileFilter ? fileFilter.value : '', openFileRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }

    if (clearGroupsBtn) {
      clearGroupsBtn.addEventListener('click', function() {
        // Keep group containers (G1, G2...); un-assign files and deselect
        state.fileGroups   = [];
        state.groupAnchors = {};
        state.selectedFiles.clear();
        persistState();
        buildFileTable(fileListContainer, fileFilter ? fileFilter.value : '', openFileRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }

    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', function() {
        resetLocalDatasetState();
        persistState();
        render();
      });
    }
  }

  uploadBtn.addEventListener('click', function () {
    var pr = getSelectedPreset();
    if (!pr) { return; }

    var effectivePath = (state.selectedPath !== null && state.selectedPath !== '__add_new__')
      ? state.selectedPath
      : (pr.remoteDir || '/');

    if (state.mode === 'zip_gun') {
      var groupPayload = buildZipGunGroupPayload();

      if (groupPayload.length === 0) {
        pushLog('ZIP Gun needs at least one non-empty group before upload can start.', 'warn', 'upload');
        render();
        return;
      }
      state.uploading = true;
      state.fileUploadStatuses = {};
      state.groupUploadStatuses = {};
      queueFileStatuses(Array.from(state.selectedFiles));
      queueGroupStatuses(groupPayload);
      pushLog(pr.name + ' \u2014 ZIP Gun upload (' + groupPayload.length + ' group' + (groupPayload.length !== 1 ? 's' : '') + ')', 'session');
      vscode.postMessage({
        kind: 'upload',
        payload: {
          mode: 'zip_gun',
          presetName: pr.name,
          selectedPaths: [effectivePath],
          groups: groupPayload,
          groupNaming: state.groupNaming,
          namingBase: state.namingBase,
        }
      });
      render();
      return;
    }

    var filesToUpload = Array.from(state.selectedFiles);
    // Ensure anchor is included (it should already be in selectedFiles, but guard anyway)
    if (state.anchorFile && !state.selectedFiles.has(state.anchorFile)) {
      filesToUpload = [state.anchorFile].concat(filesToUpload);
    }
    var anchorAbs = state.anchorFile || (filesToUpload[0] || '');
    var payload = {
      mode: state.mode,
      files: filesToUpload,
      anchorFile: anchorAbs,
      presetName: pr.name,
      selectedPaths: [effectivePath],
    };
    if (state.mode === 'zip_canon') {
      payload.archiveName = state.zipBaseName || anchorStem || '';
    }
    state.uploading = true;
    state.fileUploadStatuses = {};
    state.groupUploadStatuses = {};
    queueFileStatuses(filesToUpload);
    pushLog(pr.name + ' \u2014 ' + (({ zip_canon: 'ZIP Canon', pistol_file: 'Pistol File', zip_gun: 'ZIP Gun' })[state.mode] || state.mode) + ' upload', 'session');
    vscode.postMessage({ kind: 'upload', payload: payload });
    render();
  });

  stopBtn.addEventListener('click', function () {
    vscode.postMessage({ kind: 'cancel' });
    render();
  });

  historyBtn.addEventListener('click', function () {
    state.showHistory = !state.showHistory;
    render();
  });
}

function updateFireState() {
  if (!_fireBtnRef) { return; }
  var noFiles = state.mode === 'zip_gun'
    ? !hasActionableZipGunGroups()
    : state.selectedFiles.size === 0;
  _fireBtnRef.disabled = state.uploading || !state.selectedPresetName || noFiles;
  if (_fireBtnRef.disabled && !state.uploading) {
    var hints = [];
    if (!state.selectedPresetName) { hints.push('no account selected'); }
    if (noFiles) {
      hints.push(state.mode === 'zip_gun' ? 'check files and assign to groups' : 'no files selected');
    }
    _fireBtnRef.title = hints.join(' \u00b7 ');
  } else {
    _fireBtnRef.title = '';
  }
}

function reconcileGroup(groupId) {
  var members = state.fileGroups.filter(function(fg) { return fg.groupId === groupId; });
  if (members.length === 0) {
    delete state.groupAnchors[groupId];
  } else if (state.groupAnchors[groupId] && !members.some(function(fg) { return fg.filePath === state.groupAnchors[groupId]; })) {
    state.groupAnchors[groupId] = members[0].filePath;
  }
}

// openFileRows: optional array of {filePath, fileName, folderPath} — open VS Code tabs not in local folder.
function buildFileTable(container, filterStr, openFileRows) {
  _fileTableContainer = container;
  _fileTableFilterStr = filterStr || '';
  _fileTableOpenRows  = openFileRows || [];
  var _prevWrap = container.querySelector('.file-table-wrap');
  var _prevScroll = _prevWrap ? _prevWrap.scrollTop : 0;
  clearEl(container);
  var filter = (filterStr || '').toLowerCase();
  var folder = normalizeFolderPath(state.folderPath);

  var localVisible = state.files.filter(function (f) {
    if (f.isDirectory) { return false; }
    if (filter && !f.name.toLowerCase().includes(filter)) { return false; }
    return true;
  });
  var openVisible = (openFileRows || []).filter(function(of) {
    return !filter || of.fileName.toLowerCase().includes(filter);
  });

  if (localVisible.length === 0 && openVisible.length === 0 && (state.mode !== 'zip_gun' || state.groups.length === 0)) { return; }

  var visibleRows = [];
  openVisible.forEach(function(of) {
    visibleRows.push({
      kind: 'open',
      absPath: of.filePath,
      fileName: of.fileName,
      folderPath: of.folderPath,
      isAnchor: false
    });
  });
  localVisible.forEach(function(f) {
    visibleRows.push({
      kind: 'local',
      absPath: folder ? folder + '/' + f.name : f.name,
      fileName: f.name,
      folderPath: folder,
      isAnchor: isAnchorFile(f.name)
    });
  });

  var wrap = el('div', { className: 'file-table-wrap' });
  var table = el('table', { className: 'file-table' });

  var thead = document.createElement('thead');
  var hrow = document.createElement('tr');
  if (state.mode === 'zip_gun') {
    var pinThAttrs = state.groupNaming === 'anchor' ? { title: 'Anchor \u2014 determines the zip archive filename for each group' } : null;
    hrow.appendChild(el('th', pinThAttrs, ''));
    hrow.appendChild(el('th', null, 'Group'));
    hrow.appendChild(el('th', null, ''));
    hrow.appendChild(el('th', null, ''));
    hrow.appendChild(el('th', null, 'File (' + (localVisible.length + openVisible.length) + ')'));
    hrow.appendChild(el('th', { className: 'status-th' }, ''));
  } else {
    var pinThAttrs2 = state.mode === 'zip_canon' ? { title: 'Anchor \u2014 determines the zip archive filename' } : null;
    hrow.appendChild(el('th', pinThAttrs2, ''));
    hrow.appendChild(el('th', null, ''));
    hrow.appendChild(el('th', null, ''));
    hrow.appendChild(el('th', null, 'File (' + (localVisible.length + openVisible.length) + ')'));
    hrow.appendChild(el('th', { className: 'status-th' }, ''));
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');

  // ── Pin cell builder ────────────────────────────────────────────────────
  function buildPinCell(absPath, isLocalAnchor) {
    var td = document.createElement('td');
    td.className = 'pin-cell';
    var span = document.createElement('span');
    span.textContent = '\u26b2';

    if (state.mode === 'zip_gun') {
      if (state.groupNaming !== 'anchor') {
        span.style.visibility = 'hidden';
        td.appendChild(span);
        return td;
      }
      var fg = state.fileGroups.find(function(x) { return x.filePath === absPath; });
      if (fg) {
        var pinned = state.groupAnchors[fg.groupId] === absPath;
        span.title = pinned ? 'Group anchor \u2014 this file\'s name is used as this group\'s zip archive name' : 'Set as group anchor \u2014 use this file\'s name for this group\'s zip archive';
        span.className = pinned ? 'pin-icon pin-icon-active' : 'pin-icon pin-icon-hover';
        if (!pinned) {
          (function(ap, gid) {
            span.addEventListener('click', function() {
              state.groupAnchors[gid] = ap;
              buildFileTable(container, filterStr, openFileRows);
            });
          }(absPath, fg.groupId));
        }
      } else {
        span.className = 'pin-icon';
        span.style.opacity = '0.2';
        span.title = 'Assign this file to a group to set it as the naming anchor for that group\'s zip';
      }
    } else if (state.mode === 'zip_canon') {
      if (isLocalAnchor) {
        span.title = 'Anchor \u2014 this file\'s name is used as the zip archive name';
        span.className = 'pin-icon pin-icon-active';
      } else {
        span.title = 'Set as anchor \u2014 use this file\'s name for the zip archive';
        span.className = 'pin-icon pin-icon-hover';
        (function(ap) {
          span.addEventListener('click', function () {
            state.anchorFile = ap;
            state.zipBaseName = null;
            persistState();
            render();
          });
        }(absPath));
      }
    } else {
      span.style.visibility = 'hidden';
    }

    td.appendChild(span);
    return td;
  }

  // ── Group dropdown cell builder (zip_gun) ────────────────────────────────
  function buildGroupCell(absPath) {
    var td = document.createElement('td');
    var sel = document.createElement('select');
    sel.className = 'group-select';
    sel.disabled = state.uploading;

    var ungrp = document.createElement('option');
    ungrp.value = '';
    ungrp.textContent = '\u2014';
    sel.appendChild(ungrp);

    state.groups.forEach(function(g) {
      var opt = document.createElement('option');
      opt.value = String(g.id);
      opt.textContent = g.label;
      sel.appendChild(opt);
    });

    var curFg = state.fileGroups.find(function(fg) { return fg.filePath === absPath; });
    sel.value = curFg ? String(curFg.groupId) : '';

    (function(ap) {
      sel.addEventListener('change', function() {
        var gid = parseInt(sel.value, 10);

        // Bulk-move: target is a valid group, multiple files selected, this file is selected
        if (!isNaN(gid) && state.selectedFiles.size > 1 && state.selectedFiles.has(ap)) {
          var oldGroupIds = {};
          state.selectedFiles.forEach(function(path) {
            var fg = state.fileGroups.find(function(x) { return x.filePath === path; });
            if (fg) { oldGroupIds[fg.groupId] = true; }
          });
          state.fileGroups = state.fileGroups.filter(function(fg) { return !state.selectedFiles.has(fg.filePath); });
          state.selectedFiles.forEach(function(path) {
            state.fileGroups.push({ filePath: path, groupId: gid });
          });
          if (!state.groupAnchors[gid]) { state.groupAnchors[gid] = ap; }
          Object.keys(oldGroupIds).forEach(function(oid) { reconcileGroup(Number(oid)); });
          state.selectedFiles.clear();
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
          return;
        }

        // Bulk-ungroup: target is "—", multiple files selected, this file is selected
        if (isNaN(gid) && state.selectedFiles.size > 1 && state.selectedFiles.has(ap)) {
          var ungroupOldIds = {};
          state.selectedFiles.forEach(function(path) {
            var fg = state.fileGroups.find(function(x) { return x.filePath === path; });
            if (fg) { ungroupOldIds[fg.groupId] = true; }
          });
          state.fileGroups = state.fileGroups.filter(function(fg) { return !state.selectedFiles.has(fg.filePath); });
          Object.keys(ungroupOldIds).forEach(function(oid) { reconcileGroup(Number(oid)); });
          state.selectedFiles.clear();
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
          return;
        }

        // Single-file behavior (unchanged)
        var oldFg = state.fileGroups.find(function(fg) { return fg.filePath === ap; });
        var oldGroupId = oldFg ? oldFg.groupId : null;
        state.fileGroups = state.fileGroups.filter(function(fg) { return fg.filePath !== ap; });
        if (!isNaN(gid)) {
          state.fileGroups.push({ filePath: ap, groupId: gid });
          if (!state.groupAnchors[gid]) { state.groupAnchors[gid] = ap; }
        }
        if (oldGroupId !== null) { reconcileGroup(oldGroupId); }
        buildFileTable(container, filterStr, openFileRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(absPath));

    td.appendChild(sel);
    return { td: td, curFg: curFg };
  }

  function buildCheckboxCell(row) {
    var td = document.createElement('td');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedFiles.has(row.absPath);
    (function(ap) {
      cb.addEventListener('change', function() {
        if (cb.checked) { state.selectedFiles.add(ap); }
        else            { state.selectedFiles.delete(ap); }
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(row.absPath));
    td.appendChild(cb);
    return td;
  }

  function buildSwitchFolderCell(row) {
    var td = document.createElement('td');
    if (row.kind !== 'open') { return td; }
    td.className = 'pin-cell';
    var swSpan = document.createElement('span');
    swSpan.className = 'hover-icon' + (state.uploading ? ' disabled' : '');
    swSpan.textContent = '\u2197';
    swSpan.title = state.uploading
      ? 'Folder switching is disabled while an upload is running'
      : 'Switch local folder to this file\u2019s folder';
    (function(fp) {
      swSpan.addEventListener('click', function(e) {
        e.stopPropagation();
        if (state.uploading) { return; }
        vscode.postMessage({ kind: 'switchFolder', payload: { folderPath: fp } });
      });
    }(row.folderPath));
    td.appendChild(swSpan);
    return td;
  }

  function buildFileRow(row) {
    var tr = document.createElement('tr');
    if (row.kind === 'open') { tr.className = 'open-file-row'; }
    tr.dataset.filepath = row.absPath;

    var tdName = document.createElement('td');
    tdName.className = 'filename-cell';
    tdName.textContent = row.fileName;

    var tdStatus = document.createElement('td');
    tdStatus.className = 'file-status-cell';

    if (state.mode === 'zip_gun') {
      var gr = buildGroupCell(row.absPath);
      if (gr.curFg) {
        tr.className += (tr.className ? ' ' : '') + 'group-color-' + ((gr.curFg.groupId - 1) % 8 + 1);
        tr.dataset.groupid = String(gr.curFg.groupId);
        var gst = state.groupUploadStatuses[gr.curFg.groupId];
        if (gst) { renderStatusTrail(tdStatus, gst); }
      }
      tr.appendChild(buildCheckboxCell(row));
      tr.appendChild(gr.td);
      tr.appendChild(buildPinCell(row.absPath, state.anchorFile === row.absPath));
      tr.appendChild(buildSwitchFolderCell(row));
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
    } else {
      var fst = state.fileUploadStatuses[row.absPath];
      if (fst) { renderStatusTrail(tdStatus, fst); }
      tr.appendChild(buildCheckboxCell(row));
      tr.appendChild(buildPinCell(row.absPath, state.anchorFile === row.absPath));
      tr.appendChild(buildSwitchFolderCell(row));
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
    }

    (function(ap) {
      tr.addEventListener('dblclick', function() {
        vscode.postMessage({ kind: 'openFileInEditor', payload: { filePath: ap } });
      });
    }(row.absPath));

    return tr;
  }

  if (state.mode === 'zip_gun') {
    state.groups.forEach(function(group) {
      var memberCount = state.fileGroups.filter(function(fg) { return fg.groupId === group.id; }).length;
      var members = visibleRows.filter(function(row) {
        return state.fileGroups.some(function(fg) {
          return fg.groupId === group.id && fg.filePath === row.absPath;
        });
      });

      var headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row' + (state.selectedFiles.size > 0 ? ' move-target' : '');
      headerTr.dataset.groupid = String(group.id);
      var headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '6');
      headerTd.style.padding = '0';

      // Inner div: flex container + background color (avoids display:flex on <td> clipping background)
      var headerContent = document.createElement('div');
      headerContent.className = 'group-header-content group-color-' + ((group.id - 1) % 8 + 1);

      var caret = document.createElement('span');
      caret.textContent = (state.groupCollapsed[group.id] ? '\u25b8' : '\u25be') + ' ';
      headerContent.appendChild(caret);

      // Per-group upload status icon (zipping / uploading / done / error)
      var groupStatusIcon = document.createElement('span');
      groupStatusIcon.className = 'group-status-icon';
      var gstatus = state.groupUploadStatuses[group.id];
      if (gstatus) { renderStatusTrail(groupStatusIcon, gstatus); }
      headerContent.appendChild(groupStatusIcon);

      var labelSpan = document.createElement('span');
      labelSpan.textContent = group.label;
      headerContent.appendChild(labelSpan);
      headerContent.appendChild(document.createTextNode(' \u2014 '));

      var zipNameSpan = document.createElement('span');
      zipNameSpan.className = 'group-zip-name';
      zipNameSpan.textContent = computeZipNameForGroup(group);
      zipNameSpan.title = 'The archive filename that will be created on the server for this group';
      headerContent.appendChild(zipNameSpan);

      var countSpan = document.createElement('span');
      countSpan.className = 'group-file-count';
      countSpan.textContent = ' (' + memberCount + ' files)';
      headerContent.appendChild(countSpan);

      // Clear group icon (removes file assignments, keeps group)
      var clearIcon = document.createElement('span');
      clearIcon.className = 'group-clear-icon';
      clearIcon.textContent = '\u2296';
      clearIcon.title = 'Clear group (remove files, keep group)';
      (function(gid) {
        clearIcon.addEventListener('click', function(e) {
          e.stopPropagation();
          if (state.uploading) { return; }
          state.fileGroups = state.fileGroups.filter(function(fg) { return fg.groupId !== gid; });
          delete state.groupAnchors[gid];
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
        });
      }(group.id));
      headerContent.appendChild(clearIcon);

      // Delete group icon (removes files AND group)
      var deleteIcon = document.createElement('span');
      deleteIcon.className = 'group-delete-icon';
      deleteIcon.textContent = '\u2715';
      deleteIcon.title = 'Delete group (files revert to ungrouped)';
      (function(gid) {
        deleteIcon.addEventListener('click', function(e) {
          e.stopPropagation();
          if (state.uploading) { return; }
          state.fileGroups = state.fileGroups.filter(function(fg) { return fg.groupId !== gid; });
          delete state.groupAnchors[gid];
          delete state.groupCollapsed[gid];
          state.groups = state.groups.filter(function(g) { return g.id !== gid; });
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
        });
      }(group.id));
      headerContent.appendChild(deleteIcon);

      headerTd.appendChild(headerContent);
      headerTr.appendChild(headerTd);
      headerTr.addEventListener('click', function() {
        if (state.uploading) { return; }
        if (state.selectedFiles.size > 0) {
          var checked = Array.from(state.selectedFiles);
          var affectedGroups = new Set();
          checked.forEach(function(fp) {
            var existing = state.fileGroups.find(function(fg) { return fg.filePath === fp; });
            if (existing) { affectedGroups.add(existing.groupId); }
            state.fileGroups = state.fileGroups.filter(function(fg) { return fg.filePath !== fp; });
            state.fileGroups.push({ filePath: fp, groupId: group.id });
          });
          affectedGroups.forEach(reconcileGroup);
          if (!state.groupAnchors[group.id]) { state.groupAnchors[group.id] = checked.slice().sort()[0]; }
          state.selectedFiles.clear();
          persistState();
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
          return;
        }
        state.groupCollapsed[group.id] = !state.groupCollapsed[group.id];
        persistState();
        buildFileTable(container, filterStr, openFileRows);
      });
      tbody.appendChild(headerTr);

      if (!state.groupCollapsed[group.id]) {
        members.forEach(function(row) {
          tbody.appendChild(buildFileRow(row));
        });
      }
    });

    var ungroupedFiles = visibleRows.filter(function(row) {
      return !state.fileGroups.some(function(fg) { return fg.filePath === row.absPath; });
    });
    var ungroupedHeaderTr = document.createElement('tr');
    ungroupedHeaderTr.className = 'group-header-row';
    var ungroupedHeaderTd = document.createElement('td');
    ungroupedHeaderTd.setAttribute('colspan', '6');
    ungroupedHeaderTd.style.padding = '0';
    var ungroupedContent = document.createElement('div');
    ungroupedContent.className = 'group-header-content';
    var ungroupedCaret = document.createElement('span');
    ungroupedCaret.textContent = (state.ungroupedCollapsed ? '\u25b8' : '\u25be') + ' ';
    ungroupedContent.appendChild(ungroupedCaret);
    ungroupedContent.appendChild(document.createTextNode('Ungrouped'));
    var ungroupedCount = document.createElement('span');
    ungroupedCount.className = 'group-file-count';
    ungroupedCount.textContent = ' (' + ungroupedFiles.length + ' files) \u2014 will not be uploaded';
    ungroupedContent.appendChild(ungroupedCount);
    ungroupedHeaderTd.appendChild(ungroupedContent);
    ungroupedHeaderTr.appendChild(ungroupedHeaderTd);
    ungroupedHeaderTr.addEventListener('click', function() {
      state.ungroupedCollapsed = !state.ungroupedCollapsed;
      buildFileTable(container, filterStr, openFileRows);
    });
    tbody.appendChild(ungroupedHeaderTr);

    if (!state.ungroupedCollapsed) {
      ungroupedFiles.forEach(function(row) {
        tbody.appendChild(buildFileRow(row));
      });
    }
  } else {
    visibleRows.forEach(function(row) {
      tbody.appendChild(buildFileRow(row));
    });
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
  wrap.scrollTop = _prevScroll;
}

function buildCollapsibleHeader(sectionKey, labelText, count) {
  var collapsed = state.sectionCollapsed[sectionKey];
  var header = el('div', { className: 'section-header' });
  var arrow = collapsed ? '\u25b8' : '\u25be';
  var countStr = count !== undefined ? ' (' + count + ')' : '';
  var headerBtn = el('button', { className: 'secondary section-toggle', title: 'Click to collapse or expand' }, arrow + ' ' + labelText + countStr);
  headerBtn.addEventListener('click', function () {
    state.sectionCollapsed[sectionKey] = !state.sectionCollapsed[sectionKey];
    persistState();
    render();
  });
  header.appendChild(headerBtn);
  return header;
}

function buildHistory(container) {
  clearEl(container);
  if (state.history.length === 0) {
    container.appendChild(el('p', null, 'No history yet.'));
    return;
  }
  state.history.forEach(function (entry) {
    var div = el('div', { className: 'history-entry' + (entry.result === 'error' ? ' error' : '') });
    div.appendChild(el('span', null, entry.timestamp + ' '));
    div.appendChild(el('strong', null, entry.presetName));
    div.appendChild(el('span', null, ' [' + entry.mode + '] ' + entry.files.join(', ') + ' \u2192 ' + entry.remoteFile));
    var resultText = entry.result === 'success' ? ' \u2713' : ' \u2717 ' + (entry.errorMessage || '');
    div.appendChild(el('span', null, resultText));
    container.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Remote browse overlay
// ---------------------------------------------------------------------------

function renderRemoteBrowseOverlay(app) {
  clearEl(app);
  var browse = state.remoteBrowse;

  // Determine which preset to browse with based on context
  var presetName;
  if (state.remoteBrowseCtx === 'form-default' || state.remoteBrowseCtx === 'form-bookmark') {
    presetName = state.editingPreset ? state.editingPreset.name : '';
  } else {
    var activePreset = getSelectedPreset();
    presetName = activePreset ? activePreset.name : '';
  }

  var overlay = el('div', { className: 'overlay' });

  // Path input row (direct navigation)
  var pathRow = el('div', { style: 'display:flex;align-items:center;margin-bottom:8px;gap:4px;' });
  var pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.value = browse.path || '/';
  pathInput.style.flex = '1';
  var goBtn = el('button', { className: 'secondary' }, 'Go');
  pathRow.appendChild(pathInput);
  pathRow.appendChild(goBtn);
  overlay.appendChild(pathRow);

  function navigateTo(targetPath) {
    var p = targetPath.trim() || '/';
    state.remoteBrowse = { path: p, entries: [], loading: true };
    render();
    vscode.postMessage({ kind: 'browseRemoteDir', payload: { presetName: presetName, path: p } });
  }

  goBtn.addEventListener('click', function () { navigateTo(pathInput.value); });
  pathInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { navigateTo(pathInput.value); }
  });

  // Breadcrumb
  var breadcrumb = el('div', { className: 'breadcrumb' });
  var rawPath = browse.path || '/';
  var segments = rawPath.split('/');
  var accumulated = '';
  segments.forEach(function (seg, idx) {
    accumulated = idx === 0 ? '/' : accumulated.replace(/\/$/, '') + '/' + seg;
    var finalPath = accumulated;

    if (idx > 0) {
      breadcrumb.appendChild(el('span', { className: 'sep' }, '/'));
    }

    var crumb = el('span', { style: 'cursor:pointer;text-decoration:underline;' }, seg || '/');
    crumb.addEventListener('click', function () {
      navigateTo(finalPath);
    });
    breadcrumb.appendChild(crumb);
  });
  overlay.appendChild(breadcrumb);

  // Directory list or loading spinner
  if (browse.loading) {
    var loadingDiv = el('div', { style: 'padding:16px 0;' });
    loadingDiv.appendChild(el('span', { className: 'spinner' }, '\u29D7'));
    loadingDiv.appendChild(el('span', { style: 'margin-left:8px;opacity:0.7;' }, 'Loading\u2026'));
    overlay.appendChild(loadingDiv);
  } else {
    var dirs = (browse.entries || []).filter(function (e) { return e.type === 'd'; });
    var ul = el('ul', { className: 'dir-list' });
    if (dirs.length === 0) {
      var emptyLi = el('li', { style: 'cursor:default;' }, '(no subdirectories)');
      ul.appendChild(emptyLi);
    }
    dirs.forEach(function (entry) {
      var li = document.createElement('li');
      li.textContent = entry.name;
      li.addEventListener('click', function () {
        var newPath = browse.path.replace(/\/$/, '') + '/' + entry.name;
        navigateTo(newPath);
      });
      ul.appendChild(li);
    });
    overlay.appendChild(ul);
  }

  // Action buttons
  var btnRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;' });

  // Primary: select the current path and exit browse mode
  var selectBtn = el('button', null, '\u2713 Use this path');
  selectBtn.disabled = !!browse.loading;
  selectBtn.addEventListener('click', function () {
    var chosen = browse.path || '/';
    if (state.remoteBrowseCtx === 'form-default') {
      if (state.formDraft) { state.formDraft.remoteDir = chosen; }
    } else if (state.remoteBrowseCtx === 'form-bookmark') {
      if (state.formDraft && !state.formDraft.savedPaths.includes(chosen)) {
        state.formDraft.savedPaths.push(chosen);
      }
    } else {
      // 'send-to' context — set as the one-time path selection
      state.selectedPath = chosen;
      state.addPathValue = '';
    }
    state.remoteBrowse = null;
    state.remoteBrowseCtx = null;
    render();
  });
  btnRow.appendChild(selectBtn);

  var pinBtn = el('button', { className: 'secondary' }, '\uD83D\uDCCC Pin as default');
  pinBtn.disabled = !!browse.loading;
  pinBtn.addEventListener('click', function () {
    vscode.postMessage({ kind: 'pinFolder', payload: { presetName: presetName, remotePath: browse.path } });
  });
  btnRow.appendChild(pinBtn);

  var bookmarkBtn = el('button', { className: 'secondary' }, '\uD83D\uDD16 Bookmark');
  bookmarkBtn.disabled = !!browse.loading;
  bookmarkBtn.addEventListener('click', function () {
    vscode.postMessage({ kind: 'bookmarkPath', payload: { presetName: presetName, remotePath: browse.path } });
  });
  btnRow.appendChild(bookmarkBtn);

  var cancelBtn = el('button', { className: 'secondary' }, '\u2715 Cancel');
  cancelBtn.addEventListener('click', function () {
    state.remoteBrowse = null;
    state.remoteBrowseCtx = null;
    render();
  });
  btnRow.appendChild(cancelBtn);

  overlay.appendChild(btnRow);
  app.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Manage view
// ---------------------------------------------------------------------------

function renderManageView(app) {
  // Account cards

  // Account cards
  state.presets.forEach(function (p) {
    var card = el('div', { className: 'preset-card' });

    var headerDiv = el('div', { style: 'display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;' });
    headerDiv.appendChild(el('strong', null, p.name));
    if (p.readOnly) {
      headerDiv.appendChild(el('span', { className: 'badge-readonly', title: 'Stat, delete, and mkdir are disabled \u2014 used for drop-box servers that reject management commands' }, '\uD83D\uDD12 drop-box'));
    }

    // Connection status indicator
    var cs = state.connectionStatus[p.name];
    if (cs === 'pending') {
      headerDiv.appendChild(el('span', { className: 'spinner' }, '\u29D7'));
    } else if (cs === 'ok') {
      headerDiv.appendChild(el('span', { className: 'conn-ok' }, '\u2713 Connected'));
    } else if (cs === 'fail') {
      headerDiv.appendChild(el('span', { className: 'conn-fail' }, '\u2717 Failed'));
    }

    if (state.newPresetNames[p.name]) {
      headerDiv.appendChild(el('span', { className: 'badge-new', title: 'This preset was added in the current session' }, 'NEW'));
    }

    card.appendChild(headerDiv);

    var detail = el('div', { style: 'margin-top:2px;' }, p.host + ':' + p.port + '  \u2022  ' + p.username);
    card.appendChild(detail);

    var detailDir = el('div', { style: 'font-size:0.85em;opacity:0.8;' }, 'Default: ' + (p.remoteDir || '/'));
    card.appendChild(detailDir);

    if (p.savedPaths && p.savedPaths.length > 0) {
      var detailBm = el('div', { style: 'font-size:0.85em;opacity:0.8;' }, 'Bookmarks: ' + p.savedPaths.join(', '));
      card.appendChild(detailBm);
    }

    var btnRow = el('div', { style: 'margin-top:6px;' });

    var editBtn = el('button', { className: 'secondary' }, 'Edit');
    editBtn.addEventListener('click', (function (preset) {
      return function () {
        delete state.newPresetNames[preset.name]; // clear NEW badge on edit
        state.editingPreset = preset;
        state.showPresetForm = true;
        state.formAuthType = preset.authType;
        state.formDraft = null; // clear any stale draft
        render();
      };
    }(p)));
    btnRow.appendChild(editBtn);

    var testBtn = el('button', { className: 'secondary', style: 'margin-left:6px;' }, 'Test');
    testBtn.addEventListener('click', (function (preset) {
      return function () {
        state.connectionStatus[preset.name] = 'pending';
        pushLog('Testing connection to ' + preset.name + '\u2026', 'info', 'conn');
        vscode.postMessage({ kind: 'testConnection', payload: { presetName: preset.name } });
        render();
      };
    }(p)));
    btnRow.appendChild(testBtn);

    // Inline delete confirmation
    if (state.pendingDeleteName === p.name) {
      var confirmLbl = el('span', { style: 'margin-left:6px;font-size:0.9em;' }, 'Delete "' + p.name + '"?');
      var confirmYes = el('button', { style: 'margin-left:4px;' }, 'Yes, delete');
      var confirmNo  = el('button', { className: 'secondary', style: 'margin-left:4px;' }, 'Cancel');
      (function (presetName) {
        confirmYes.addEventListener('click', function () {
          state.pendingDeleteName = null;
          vscode.postMessage({ kind: 'deletePreset', payload: { name: presetName } });
          render();
        });
        confirmNo.addEventListener('click', function () {
          state.pendingDeleteName = null;
          render();
        });
      }(p.name));
      btnRow.appendChild(confirmLbl);
      btnRow.appendChild(confirmYes);
      btnRow.appendChild(confirmNo);
    } else {
      var deleteBtn = el('button', { className: 'secondary', style: 'margin-left:6px;' }, 'Delete');
      (function (presetName) {
        deleteBtn.addEventListener('click', function () {
          state.pendingDeleteName = presetName;
          render();
        });
      }(p.name));
      btnRow.appendChild(deleteBtn);
    }

    card.appendChild(btnRow);
    app.appendChild(card);
  });

  // Action row
  var rowActions = el('div', { className: 'row' });
  var addBtn = el('button', { title: 'Create a new SFTP connection preset' }, '+ Add Account');
  var importBtn = el('button', { className: 'secondary', style: 'margin-left:8px;', title: 'Import SFTP accounts from a FileZilla Site Manager XML export' }, 'Import from FileZilla\u2026');
  importBtn.disabled = state.importPending;
  rowActions.appendChild(addBtn);
  rowActions.appendChild(importBtn);
  if (state.importPending) {
    rowActions.appendChild(el('span', { className: 'spinner', style: 'margin-left:8px;' }, '\u29D7'));
    rowActions.appendChild(el('span', { style: 'margin-left:4px;opacity:0.7;' }, 'Importing\u2026'));
  }
  app.appendChild(rowActions);

  // Preset form section
  var formSection = el('div', { id: 'preset-form-section' });
  app.appendChild(formSection);
  if (state.showPresetForm) {
    buildPresetForm(formSection);
  }

  // Log output
  var rowLog = el('div', { className: 'row', style: 'flex-direction:column;align-items:stretch;' });
  renderLogFilterBar(rowLog);
  buildLogBox(rowLog);
  app.appendChild(rowLog);

  // Listeners
  addBtn.addEventListener('click', function () {
    state.editingPreset = null;
    state.showPresetForm = true;
    state.formAuthType = 'password';
    state.formDraft = null; // clear stale draft
    render();
  });

  importBtn.addEventListener('click', function () {
    state.importPending = true;
    render();
    vscode.postMessage({ kind: 'importFileZilla' });
  });
}

// ---------------------------------------------------------------------------
// Preset / Account form
// ---------------------------------------------------------------------------

function buildPresetForm(container) {
  var isNew = state.editingPreset === null;
  // Use formDraft when available — it preserves edits across browse round-trips
  var p = state.formDraft || state.editingPreset || {
    name: '', host: '', port: 22, username: '', remoteDir: '',
    savedPaths: [], authType: 'password', keyPath: '', readOnly: false
  };

  // Sync formAuthType from formDraft if present (in case user changed it before browsing)
  if (state.formDraft && state.formDraft.authType) {
    state.formAuthType = state.formDraft.authType;
  }

  // Declare vars used across closures up front (var-hoisted, assigned below)
  var pwInput = null;
  var keyInput = null;
  var ppInput  = null;
  var readonlyCheck = null;

  var card = el('div', { className: 'preset-card' });

  card.appendChild(el('h3', { style: 'margin-top:0;' }, isNew ? 'Add Account' : 'Edit Account'));

  function makeTextInput(labelText, value, placeholder) {
    var row = el('div', { className: 'row' });
    row.appendChild(el('label', null, labelText));
    var input = document.createElement('input');
    input.type = 'text';
    input.value = String(value == null ? '' : value);
    if (placeholder) { input.placeholder = placeholder; }
    row.appendChild(input);
    card.appendChild(row);
    return input;
  }

  var nameInput = makeTextInput('Name', p.name, 'My Server');
  var hostInput = makeTextInput('Host', p.host, 'sftp.example.com');

  // Port row (number input)
  var rowPort = el('div', { className: 'row' });
  rowPort.appendChild(el('label', null, 'Port'));
  var portInput = document.createElement('input');
  portInput.type = 'number';
  portInput.value = String(p.port || 22);
  portInput.min = '1';
  portInput.max = '65535';
  rowPort.appendChild(portInput);
  card.appendChild(rowPort);

  var userInput = makeTextInput('Username', p.username, 'username');

  // Default path row with Browse button
  var rowDir = el('div', { className: 'row' });
  rowDir.appendChild(el('label', null, 'Default path'));
  var dirInput = document.createElement('input');
  dirInput.type = 'text';
  dirInput.value = String(p.remoteDir != null ? p.remoteDir : '');
  dirInput.placeholder = '/uploads';
  dirInput.style.flex = '1';
  rowDir.appendChild(dirInput);
  var browseDefaultBtn = el('button', { className: 'secondary' }, '\uD83D\uDCC2');
  browseDefaultBtn.title = 'Browse remote\u2026';
  browseDefaultBtn.disabled = isNew;
  rowDir.appendChild(browseDefaultBtn);
  card.appendChild(rowDir);

  if (isNew) {
    card.appendChild(el('div', { style: 'font-size:0.8em;opacity:0.6;margin-bottom:6px;padding-left:124px;' },
      'Save the account first to enable remote browsing.'));
  }

  // Bookmarks — use formDraft.savedPaths directly (mutable) when available, else a copy
  var localSavedPaths = state.formDraft ? state.formDraft.savedPaths : (p.savedPaths || []).slice();

  var rowBm = el('div', { className: 'row', style: 'align-items:flex-start;' });
  rowBm.appendChild(el('label', null, 'Bookmarks'));
  var bmOuter = el('div', { style: 'flex:1;' });
  var bmContainer = el('div');
  bmOuter.appendChild(bmContainer);
  var browseAddBmBtn = el('button', { className: 'secondary', style: 'margin-top:4px;' }, '\uD83D\uDCC2 Browse & add\u2026');
  browseAddBmBtn.disabled = isNew;
  bmOuter.appendChild(browseAddBmBtn);
  rowBm.appendChild(bmOuter);
  card.appendChild(rowBm);

  function renderBookmarks() {
    clearEl(bmContainer);
    if (localSavedPaths.length === 0) {
      bmContainer.appendChild(el('span', { style: 'opacity:0.6;font-size:0.85em;' }, '(none)'));
    } else {
      localSavedPaths.forEach(function (sp, idx) {
        var bmRow = el('div', { style: 'display:flex;align-items:center;gap:4px;margin-bottom:4px;' });
        bmRow.appendChild(el('span', { style: 'flex:1;font-size:0.9em;' }, sp));
        var setDefaultBmBtn = el('button', { className: 'secondary' }, 'Set as default');
        var removeBtn = el('button', { className: 'secondary' }, '\u2715 Remove');
        (function (i) {
          setDefaultBmBtn.addEventListener('click', function () {
            var oldDefault = dirInput.value.trim();
            var newDefault = localSavedPaths[i];
            dirInput.value = newDefault;
            localSavedPaths.splice(i, 1);
            if (oldDefault && !localSavedPaths.includes(oldDefault)) {
              localSavedPaths.push(oldDefault);
            }
            renderBookmarks();
          });
          removeBtn.addEventListener('click', function () {
            localSavedPaths.splice(i, 1);
            renderBookmarks();
          });
        }(idx));
        bmRow.appendChild(setDefaultBmBtn);
        bmRow.appendChild(removeBtn);
        bmContainer.appendChild(bmRow);
      });
    }
  }
  renderBookmarks();

  // Helper: snapshot current form field values into formDraft before browsing
  function captureFormDraft() {
    state.formDraft = {
      name:       nameInput.value.trim(),
      host:       hostInput.value.trim(),
      port:       parseInt(portInput.value, 10) || 22,
      username:   userInput.value.trim(),
      remoteDir:  dirInput.value.trim(),
      savedPaths: localSavedPaths.slice(),
      authType:   state.formAuthType,
      keyPath:    (state.formAuthType === 'key' && keyInput) ? keyInput.value.trim() : (p.keyPath || ''),
      readOnly:   readonlyCheck ? readonlyCheck.checked : !!p.readOnly,
    };
  }

  browseDefaultBtn.addEventListener('click', function () {
    if (!state.editingPreset) { return; }
    captureFormDraft();
    state.remoteBrowseCtx = 'form-default';
    var startPath = dirInput.value.trim() || '/';
    state.remoteBrowse = { path: startPath, entries: [], loading: true };
    render();
    vscode.postMessage({ kind: 'browseRemoteDir', payload: { presetName: state.editingPreset.name, path: startPath } });
  });

  browseAddBmBtn.addEventListener('click', function () {
    if (!state.editingPreset) { return; }
    captureFormDraft();
    state.remoteBrowseCtx = 'form-bookmark';
    var startPath = dirInput.value.trim() || '/';
    state.remoteBrowse = { path: startPath, entries: [], loading: true };
    render();
    vscode.postMessage({ kind: 'browseRemoteDir', payload: { presetName: state.editingPreset.name, path: startPath } });
  });

  // Auth type row
  var rowAuth = el('div', { className: 'row' });
  rowAuth.appendChild(el('label', null, 'Auth type'));

  var lblPw = document.createElement('label');
  lblPw.style.minWidth = 'unset';
  var radioPw = document.createElement('input');
  radioPw.type = 'radio';
  radioPw.name = 'authtype';
  radioPw.value = 'password';
  radioPw.checked = state.formAuthType === 'password';
  lblPw.appendChild(radioPw);
  lblPw.appendChild(document.createTextNode(' Password'));
  rowAuth.appendChild(lblPw);

  var lblKey = document.createElement('label');
  lblKey.style.cssText = 'min-width:unset;margin-left:8px;';
  var radioKey = document.createElement('input');
  radioKey.type = 'radio';
  radioKey.name = 'authtype';
  radioKey.value = 'key';
  radioKey.checked = state.formAuthType === 'key';
  lblKey.appendChild(radioKey);
  lblKey.appendChild(document.createTextNode(' Key file'));
  rowAuth.appendChild(lblKey);

  card.appendChild(rowAuth);

  // Dynamic auth fields container
  var authFields = el('div', { id: 'f-auth-fields' });
  card.appendChild(authFields);

  function renderAuthFields() {
    clearEl(authFields);
    if (state.formAuthType === 'password') {
      var rowPw = el('div', { className: 'row' });
      rowPw.appendChild(el('label', null, 'Password'));
      pwInput = document.createElement('input');
      pwInput.type = 'password';
      pwInput.placeholder = 'Leave blank to keep existing';
      rowPw.appendChild(pwInput);
      authFields.appendChild(rowPw);
      keyInput = null;
      ppInput  = null;
    } else {
      var rowKey = el('div', { className: 'row' });
      rowKey.appendChild(el('label', null, 'Key path'));
      keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.value = p.keyPath || '';
      keyInput.placeholder = '/home/user/.ssh/id_rsa';
      rowKey.appendChild(keyInput);
      authFields.appendChild(rowKey);

      var rowPp = el('div', { className: 'row' });
      rowPp.appendChild(el('label', null, 'Passphrase'));
      ppInput = document.createElement('input');
      ppInput.type = 'password';
      ppInput.placeholder = 'Leave blank to keep existing';
      rowPp.appendChild(ppInput);
      authFields.appendChild(rowPp);
      pwInput = null;
    }
  }

  renderAuthFields();

  radioPw.addEventListener('change', function () {
    if (radioPw.checked) { state.formAuthType = 'password'; renderAuthFields(); }
  });
  radioKey.addEventListener('change', function () {
    if (radioKey.checked) { state.formAuthType = 'key'; renderAuthFields(); }
  });

  // Read-only toggle
  var rowReadOnly = el('div', { className: 'row' });
  var lblReadOnly = document.createElement('label');
  lblReadOnly.style.minWidth = 'unset';
  readonlyCheck = document.createElement('input');
  readonlyCheck.type = 'checkbox';
  readonlyCheck.checked = !!p.readOnly;
  lblReadOnly.appendChild(readonlyCheck);
  lblReadOnly.appendChild(document.createTextNode(' Drop-box server (no stat/delete)'));
  rowReadOnly.appendChild(lblReadOnly);
  card.appendChild(rowReadOnly);

  var rowNote = el('div', { className: 'row', style: 'font-size:0.8em;opacity:0.7;' },
    'Enable for intake servers that reject management operations.');
  card.appendChild(rowNote);

  // Buttons
  var rowBtns = el('div', { className: 'row' });
  var saveBtn   = el('button', null, 'Save');
  var cancelBtn = el('button', { className: 'secondary', style: 'margin-left:8px;' }, 'Cancel');
  rowBtns.appendChild(saveBtn);
  rowBtns.appendChild(cancelBtn);
  card.appendChild(rowBtns);

  container.appendChild(card);

  saveBtn.addEventListener('click', function () {
    var resolvedAuthType = state.formAuthType;
    var preset = {
      name:       nameInput.value.trim(),
      host:       hostInput.value.trim(),
      port:       parseInt(portInput.value, 10) || 22,
      username:   userInput.value.trim(),
      remoteDir:  dirInput.value.trim(),
      savedPaths: localSavedPaths,
      authType:   resolvedAuthType,
      keyPath:    (resolvedAuthType === 'key' && keyInput) ? keyInput.value.trim() : '',
      readOnly:   readonlyCheck.checked,
    };
    if (!preset.name || !preset.host || !preset.username) {
      pushLog('Name, Host, and Username are required.', 'error', 'accounts');
      render();
      return;
    }
    var payload = { preset: preset, isNew: isNew };
    if (!isNew && state.editingPreset && state.editingPreset.name !== preset.name) {
      payload.originalName = state.editingPreset.name;
    }
    if (resolvedAuthType === 'password' && pwInput && pwInput.value) {
      payload.password = pwInput.value;
    }
    if (resolvedAuthType === 'key' && ppInput && ppInput.value) {
      payload.passphrase = ppInput.value;
    }
    state.formDraft = null; // clear on save
    vscode.postMessage({ kind: 'savePreset', payload: payload });
  });

  cancelBtn.addEventListener('click', function () {
    state.showPresetForm = false;
    state.editingPreset = null;
    state.formDraft = null; // clear on cancel
    render();
  });
}

// ---------------------------------------------------------------------------
// Init sequence
// ---------------------------------------------------------------------------

// 'ready' causes the host to respond with presets, state, and history in one shot.

// bootstrap.js — extracted from media/panel.js
// Final ready/render bootstrap. This fragment must load after renderers.js.

vscode.postMessage({ kind: 'ready' });

render();
