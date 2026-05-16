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

// Format a history entry ISO timestamp as "HH:MM" (today) or "Mon D HH:MM" (older)
function formatHistoryTs(isoStr) {
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) { return isoStr.slice(0, 16) || isoStr; }
  var now = new Date();
  var hh = pad2(d.getHours()), mm = pad2(d.getMinutes());
  if (d.toDateString() === now.toDateString()) { return hh + ':' + mm; }
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + '\u00a0' + d.getDate() + ' ' + hh + ':' + mm;
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
  state.fileRowMap = new Map();
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

  if (reconciledGroups.validGroupIds.size > 0) {
    Object.keys(state.groupCollapsed || {}).forEach(function(groupId) {
      if (!reconciledGroups.validGroupIds.has(String(groupId))) {
        delete state.groupCollapsed[groupId];
      }
    });
  }

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

// All characters of word must appear in order in target (subsequence match).
// maxGap limits how far apart consecutive matched characters can be,
// preventing spurious matches across unrelated segments (e.g. "ethias" matching
// across " — bcdtravel@intake.up-nxt.com:sftp-1-2.nxt.uat.unifiedpost.com").
function _wordMatchesTarget(word, target, maxGap) {
  if (maxGap === undefined) { maxGap = 15; }
  var pos = 0;
  for (var ci = 0; ci < word.length; ci++) {
    var idx = target.indexOf(word[ci], pos);
    if (idx === -1) { return false; }
    if (ci > 0 && (idx - pos + 1) > maxGap) { return false; }
    pos = idx + 1;
  }
  return true;
}

/**
 * Fuzzy multi-word filter: all space-separated words must subsequence-match at least one target.
 * Case-insensitive. Empty query matches all.
 * Example: "usr prod" matches "production-username" (usr→username, prod→production).
 * @param {string} query
 * @param {string[]} targets
 * @returns {boolean}
 */
function fuzzyMatch(query, targets) {
  if (!query || query.trim() === '') { return true; }

  var lowerTargets = targets.map(function(t) { return (t || '').toLowerCase(); });
  var words = query.toLowerCase().trim().split(/\s+/);

  for (var w = 0; w < words.length; w++) {
    var word = words[w];
    var wordMatched = false;
    for (var t = 0; t < lowerTargets.length; t++) {
      if (_wordMatchesTarget(word, lowerTargets[t])) {
        wordMatched = true;
        break;
      }
    }
    if (!wordMatched) { return false; }
  }

  return true;
}

// Registry of all currently-open combobox close functions.
// Ensures only one combobox overlay is visible at a time.
var _openComboboxes = [];

function _closeAllComboboxes() {
  _openComboboxes.forEach(function(close) { close(); });
  _openComboboxes = [];
}

/**
 * Build a custom combobox with embedded search
 * @param {Object} config
 * @param {Array} config.items - Array of {value, label, searchText} objects
 * @param {string} config.selectedValue - Currently selected value
 * @param {string} config.placeholder - Placeholder when nothing selected
 * @param {Function} config.onChange - Called with (newValue) when selection changes
 * @param {string} config.id - DOM id for the combobox trigger
 * @returns {HTMLElement} - Container with trigger button and overlay
 */
function buildCombobox(config) {
  var container = el('div', { style: 'position:relative;flex:1;min-width:0;', 'data-combobox-container': '1' });

  var trigger = el('button', {
    id: config.id || '',
    style: 'width:100%;text-align:left;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:2px;cursor:pointer;'
  });

  var selectedItem = config.items.find(function(item) { return item.value === config.selectedValue; });
  trigger.textContent = selectedItem ? selectedItem.label : (config.placeholder || 'Select...');

  // Overlay (hidden by default)
  // position:fixed so ancestor overflow:hidden never clips the dropdown.
  // Coordinates are set dynamically in the trigger click handler.
  var overlay = el('div', {
    style: 'display:none;position:fixed;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-focusBorder);border-radius:2px;overflow:hidden;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,0.5);'
  });

  var searchInput = el('input', {
    type: 'text',
    placeholder: 'Type to filter...',
    style: 'width:100%;padding:6px 8px;border:none;border-bottom:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);box-sizing:border-box;'
  });
  overlay.appendChild(searchInput);

  var optionsList = el('div', { style: 'max-height:250px;overflow-y:auto;' });
  overlay.appendChild(optionsList);

  function renderOptions(filterText) {
    clearEl(optionsList);
    var filtered = config.items.filter(function(item) {
      var searchTargets = Array.isArray(item.searchText)
        ? item.searchText
        : [item.searchText != null ? item.searchText : item.label];
      return fuzzyMatch(filterText || '', searchTargets);
    });

    if (filtered.length === 0) {
      optionsList.appendChild(el('div', { style: 'padding:8px;opacity:0.6;' }, 'No matches'));
      return;
    }

    filtered.forEach(function(item) {
      var opt = el('div', {
        style: 'padding:6px 8px;cursor:pointer;color:var(--vscode-foreground);' + (item.value === config.selectedValue ? 'background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);' : '')
      });
      opt.textContent = item.label;

      opt.addEventListener('mouseenter', function() {
        if (item.value !== config.selectedValue) {
          opt.style.background = 'var(--vscode-list-hoverBackground)';
        }
      });
      opt.addEventListener('mouseleave', function() {
        if (item.value !== config.selectedValue) {
          opt.style.background = '';
        }
      });
      opt.addEventListener('click', function() {
        config.onChange(item.value);
        overlay.style.display = 'none';
      });

      optionsList.appendChild(opt);
    });
  }

  function closeThisOverlay() {
    overlay.style.display = 'none';
    _openComboboxes = _openComboboxes.filter(function(fn) { return fn !== closeThisOverlay; });
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = overlay.style.display !== 'none';
    if (isOpen) {
      closeThisOverlay();
    } else {
      // Close any other open combobox before opening this one.
      _closeAllComboboxes();
      // Position the fixed overlay to sit directly below the trigger button.
      var rect = trigger.getBoundingClientRect();
      overlay.style.top = (rect.bottom + 2) + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.display = 'block';
      searchInput.value = '';
      renderOptions('');
      _openComboboxes.push(closeThisOverlay);
      setTimeout(function() { searchInput.focus(); }, 0);
    }
  });

  searchInput.addEventListener('input', function() {
    renderOptions(searchInput.value);
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeThisOverlay();
      trigger.focus();
    }
  });

  // Close when clicking outside. Registered once; removed when overlay is detached.
  function onDocClick(e) {
    if (!container.contains(e.target) && !overlay.contains(e.target)) {
      closeThisOverlay();
    }
  }
  document.addEventListener('click', onDocClick);

  container.appendChild(trigger);
  // Append overlay to body so it is never clipped by any ancestor overflow:hidden.
  // Store cleanup on the container so callers can call container._destroy() on teardown.
  document.body.appendChild(overlay);
  container._destroy = function() {
    document.removeEventListener('click', onDocClick);
    if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
  };

  return container;
}

function makeSvgEl(tag, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
  }
  return node;
}

function iconAnchor() {
  var svg = makeSvgEl('svg', {
    width: '1em', height: '1em', viewBox: '0 0 16 16',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  svg.style.verticalAlign = 'middle';
  svg.appendChild(makeSvgEl('circle', { cx: '8', cy: '3',  r: '2'  }));
  svg.appendChild(makeSvgEl('line',   { x1: '8',  y1: '5',  x2: '8',  y2: '14' }));
  svg.appendChild(makeSvgEl('line',   { x1: '3',  y1: '7',  x2: '13', y2: '7'  }));
  svg.appendChild(makeSvgEl('line',   { x1: '8',  y1: '14', x2: '3',  y2: '11' }));
  svg.appendChild(makeSvgEl('line',   { x1: '8',  y1: '14', x2: '13', y2: '11' }));
  return svg;
}

function iconFolder() {
  var svg = makeSvgEl('svg', {
    width: '1em', height: '1em', viewBox: '0 0 16 16',
    fill: 'currentColor', 'aria-hidden': 'true',
  });
  svg.style.verticalAlign = 'middle';
  svg.appendChild(makeSvgEl('path', { d: 'M1 6V4h4l2 2h8v7H1V6Z' }));
  return svg;
}

// Build a styled log box and append it to container. Returns the <pre>.
function buildLogBox(container) {
  var pre = el('pre', { className: 'log-box' });
  var visible = state.logs.filter(function (entry) {
    if (entry.level === 'session') { return true; }  // separators always show
    if (!entry.category) { return true; }            // uncategorised always show
    return state.logFilter.has(entry.category);
  });
  if (state.uploading && state.uploadProgressText) {
    var pLine = document.createElement('div');
    pLine.className = 'log-progress';
    var pCat = document.createElement('span');
    pCat.className = 'log-cat log-cat-upload';
    pCat.textContent = 'upload';
    var pTxt = document.createElement('span');
    pTxt.textContent = state.uploadProgressText;
    pLine.appendChild(pCat);
    pLine.appendChild(pTxt);
    pre.appendChild(pLine);
  }
  visible.slice().reverse().forEach(function (entry) {
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
        catSpan.textContent = entry.category;
        line.appendChild(catSpan);
      }
      var txt = document.createElement('span');
      txt.className = 'log-' + entry.level;
      txt.textContent = entry.text;
      line.appendChild(txt);
    }
    pre.appendChild(line);
  });
  container.appendChild(pre);
  // Scroll to top to show newest entries first.
  requestAnimationFrame(function () { pre.scrollTop = 0; });
  return pre;
}

// renderLogSection is defined in renderers.js (needs buildHistory from that file).

// ---------------------------------------------------------------------------
// Message handling (HostToWebview)
// ---------------------------------------------------------------------------
