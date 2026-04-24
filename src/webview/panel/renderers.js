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
      // Save anchor and upload statuses for the mode we're leaving
      state.modeAnchors[state.mode] = state.anchorFile;
      state.modeFileStatuses[state.mode]  = Object.assign({}, state.fileUploadStatuses);
      state.modeGroupStatuses[state.mode] = Object.assign({}, state.groupUploadStatuses);
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
      // Restore the destination mode's upload statuses
      state.fileUploadStatuses  = Object.assign({}, state.modeFileStatuses[item.value]  || {});
      state.groupUploadStatuses = Object.assign({}, state.modeGroupStatuses[item.value] || {});
      persistState();
      render();
    });
    modeBtn.appendChild(span);
  });
  rowMode.appendChild(modeBtn);
  app.appendChild(rowMode);

  // ---- File sections (Open files merged with Local folder, shared search) ----
  var localFolderNorm = normalizeFolderPath(state.folderPath);
  // All open VS Code tabs, paths normalized to forward slashes for consistent comparison
  var openFileRows = state.openFiles.map(function(of) {
    var filePath = (of.path || '').replace(/\\/g, '/');
    var ofFolder = filePath.replace(/\/[^/]+$/, '');
    return { filePath: filePath, fileName: of.name, folderPath: ofFolder };
  });
  // Set of normalized open paths — used for dedup with local files
  var openNormPaths = new Set(openFileRows.map(function(of) { return of.filePath; }));

  var localFileCount = state.files.filter(function(f){ return !f.isDirectory; }).length;
  var localOnlyCount = state.files.filter(function(f) {
    if (f.isDirectory) { return false; }
    var absPath = localFolderNorm ? localFolderNorm + '/' + f.name : f.name;
    return !openNormPaths.has(absPath);
  }).length;
  var totalFileCount = localOnlyCount + openFileRows.length;
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
    var openCollapsed = !!state.sectionCollapsed.openFiles;
    var localFilesCollapsedCtrl = !!state.sectionCollapsed.localFiles;
    var selectableCount, selectedCount;
    if (openCollapsed && localFilesCollapsedCtrl) {
      selectableCount = 0;
      selectedCount = 0;
    } else if (openCollapsed) {
      // Open hidden, local visible: all local files (including those also open)
      selectableCount = state.files.filter(function(f) { return !f.isDirectory; }).length;
      selectedCount = state.files.filter(function(f) {
        if (f.isDirectory) { return false; }
        var absPath = folder ? folder + '/' + f.name : f.name;
        return state.selectedFiles.has(absPath);
      }).length;
    } else if (localFilesCollapsedCtrl) {
      // Local hidden, open visible: only open files
      selectableCount = openFileRows.length;
      selectedCount = openFileRows.filter(function(of) {
        return state.selectedFiles.has(of.filePath);
      }).length;
    } else {
      // Both visible: local-only files + open files (no double-count)
      selectableCount = state.files.filter(function(f) {
        if (f.isDirectory) { return false; }
        var absPath = folder ? folder + '/' + f.name : f.name;
        return !openNormPaths.has(absPath);
      }).length + openFileRows.length;
      selectedCount = state.files.filter(function(f) {
        if (f.isDirectory) { return false; }
        var absPath = folder ? folder + '/' + f.name : f.name;
        if (openNormPaths.has(absPath)) { return false; }
        return state.selectedFiles.has(absPath);
      }).length + openFileRows.filter(function(of) {
        return state.selectedFiles.has(of.filePath);
      }).length;
    }
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

  // ---- Log output + history ----
  renderLogSection(app, true);

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
      var openCollapsed = !!state.sectionCollapsed.openFiles;
      var localFilesCollapsedSel = !!state.sectionCollapsed.localFiles;
      var allFiles = state.files.filter(function (f) { return !f.isDirectory; });
      var isGrouped = function(ap) {
        return state.mode === 'zip_gun' && state.fileGroups.some(function(fg) { return fg.filePath === ap; });
      };
      // Determine which files are visible in each section based on collapse state
      var visibleLocalFiles = localFilesCollapsedSel ? [] : (openCollapsed ? allFiles : allFiles.filter(function(f) {
        var absPath = folder ? folder + '/' + f.name : f.name;
        return !openNormPaths.has(absPath);
      }));
      var visibleOpenRows = openCollapsed ? [] : openFileRows;
      var allLocalSelected = visibleLocalFiles.every(function (f) {
        var absPath = folder ? folder + '/' + f.name : f.name;
        if (isGrouped(absPath)) { return true; }
        return state.selectedFiles.has(absPath);
      });
      var allOpenSelected = visibleOpenRows.every(function (of) {
        if (isGrouped(of.filePath)) { return true; }
        return state.selectedFiles.has(of.filePath);
      });
      var ungroupedLocalCount = state.mode === 'zip_gun'
        ? visibleLocalFiles.filter(function(f) { return !isGrouped(folder ? folder + '/' + f.name : f.name); }).length
        : visibleLocalFiles.length;
      var ungroupedOpenCount = state.mode === 'zip_gun'
        ? visibleOpenRows.filter(function(of) { return !isGrouped(of.filePath); }).length
        : visibleOpenRows.length;
      var allSelected = allLocalSelected && allOpenSelected
                     && (ungroupedLocalCount + ungroupedOpenCount > 0);
      if (allSelected) {
        visibleLocalFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          state.selectedFiles.delete(absPath);
        });
        visibleOpenRows.forEach(function (of) { state.selectedFiles.delete(of.filePath); });
      } else {
        visibleLocalFiles.forEach(function (f) {
          var absPath = folder ? folder + '/' + f.name : f.name;
          if (isGrouped(absPath)) { return; }
          state.selectedFiles.add(absPath);
        });
        visibleOpenRows.forEach(function (of) {
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
    state.logActiveTab = 'log';  // open log pane whenever an upload fires

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

// openFileRows: optional array of {filePath, fileName, folderPath} — all open VS Code tabs.
function buildFileTable(container, filterStr, openFileRows) {
  _fileTableContainer = container;
  _fileTableFilterStr = filterStr || '';
  _fileTableOpenRows  = openFileRows || [];
  var _prevWrap = container.querySelector('.file-table-wrap');
  var _prevScroll = _prevWrap ? _prevWrap.scrollTop : 0;
  clearEl(container);
  var filter = (filterStr || '').toLowerCase();
  var folder = normalizeFolderPath(state.folderPath);
  var openCollapsed = !!state.sectionCollapsed.openFiles;
  var openNormPathSet = new Set((openFileRows || []).map(function(of) { return of.filePath; }));

  var localVisible = state.files.filter(function (f) {
    if (f.isDirectory) { return false; }
    if (filter && !f.name.toLowerCase().includes(filter)) { return false; }
    // When open section is expanded, hide local files that are already shown as open
    if (!openCollapsed) {
      var absPath = folder ? folder + '/' + f.name : f.name;
      if (openNormPathSet.has(absPath)) { return false; }
    }
    return true;
  }).sort(function(a, b) { return a.name.localeCompare(b.name); });

  var openVisible = (openFileRows || []).filter(function(of) {
    return !filter || of.fileName.toLowerCase().includes(filter);
  }).sort(function(a, b) { return a.fileName.localeCompare(b.fileName); });

  var hasOpenFileRows = (openFileRows || []).length > 0;
  if (localVisible.length === 0 && openVisible.length === 0 && !hasOpenFileRows && (state.mode !== 'zip_gun' || state.groups.length === 0)) { return; }

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
    var tableFileCount = openCollapsed ? localVisible.length : (localVisible.length + openVisible.length);
    hrow.appendChild(el('th', null, 'File (' + tableFileCount + ')'));
    hrow.appendChild(el('th', { className: 'status-th' }, ''));
  } else {
    var pinThAttrs2 = state.mode === 'zip_canon' ? { title: 'Anchor \u2014 determines the zip archive filename' } : null;
    hrow.appendChild(el('th', pinThAttrs2, ''));
    hrow.appendChild(el('th', null, ''));
    hrow.appendChild(el('th', null, ''));
    var tableFileCount = openCollapsed ? localVisible.length : (localVisible.length + openVisible.length);
    hrow.appendChild(el('th', null, 'File (' + tableFileCount + ')'));
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
    span.appendChild(iconAnchor());

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

    var newGrpOpt = document.createElement('option');
    newGrpOpt.value = '__new__';
    newGrpOpt.textContent = '+ New Group';
    sel.appendChild(newGrpOpt);

    var curFg = state.fileGroups.find(function(fg) { return fg.filePath === absPath; });
    sel.value = curFg ? String(curFg.groupId) : '';

    (function(ap) {
      sel.addEventListener('change', function() {
        // New Group: create a group and assign this file (or all selected files if bulk)
        if (sel.value === '__new__') {
          var targets = (state.selectedFiles.size > 1 && state.selectedFiles.has(ap))
            ? Array.from(state.selectedFiles)
            : [ap];
          var newGid = state.nextGroupId++;
          state.groups.push({ id: newGid, label: 'G' + newGid });
          targets.forEach(function(fp) {
            state.fileGroups = state.fileGroups.filter(function(fg) { return fg.filePath !== fp; });
            state.fileGroups.push({ filePath: fp, groupId: newGid });
          });
          state.groupAnchors[newGid] = targets.slice().sort()[0];
          state.selectedFiles.clear();
          persistState();
          buildFileTable(container, filterStr, openFileRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
          return;
        }

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
    if (row.folderPath === folder) { return td; }  // already in local folder — no switch needed
    td.className = 'pin-cell';
    var swSpan = document.createElement('span');
    swSpan.className = 'hover-icon' + (state.uploading ? ' disabled' : '');
    swSpan.appendChild(iconFolder());
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

  // ── Recent Files separator (collapsible open-tabs section) ─────────────────
  if (hasOpenFileRows) {
    var nCols = state.mode === 'zip_gun' ? 6 : 5;
    var sepRow = document.createElement('tr');
    sepRow.className = 'open-section-separator';
    var sepTd = document.createElement('td');
    sepTd.setAttribute('colspan', String(nCols));
    var sepArrow = openCollapsed ? '\u25b8' : '\u25be';
    var sepBtn = el('button', {
      className: 'secondary section-toggle',
      title: openCollapsed ? 'Show open editor files' : 'Hide open editor files',
    }, sepArrow + ' Open Files (' + (openFileRows || []).length + ')');
    (function(c, fStr, ofRows) {
      sepBtn.addEventListener('click', function() {
        state.sectionCollapsed.openFiles = !state.sectionCollapsed.openFiles;
        persistState();
        buildFileTable(c, fStr, ofRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(container, filterStr, openFileRows));
    sepTd.appendChild(sepBtn);
    sepRow.appendChild(sepTd);
    if (state.mode !== 'zip_gun') { tbody.appendChild(sepRow); }
  }

  var localFilesCollapsed = !!state.sectionCollapsed.localFiles;

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

    // ── Open Files section (below groups in zip_gun) ────────────────────────
    if (hasOpenFileRows) {
      var openUnassigned = openVisible.filter(function(of) {
        return !state.fileGroups.some(function(fg) { return fg.filePath === of.filePath; });
      });
      var zgSepRow = document.createElement('tr');
      zgSepRow.className = 'open-section-separator';
      var zgSepTd = document.createElement('td');
      zgSepTd.setAttribute('colspan', '6');
      var zgArrow = openCollapsed ? '\u25b8' : '\u25be';
      var zgBtn = el('button', {
        className: 'secondary section-toggle',
        title: openCollapsed ? 'Show open editor files' : 'Hide open editor files',
      }, zgArrow + ' Open Files (' + openUnassigned.length + ')');
      (function(c, fStr, ofRows) {
        zgBtn.addEventListener('click', function() {
          state.sectionCollapsed.openFiles = !state.sectionCollapsed.openFiles;
          persistState();
          buildFileTable(c, fStr, ofRows);
          if (_updateFileControlsFn) { _updateFileControlsFn(); }
        });
      }(container, filterStr, openFileRows));
      zgSepTd.appendChild(zgBtn);
      zgSepRow.appendChild(zgSepTd);
      tbody.appendChild(zgSepRow);
      if (!openCollapsed) {
        openUnassigned.forEach(function(of) {
          tbody.appendChild(buildFileRow({
            kind: 'open',
            absPath: of.filePath,
            fileName: of.fileName,
            folderPath: of.folderPath,
            isAnchor: false,
          }));
        });
      }
    }

    // ── Local Files section (unassigned local files only) ────────────────────
    var lfUnassigned = localVisible.filter(function(f) {
      var absPath = folder ? folder + '/' + f.name : f.name;
      return !state.fileGroups.some(function(fg) { return fg.filePath === absPath; });
    });
    var lfSepRowZG = document.createElement('tr');
    lfSepRowZG.className = 'open-section-separator';
    var lfSepTdZG = document.createElement('td');
    lfSepTdZG.setAttribute('colspan', '6');
    var lfArrowZG = localFilesCollapsed ? '\u25b8' : '\u25be';
    var lfBtnZG = el('button', {
      className: 'secondary section-toggle',
      title: localFilesCollapsed ? 'Show local files' : 'Hide local files',
    }, lfArrowZG + ' Local Files (' + lfUnassigned.length + ')');
    (function(c, fStr, ofRows) {
      lfBtnZG.addEventListener('click', function() {
        state.sectionCollapsed.localFiles = !state.sectionCollapsed.localFiles;
        persistState();
        buildFileTable(c, fStr, ofRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(container, filterStr, openFileRows));
    lfSepTdZG.appendChild(lfBtnZG);
    lfSepRowZG.appendChild(lfSepTdZG);
    tbody.appendChild(lfSepRowZG);
    if (!localFilesCollapsed) {
      lfUnassigned.forEach(function(f) {
        tbody.appendChild(buildFileRow({
          kind: 'local',
          absPath: folder ? folder + '/' + f.name : f.name,
          fileName: f.name,
          folderPath: folder,
          isAnchor: isAnchorFile(f.name),
        }));
      });
    }
  } else {
    // non-zip_gun: open rows first (gated on collapse), then "Local Files" section header, then local rows
    if (!openCollapsed) {
      visibleRows.filter(function(row) { return row.kind === 'open'; }).forEach(function(row) {
        tbody.appendChild(buildFileRow(row));
      });
    }
    var lfSepRow = document.createElement('tr');
    lfSepRow.className = 'open-section-separator';
    var lfSepTd = document.createElement('td');
    lfSepTd.setAttribute('colspan', '5');
    var lfArrow = localFilesCollapsed ? '\u25b8' : '\u25be';
    var lfBtn = el('button', {
      className: 'secondary section-toggle',
      title: localFilesCollapsed ? 'Show local files' : 'Hide local files',
    }, lfArrow + ' Local Files (' + localVisible.length + ')');
    (function(c, fStr, ofRows) {
      lfBtn.addEventListener('click', function() {
        state.sectionCollapsed.localFiles = !state.sectionCollapsed.localFiles;
        persistState();
        buildFileTable(c, fStr, ofRows);
        if (_updateFileControlsFn) { _updateFileControlsFn(); }
      });
    }(container, filterStr, openFileRows));
    lfSepTd.appendChild(lfBtn);
    lfSepRow.appendChild(lfSepTd);
    tbody.appendChild(lfSepRow);
    if (!localFilesCollapsed) {
      visibleRows.filter(function(row) { return row.kind === 'local'; }).forEach(function(row) {
        tbody.appendChild(buildFileRow(row));
      });
    }
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
  wrap.scrollTop = _prevScroll;

  // Rebuild row cache for uploadProgress handler
  state.fileRowMap = new Map();
  tbody.querySelectorAll('tr[data-filepath]').forEach(function(row) {
    if (row.dataset.filepath) { state.fileRowMap.set(row.dataset.filepath, row); }
  });
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

// Collapsible log+history section with a unified bordered box.
// withHistory: true in upload view, false in manage view.
// logActiveTab: null | 'log' | 'history' — null collapses the box.
// Clicking the active tab collapses; clicking the inactive tab switches.
function renderLogSection(container, withHistory) {
  var CATS = ['upload', 'conn', 'import', 'accounts', 'sys'];
  var section = el('div', { className: 'log-section' });
  var box     = el('div', { className: 'log-section-box' });

  // In manage view, history tab is unavailable — treat it as log
  var activeTab = (withHistory ? state.logActiveTab : (state.logActiveTab ? 'log' : null));

  // --- Header: tab row (always) + filter row (only when a tab is active) ---
  var header = el('div', { className: 'log-section-header' });

  // Tab row — both buttons always present, each takes half the width
  var tabRow = el('div', { className: 'log-tab-row' });

  var logsBtn = el('button', {
    className: activeTab === 'log' ? 'active' : 'secondary',
    title: 'Show transfer log',
  }, '\u2630 Session Logs');
  logsBtn.addEventListener('click', function () {
    state.logActiveTab = (activeTab === 'log') ? null : 'log';
    render();
  });
  tabRow.appendChild(logsBtn);

  if (withHistory) {
    var histBtn = el('button', {
      className: state.logActiveTab === 'history' ? 'active' : 'secondary',
      title: 'View past upload sessions',
    }, '\uD83D\uDCCB Upload History');
    histBtn.addEventListener('click', function () {
      state.logActiveTab = (state.logActiveTab === 'history') ? null : 'history';
      render();
    });
    tabRow.appendChild(histBtn);
  }

  header.appendChild(tabRow);

  // Filter row — shown below the tab row only when a tab is open
  if (activeTab === 'log') {
    var allActive = CATS.every(function (c) { return state.logFilter.has(c); });
    var filterBar = el('div', { className: 'log-filter-row' });
    var allBtn = el('button', { className: allActive ? 'active' : 'secondary' }, 'All');
    allBtn.title = 'Show all log categories';
    allBtn.addEventListener('click', function () {
      if (allActive) { CATS.forEach(function (c) { state.logFilter.delete(c); }); }
      else            { CATS.forEach(function (c) { state.logFilter.add(c); }); }
      render();
    });
    filterBar.appendChild(allBtn);
    CATS.forEach(function (cat) {
      var active = state.logFilter.has(cat);
      var btn = el('button', { className: active ? 'active' : 'secondary' }, cat);
      btn.title = 'Toggle ' + cat + ' log entries';
      btn.addEventListener('click', function () {
        if (state.logFilter.has(cat)) { state.logFilter.delete(cat); }
        else                          { state.logFilter.add(cat); }
        render();
      });
      filterBar.appendChild(btn);
    });
    header.appendChild(filterBar);
  } else if (activeTab === 'history') {
    var histFilterBar = el('div', { className: 'log-filter-row' });
    // Result group
    [
      { value: 'all',     label: 'All' },
      { value: 'success', label: '\u2713 Success' },
      { value: 'error',   label: '\u2717 Errors' },
    ].forEach(function (f) {
      var btn = el('button', { className: state.historyFilter.result === f.value ? 'active' : 'secondary' }, f.label);
      btn.addEventListener('click', function () { state.historyFilter.result = f.value; render(); });
      histFilterBar.appendChild(btn);
    });
    // Mode group — only when multiple distinct modes exist in history
    var histModes = [];
    state.history.forEach(function (e) { if (histModes.indexOf(e.mode) < 0) { histModes.push(e.mode); } });
    if (histModes.length > 1) {
      var MODE_LABELS = { zip_canon: 'canon', pistol_file: 'pistol', zip_gun: 'gun' };
      histFilterBar.appendChild(el('span', { className: 'filter-sep' }, '\u00b7'));
      var allModeBtn = el('button', { className: state.historyFilter.mode === 'all' ? 'active' : 'secondary' }, 'All modes');
      allModeBtn.addEventListener('click', function () { state.historyFilter.mode = 'all'; render(); });
      histFilterBar.appendChild(allModeBtn);
      histModes.forEach(function (m) {
        var btn = el('button', { className: state.historyFilter.mode === m ? 'active' : 'secondary' }, MODE_LABELS[m] || m);
        btn.addEventListener('click', function () { state.historyFilter.mode = m; render(); });
        histFilterBar.appendChild(btn);
      });
    }
    header.appendChild(histFilterBar);
  }

  box.appendChild(header);

  // --- Body: log OR history sharing the same space ---
  if (activeTab === 'log') {
    buildLogBox(box);
  } else if (activeTab === 'history') {
    var histSection = el('div', { className: 'log-history-section' });
    buildHistory(histSection);
    box.appendChild(histSection);
  }

  section.appendChild(box);
  container.appendChild(section);
}

function buildHistory(container) {
  clearEl(container);
  if (state.history.length === 0) {
    container.appendChild(el('p', { className: 'history-empty' }, 'No history yet.'));
    return;
  }
  var visibleHistory = state.history.filter(function (entry) {
    if (state.historyFilter.result === 'success' && entry.result !== 'success') { return false; }
    if (state.historyFilter.result === 'error'   && entry.result !== 'error')   { return false; }
    if (state.historyFilter.mode   !== 'all'     && entry.mode   !== state.historyFilter.mode) { return false; }
    return true;
  });
  if (visibleHistory.length === 0) {
    container.appendChild(el('p', { className: 'history-empty' }, 'No matching entries.'));
    return;
  }
  var MODE_LABEL = { zip_canon: 'canon', pistol_file: 'pistol', zip_gun: 'gun' };
  visibleHistory.forEach(function (entry) {
    var isOk = entry.result === 'success';
    var div = el('div', {
      className: 'history-entry ' + (isOk ? 'success' : 'error'),
      title: entry.errorMessage || '',
    });
    // Status glyph (✓ or ✗)
    div.appendChild(el('span', { className: 'hentry-status hentry-status-' + entry.result },
      isOk ? '\u2713' : '\u2717'));
    // Timestamp (HH:MM today, Mon D HH:MM older)
    div.appendChild(el('span', { className: 'hentry-ts' }, formatHistoryTs(entry.timestamp)));
    // Account name
    div.appendChild(el('span', { className: 'hentry-account' }, entry.presetName));
    // Mode badge pill
    div.appendChild(el('span', { className: 'hentry-mode hentry-mode-' + entry.mode },
      MODE_LABEL[entry.mode] || entry.mode));
    // File count (or single filename)
    var fileLabel = entry.files.length === 1 ? entry.files[0] : entry.files.length + ' files';
    div.appendChild(el('span', { className: 'hentry-files' }, fileLabel));
    // Remote path — width:100% CSS forces it to its own line below the info row
    div.appendChild(el('span', { className: 'hentry-path' }, '\u2192\u00a0' + entry.remoteFile));
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
  renderLogSection(app, false);

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
