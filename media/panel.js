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
  selectedPath: null,       // string | null — selected remote path ('__add_new__' = add-path mode)
  addPathValue: '',         // string — text in the "add new path" input
  pendingDeleteName: null,  // string | null — preset name awaiting inline delete confirmation
  uploadProgressText: null, // string | null — live upload progress shown in log box footer
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
    }
  });
}

function getSelectedPreset() {
  return state.presets.find(function (p) { return p.name === state.selectedPresetName; }) || null;
}

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

function formatBytes(n) {
  if (!n || n === 0) { return '\u2014'; }
  if (n < 1024) { return n + ' B'; }
  if (n < 1048576) { return (n / 1024).toFixed(1) + ' KB'; }
  return (n / 1048576).toFixed(1) + ' MB';
}

function computeZipName() {
  if (!state.anchorFile) { return ''; }
  var base = state.anchorFile.replace(/\\/g, '/').split('/').pop() || '';
  var noExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return noExt + '_' + formatTimestamp(new Date()) + '.zip';
}

function isAnchorFile(fileName) {
  if (!state.anchorFile) { return false; }
  var base = state.anchorFile.replace(/\\/g, '/').split('/').pop();
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
    var name = fp.replace(/\\/g, '/').split('/').pop() || fp;
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

window.addEventListener('message', function (event) {
  var msg = event.data;
  switch (msg.kind) {

    case 'filesListed': {
      var p = msg.payload;
      state.folderPath = p.folderPath;
      state.files = p.files;
      state.anchorFile = null;
      state.zipBaseName = null;
      var folder = (p.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
      state.selectedFiles = new Set(
        p.files
          .filter(function (f) { return !f.isDirectory; })
          .map(function (f) { return folder ? folder + '/' + f.name : f.name; })
      );
      persistState();
      break;
    }

    case 'uploadProgress': {
      var p = msg.payload;
      state.uploadProgressText = (p.currentFile ? p.currentFile + ' \u2014 ' : '') + p.percent + '%';
      break;
    }

    case 'uploadDone': {
      var p = msg.payload;
      state.uploading = false;
      state.uploadProgressText = null;
      var bytesInfo = p.bytesTransferred > 0 ? ' \u00b7 ' + formatBytes(p.bytesTransferred) : '';
      pushLog('Complete \u2192 ' + p.remoteFile + bytesInfo, 'success', 'upload');
      break;
    }

    case 'uploadError': {
      var p = msg.payload;
      state.uploading = false;
      state.uploadProgressText = null;
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
  rowSendTo.appendChild(el('label', null, 'Send to'));

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
  changeFolderBtn.appendChild(document.createTextNode('\uD83D\uDCC2 '));
  var _pathSpan = document.createElement('span');
  _pathSpan.className = 'folder-path-text';
  _pathSpan.textContent = state.folderPath ? state.folderPath.replace(/\\/g, '/') : 'Change\u2026';
  changeFolderBtn.appendChild(_pathSpan);
  rowFolder.appendChild(changeFolderBtn);
  app.appendChild(rowFolder);

  // ---- Mode toggle — three-way segmented button ----
  var rowMode = el('div', { className: 'row' });
  rowMode.appendChild(el('label', null, 'Mode'));
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
        state.selectedFiles.clear();
        state.groups       = [];
        state.fileGroups   = [];
        state.groupAnchors = {};
        state.nextGroupId  = 1;
      } else if (state.mode === 'zip_gun' && item.value !== 'zip_gun') {
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
  var localFolderNorm = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
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
  var localLabel = 'Files' + (state.folderPath ? ' \u2014 ' + (state.folderPath || '').replace(/\\/g, '/').split('/').pop() : '');
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
    resetAllBtn = el('button', { className: 'secondary' }, '\u21ba Reset all');
    if (state.mode === 'zip_gun') {
      newGroupBtn = el('button', { className: 'secondary' }, '\u2192 New Group');
      clearGroupsBtn = el('button', { className: 'secondary' }, '\u00d7 Clear groups');
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
    var folder = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    var selectableCount = state.files.filter(function (f) {
      return !f.isDirectory;
    }).length + openFileRows.length;
    var selectedCount = state.files.filter(function (f) {
      if (f.isDirectory) { return false; }
      if (isAnchorFile(f.name)) { return true; }
      var absPath = folder ? folder + '/' + f.name : f.name;
      return state.selectedFiles.has(absPath);
    }).length + openFileRows.filter(function(of) {
      return state.selectedFiles.has(of.filePath);
    }).length;
    var label;
    if (selectedCount === 0) {
      label = '\u2611 Select all';
    } else if (selectedCount === selectableCount) {
      label = '\u2610 Deselect all';
    } else {
      label = '\u229f Select all';
    }
    toggleSelectBtn.textContent = label;
    if (state.mode === 'zip_gun') {
      var assignedCount = state.fileGroups.filter(function(fg) { return state.selectedFiles.has(fg.filePath); }).length;
      var gc = state.groups.length;
      counterSpan.textContent = assignedCount + '/' + selectableCount + ' in ' + gc + ' group' + (gc !== 1 ? 's' : '');
    } else {
      counterSpan.textContent = selectedCount + ' / ' + selectableCount;
    }
    updateFireState();
  }
  _updateFileControlsFn = updateFileControls;
  if (!state.sectionCollapsed.local && state.files.length > 0) {
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
      baseInput.addEventListener('input', function() { state.namingBase = baseInput.value; });
      rowBase.appendChild(baseInput);
      app.appendChild(rowBase);
    }
  }

  // ---- ZIP name row ----
  var anchorBase = (state.anchorFile || '').replace(/\\/g, '/').split('/').pop() || '';
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

  // ---- Ungrouped files warning (ZIP Gun mode) ----
  if (state.mode === 'zip_gun' && state.selectedFiles.size > 0) {
    var ungroupedCount = Array.from(state.selectedFiles).filter(function(fp) {
      return !state.fileGroups.find(function(fg) { return fg.filePath === fp; });
    }).length;
    if (ungroupedCount > 0) {
      var warnRow = el('div', { className: 'row group-warning' });
      warnRow.textContent = ungroupedCount + ' checked file' + (ungroupedCount !== 1 ? 's' : '') + ' have no group and will be excluded.';
      app.appendChild(warnRow);
    }
  }

  // ---- Upload controls ----
  var rowUpload = el('div', { className: 'row', style: 'justify-content:center;' });
  var uploadBtn = el('button', { className: 'btn-fire' }, 'FIRE');
  _fireBtnRef = uploadBtn;
  var noFiles = state.mode === 'zip_gun'
    ? !state.fileGroups.some(function(fg) { return state.selectedFiles.has(fg.filePath); })
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
  }
  var stopBtn = el('button', { className: 'btn-hold', style: 'margin-left:12px;' }, 'HOLD');
  stopBtn.disabled = !state.uploading;
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
  var historyBtn = el('button', { className: 'secondary' }, '\uD83D\uDCCB History');
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
      var folder = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
      var selectableFiles = state.files.filter(function (f) { return !f.isDirectory; });
      var allLocalSelected = selectableFiles.every(function (f) {
        var absPath = folder ? folder + '/' + f.name : f.name;
        return state.selectedFiles.has(absPath);
      });
      var allOpenSelected = openFileRows.every(function (of) {
        return state.selectedFiles.has(of.filePath);
      });
      var allSelected = allLocalSelected && allOpenSelected
                     && (selectableFiles.length + openFileRows.length > 0);
      if (allSelected) {
        selectableFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          state.selectedFiles.delete(absPath);
        });
        openFileRows.forEach(function (of) { state.selectedFiles.delete(of.filePath); });
      } else {
        selectableFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          state.selectedFiles.add(absPath);
        });
        openFileRows.forEach(function (of) { state.selectedFiles.add(of.filePath); });
      }
      buildFileTable(fileListContainer, fileFilter.value, openFileRows);
      updateFileControls();
    });

    fileFilter.addEventListener('input', function () {
      buildFileTable(fileListContainer, fileFilter.value, openFileRows);
    });

    if (newGroupBtn) {
      newGroupBtn.addEventListener('click', function() {
        // Assign all selected-but-ungrouped files to a new group
        var ungrouped = Array.from(state.selectedFiles).filter(function(fp) {
          return !state.fileGroups.find(function(fg) { return fg.filePath === fp; });
        });
        if (ungrouped.length === 0) { return; }
        var gid = state.nextGroupId++;
        state.groups.push({ id: gid, label: 'G' + gid });
        ungrouped.forEach(function(fp) {
          state.fileGroups.push({ filePath: fp, groupId: gid });
        });
        // Auto-anchor for the new group
        var sortedUngrouped = ungrouped.slice().sort();
        state.groupAnchors[gid] = sortedUngrouped[0];
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
        state.selectedFiles.clear();
        state.anchorFile   = null;
        state.modeAnchors  = {};
        state.fileGroups   = [];
        state.groups       = [];
        state.groupAnchors = {};
        state.nextGroupId  = 1;
        state.zipBaseName  = null;
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
      // Build groups payload
      var groupPayload = state.groups.map(function(g) {
        var groupFiles = state.fileGroups
          .filter(function(fg) { return fg.groupId === g.id && state.selectedFiles.has(fg.filePath); })
          .map(function(fg) { return fg.filePath; })
          .sort();
        var anchor = state.groupAnchors[g.id] || groupFiles[0] || '';
        return { id: g.id, label: g.label, files: groupFiles, anchorFile: anchor };
      }).filter(function(g) { return g.files.length > 0; });

      if (groupPayload.length === 0) { return; }
      state.uploading = true;
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
    ? !state.fileGroups.some(function(fg) { return state.selectedFiles.has(fg.filePath); })
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

// openFileRows: optional array of {filePath, fileName, folderPath} — open VS Code tabs not in local folder.
// Column order: [checkbox][pin ⚲][↗ switch-folder][filename][group dropdown (zip_gun only)]
function buildFileTable(container, filterStr, openFileRows) {
  var _prevWrap = container.querySelector('.file-table-wrap');
  var _prevScroll = _prevWrap ? _prevWrap.scrollTop : 0;
  clearEl(container);
  var filter = (filterStr || '').toLowerCase();
  var folder = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');

  var localVisible = state.files.filter(function (f) {
    if (f.isDirectory) { return false; }
    if (filter && !f.name.toLowerCase().includes(filter)) { return false; }
    return true;
  });
  var openVisible = (openFileRows || []).filter(function(of) {
    return !filter || of.fileName.toLowerCase().includes(filter);
  });

  if (localVisible.length === 0 && openVisible.length === 0) { return; }

  var wrap = el('div', { className: 'file-table-wrap' });
  var table = el('table', { className: 'file-table' });

  var thead = document.createElement('thead');
  var hrow = document.createElement('tr');
  hrow.appendChild(el('th', null, ''));  // checkbox
  hrow.appendChild(el('th', null, ''));  // pin ⚲
  hrow.appendChild(el('th', null, ''));  // ↗ switch-folder
  hrow.appendChild(el('th', null, 'File (' + (localVisible.length + openVisible.length) + ')'));
  if (state.mode === 'zip_gun') {
    hrow.appendChild(el('th', null, 'Group'));
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
      var fg = state.fileGroups.find(function(x) { return x.filePath === absPath; });
      if (fg) {
        var pinned = state.groupAnchors[fg.groupId] === absPath;
        span.title = pinned ? 'Group anchor' : 'Set as group anchor';
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
        span.title = 'Assign to a group to set anchor';
      }
    } else if (state.mode === 'zip_canon') {
      if (isLocalAnchor) {
        span.title = 'Current anchor';
        span.className = 'pin-icon pin-icon-active';
      } else {
        span.title = 'Set as anchor';
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
        state.fileGroups = state.fileGroups.filter(function(fg) { return fg.filePath !== ap; });
        var gid = parseInt(sel.value, 10);
        if (!isNaN(gid)) {
          state.fileGroups.push({ filePath: ap, groupId: gid });
          if (!state.groupAnchors[gid]) { state.groupAnchors[gid] = ap; }
        }
        buildFileTable(container, filterStr, openFileRows);
      });
    }(absPath));

    td.appendChild(sel);
    return { td: td, curFg: curFg };
  }

  // ── Open-file rows ───────────────────────────────────────────────────────
  openVisible.forEach(function(of) {
    var absPath = of.filePath;
    var tr = document.createElement('tr');
    tr.className = 'open-file-row';

    // Checkbox
    var tdCb = document.createElement('td');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedFiles.has(absPath);
    (function(ap) {
      cb.addEventListener('change', function() {
        if (cb.checked) { state.selectedFiles.add(ap); }
        else            { state.selectedFiles.delete(ap); }
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(absPath));
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);

    // Pin
    tr.appendChild(buildPinCell(absPath, state.anchorFile === absPath));

    // Switch-folder ↗
    var tdSw = document.createElement('td');
    tdSw.className = 'pin-cell';
    var swSpan = document.createElement('span');
    swSpan.className = 'hover-icon';
    swSpan.textContent = '\u2197';
    swSpan.title = 'Switch local folder to this file\u2019s folder';
    (function(fp) {
      swSpan.addEventListener('click', function(e) {
        e.stopPropagation();
        vscode.postMessage({ kind: 'switchFolder', payload: { folderPath: fp } });
      });
    }(of.folderPath));
    tdSw.appendChild(swSpan);
    tr.appendChild(tdSw);

    // Filename
    var tdName = document.createElement('td');
    tdName.textContent = of.fileName;
    tr.appendChild(tdName);

    // Group dropdown
    if (state.mode === 'zip_gun') {
      var gr = buildGroupCell(absPath);
      if (gr.curFg) { tr.className += ' group-color-' + ((gr.curFg.groupId - 1) % 8 + 1); }
      tr.appendChild(gr.td);
    }

    // Double-click to open in editor
    (function(ap) {
      tr.addEventListener('dblclick', function() {
        vscode.postMessage({ kind: 'openFileInEditor', payload: { filePath: ap } });
      });
    }(absPath));

    tbody.appendChild(tr);
  });

  // ── Local file rows ──────────────────────────────────────────────────────
  localVisible.forEach(function (f) {
    var anchor = isAnchorFile(f.name);
    var absPath = folder ? folder + '/' + f.name : f.name;
    var tr = document.createElement('tr');

    // Checkbox
    var tdCb = document.createElement('td');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    if (anchor) {
      cb.disabled = true;
      cb.checked = true;
    } else {
      cb.checked = state.selectedFiles.has(absPath);
      (function(ap) {
        cb.addEventListener('change', function () {
          if (cb.checked) { state.selectedFiles.add(ap); }
          else            { state.selectedFiles.delete(ap); }
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
        });
      }(absPath));
    }
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);

    // Pin
    tr.appendChild(buildPinCell(absPath, anchor));

    // Switch-folder: empty cell for local files (already here)
    tr.appendChild(document.createElement('td'));

    // Filename
    var tdName = document.createElement('td');
    tdName.textContent = f.name;
    tr.appendChild(tdName);

    // Group dropdown
    if (state.mode === 'zip_gun') {
      var gr = buildGroupCell(absPath);
      if (gr.curFg) { tr.className = 'group-color-' + ((gr.curFg.groupId - 1) % 8 + 1); }
      tr.appendChild(gr.td);
    }

    // Double-click to open in editor
    (function(ap) {
      tr.addEventListener('dblclick', function() {
        vscode.postMessage({ kind: 'openFileInEditor', payload: { filePath: ap } });
      });
    }(absPath));

    tbody.appendChild(tr);
  });

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
  var headerBtn = el('button', { className: 'secondary section-toggle' }, arrow + ' ' + labelText + countStr);
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
      headerDiv.appendChild(el('span', { className: 'badge-readonly' }, '\uD83D\uDD12 drop-box'));
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
      headerDiv.appendChild(el('span', { className: 'badge-new' }, 'NEW'));
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
  var addBtn = el('button', null, '+ Add Account');
  var importBtn = el('button', { className: 'secondary', style: 'margin-left:8px;' }, 'Import from FileZilla\u2026');
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
vscode.postMessage({ kind: 'ready' });

render();
