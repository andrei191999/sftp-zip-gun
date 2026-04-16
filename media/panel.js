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
  selectedFiles: new Set(),
  mode: 'zip_canon',        // 'zip_canon' | 'pistol_file' | 'zip_gun'
  folderPath: null,
  uploading: false,
  logs: [],                 // { level: string, text: string, ts: string, category: string }[]
  newPresetNames: {},          // session-only: { [name]: true } for names added this session (cleared on edit)
  logFilter: new Set(['upload', 'conn', 'import', 'accounts', 'sys']),  // session-only
  history: [],              // HistoryEntry[]
  showHistory: false,
  remoteBrowse: null,       // null | { path: string, entries: RemoteEntry[], loading: boolean }
  remoteBrowseCtx: null,    // 'send-to' | 'form-default' | 'form-bookmark' | null
  importPending: false,     // true while FileZilla import is in progress
  zipBaseName: null,        // string | null — user override for zip base name
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
      state.selectedFiles = new Set(
        p.files.filter(function (f) { return !f.isDirectory; }).map(function (f) { return f.name; })
      );
      // Auto-detect anchor as the first XML file in the listing
      var xml = p.files.find(function (f) {
        return !f.isDirectory && f.name.toLowerCase().endsWith('.xml');
      });
      if (xml) {
        var folder = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
        state.anchorFile = (folder ? folder + '/' : '') + xml.name;
      }
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

    case 'state': {
      var p = msg.payload;
      if (p.lastFolder && !state.folderPath)                  { state.folderPath = p.lastFolder; }
      if (p.lastPresetName && !state.selectedPresetName)      { state.selectedPresetName = p.lastPresetName; }
      if (p.mode)                                             { state.mode = p.mode; }
      if (p.anchorFile)                                       { state.anchorFile = p.anchorFile; }
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

function render() {
  var scrollY = window.scrollY || 0;
  var app = document.getElementById('app');
  if (!app) { return; }

  if (state.remoteBrowse !== null) {
    renderRemoteBrowseOverlay(app);
    window.scrollTo(0, scrollY);
    return;
  }

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
  clearEl(app);

  // ---- Account row ----
  var rowDest = el('div', { className: 'row' });
  rowDest.appendChild(el('label', null, 'Account'));

  var select = document.createElement('select');
  select.id = 'preset-select';
  state.presets.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.name;
    var connFail = state.connectionStatus[p.name] === 'fail';
    opt.textContent = (connFail ? '\u26A0 ' : '') + (p.readOnly ? '\uD83D\uDD12 ' : '') + p.name;
    if (p.name === state.selectedPresetName) { opt.selected = true; }
    select.appendChild(opt);
  });
  rowDest.appendChild(select);

  var manageBtn = el('button', { className: 'secondary', style: 'margin-left:8px;' }, '\u2699 Manage');
  rowDest.appendChild(manageBtn);
  app.appendChild(rowDest);

  // ---- Send to row ----
  var preset = getSelectedPreset();
  var sendToSelect = null;
  var addPathInput = null;
  var browseNewBtn = null;
  var setDefaultBtn = null;
  var bookmarkNewBtn = null;
  var useOnceBtn = null;

  var rowSendTo = el('div', { className: 'row' });
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
  var rowFolder = el('div', { className: 'row' });
  rowFolder.appendChild(el('label', null, 'Local folder'));
  var changeFolderBtn = el('button', { className: 'secondary', style: 'margin-left:8px;' }, '\uD83D\uDCC2 Change\u2026');
  rowFolder.appendChild(changeFolderBtn);
  rowFolder.appendChild(el('span', null, state.folderPath || '(none selected)'));
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
    var span = el('span', { className: 'mode-half' + (state.mode === item.value ? ' active' : ''), title: item.title }, item.label);
    span.addEventListener('click', function () {
      state.mode = item.value;
      persistState();
      render();
    });
    modeBtn.appendChild(span);
  });
  rowMode.appendChild(modeBtn);
  app.appendChild(rowMode);

  // ---- File list section ----
  var sectionFiles = el('div', { id: 'section-files' });
  var fileListContainer = null;
  var toggleSelectBtn, counterSpan, fileFilter;
  if (state.files.length > 0) {
    var rowFileCtrl = el('div', { className: 'row' });
    toggleSelectBtn = el('button', { className: 'secondary' }, '');
    counterSpan     = el('span', { style: 'margin-left:6px;' }, '');
    fileFilter      = el('input', { type: 'text', placeholder: 'Filter files\u2026', style: 'margin-left:8px;' });
    rowFileCtrl.appendChild(toggleSelectBtn);
    rowFileCtrl.appendChild(counterSpan);
    rowFileCtrl.appendChild(fileFilter);
    sectionFiles.appendChild(rowFileCtrl);

    var rowFileList = el('div', { className: 'row' });
    fileListContainer = el('div', { id: 'file-list' });
    rowFileList.appendChild(fileListContainer);
    sectionFiles.appendChild(rowFileList);
    buildFileTable(fileListContainer, '');
    updateFileControls();
  }

  function updateFileControls() {
    if (!toggleSelectBtn || !counterSpan) { return; }
    var selectableCount = state.files.filter(function (f) { return !f.isDirectory && !isAnchorFile(f.name); }).length;
    var selectedCount   = state.files.filter(function (f) { return !f.isDirectory && !isAnchorFile(f.name) && state.selectedFiles.has(f.name); }).length;
    var label;
    if (selectedCount === 0) {
      label = '\u2611 Select all';
    } else if (selectedCount === selectableCount) {
      label = '\u2610 Deselect all';
    } else {
      label = '\u229f Select all';
    }
    toggleSelectBtn.textContent = label;
    counterSpan.textContent = selectedCount + ' / ' + selectableCount;
  }
  _updateFileControlsFn = updateFileControls;
  app.appendChild(sectionFiles);

  // ---- ZIP name row ----
  var anchorBase = (state.anchorFile || '').replace(/\\/g, '/').split('/').pop() || '';
  var anchorStem = anchorBase.includes('.') ? anchorBase.slice(0, anchorBase.lastIndexOf('.')) : anchorBase;
  var sectionZip = el('div', { id: 'section-zipname' });
  var zipNameInput = null;
  if (state.mode === 'zip_canon' && state.anchorFile) {
    var rowZip = el('div', { className: 'row' });
    rowZip.appendChild(el('label', null, 'Archive name'));
    zipNameInput = document.createElement('input');
    zipNameInput.type = 'text';
    zipNameInput.value = state.zipBaseName || anchorStem;
    zipNameInput.placeholder = anchorStem + '_YYYYMMDDTHHMMSS.zip';
    zipNameInput.style.flex = '1';
    zipNameInput.addEventListener('input', function () {
      state.zipBaseName = zipNameInput.value.trim() || null;
    });
    rowZip.appendChild(zipNameInput);
    rowZip.appendChild(el('span', { style: 'opacity:0.6;font-size:0.85em;margin-left:4px;' }, '+timestamp.zip'));
    sectionZip.appendChild(rowZip);
  }
  app.appendChild(sectionZip);

  // ---- Upload controls ----
  var rowUpload = el('div', { className: 'row' });
  var uploadBtn = el('button', null, 'FIRE');
  uploadBtn.disabled = state.uploading || !state.selectedPresetName || state.files.length === 0;
  var stopBtn = el('button', { className: 'secondary', style: 'margin-left:8px;' }, 'HOLD');
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

  manageBtn.addEventListener('click', function () {
    state.view = 'manage';
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

  if (state.files.length > 0 && fileListContainer) {
    toggleSelectBtn.addEventListener('click', function () {
      var selectableFiles = state.files.filter(function (f) { return !f.isDirectory && !isAnchorFile(f.name); });
      var allSelected = selectableFiles.every(function (f) { return state.selectedFiles.has(f.name); });
      if (allSelected) {
        selectableFiles.forEach(function (f) { state.selectedFiles.delete(f.name); });
      } else {
        selectableFiles.forEach(function (f) { state.selectedFiles.add(f.name); });
      }
      buildFileTable(fileListContainer, fileFilter.value);
      updateFileControls();
    });

    fileFilter.addEventListener('input', function () {
      buildFileTable(fileListContainer, fileFilter.value);
    });
  }

  uploadBtn.addEventListener('click', function () {
    var pr = getSelectedPreset();
    if (!pr) { return; }
    var folder = (state.folderPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    var filesToUpload = state.files
      .filter(function (f) {
        return !f.isDirectory && (isAnchorFile(f.name) || state.selectedFiles.has(f.name));
      })
      .map(function (f) {
        return folder ? folder + '/' + f.name : f.name;
      });
    var anchorAbs = state.anchorFile || (filesToUpload[0] || '');
    var effectivePath = (state.selectedPath !== null && state.selectedPath !== '__add_new__')
      ? state.selectedPath
      : (pr.remoteDir || '/');
    var payload = {
      mode: state.mode,
      files: filesToUpload,
      anchorFile: anchorAbs,
      presetName: pr.name,
      selectedPaths: [effectivePath],
    };
    if (state.mode === 'zip_canon' && state.anchorFile) {
      payload.archiveName = state.zipBaseName || anchorStem;
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

function buildFileTable(container, filterStr) {
  clearEl(container);
  var filter = (filterStr || '').toLowerCase();
  var visible = state.files.filter(function (f) {
    if (f.isDirectory) { return false; }
    if (filter && !f.name.toLowerCase().includes(filter)) { return false; }
    return true;
  });
  if (visible.length === 0) { return; }

  var wrap = el('div', { className: 'file-table-wrap' });
  var table = el('table', { className: 'file-table' });

  var thead = document.createElement('thead');
  var hrow = document.createElement('tr');
  hrow.appendChild(el('th', null, ''));
  hrow.appendChild(el('th', null, 'File (' + visible.length + ')'));
  thead.appendChild(hrow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  visible.forEach(function (f) {
    var anchor = isAnchorFile(f.name);
    var tr = document.createElement('tr');

    var tdCb = document.createElement('td');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    if (anchor) {
      cb.disabled = true;
      cb.checked = true;
    } else {
      cb.checked = state.selectedFiles.has(f.name);
      cb.addEventListener('change', function () {
        if (cb.checked) { state.selectedFiles.add(f.name); }
        else            { state.selectedFiles.delete(f.name); }
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);

    var tdName = document.createElement('td');
    tdName.textContent = f.name + (anchor ? ' (anchor)' : '');
    if (anchor) { tdName.style.fontWeight = 'bold'; }
    tr.appendChild(tdName);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
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
  clearEl(app);

  // Header row
  var rowHeader = el('div', { className: 'row', style: 'align-items:center;' });
  var backBtn = el('button', { className: 'secondary' }, '\u2190 Back');
  var h2 = el('h2', { style: 'margin:0 0 0 12px;' }, 'Manage Accounts');
  rowHeader.appendChild(backBtn);
  rowHeader.appendChild(h2);
  app.appendChild(rowHeader);

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
  backBtn.addEventListener('click', function () {
    state.view = 'upload';
    state.showPresetForm = false;
    state.editingPreset = null;
    state.formDraft = null;
    render();
  });

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
