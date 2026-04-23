// bootstrap.js — extracted from media/panel.js
// Final ready/render bootstrap. This fragment must load after renderers.js.

vscode.postMessage({ kind: 'ready' });

render();
