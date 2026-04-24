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
      if (!currentNorm) {
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
      if (fp) {
        var cachedRow = state.fileRowMap.get(fp);
        if (cachedRow) {
          matchedRows.push(cachedRow);
          applyProgressBar(cachedRow.querySelector('td.filename-cell'), p.percent);
        }
      } else {
        state.fileRowMap.forEach(function(row, rowFilePath) {
          if (getFileName(rowFilePath) === p.currentFile) {
            matchedRows.push(row);
            applyProgressBar(row.querySelector('td.filename-cell'), p.percent);
          }
        });
      }
      if (matchedRows.length === 0) {
        Object.keys(state.fileUploadStatuses).forEach(function(filePath) {
          var trail = state.fileUploadStatuses[filePath];
          if (!trail || !trail.zipped || trail.upload !== 'uploading') { return; }
          var row = state.fileRowMap.get(filePath);
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
