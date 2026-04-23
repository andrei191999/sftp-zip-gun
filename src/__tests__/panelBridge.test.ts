import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function loadPanelBridgeHarness(initialStateOverrides: Record<string, unknown> = {}) {
  const helpersSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'webview', 'panel', 'helpers.js'),
    'utf8'
  );
  const bridgeSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'webview', 'panel', 'bridge.js'),
    'utf8'
  );

  let messageHandler: ((event: { data: any }) => void) | undefined;
  const state: any = {
    folderPath: 'C:/workspace',
    files: [{ name: 'old.txt', isDirectory: false }],
    selectedFiles: new Set(['C:/workspace/old.txt']),
    anchorFile: 'C:/workspace/old.txt',
    modeAnchors: { zip_canon: 'C:/workspace/old.txt' },
    modeSelectedFiles: { pistol_file: new Set(['C:/workspace/old.txt']) },
    zipBaseName: null,
    groups: [{ id: 1, label: 'G1' }],
    fileGroups: [{ filePath: 'C:/workspace/old.txt', groupId: 1 }],
    groupAnchors: { 1: 'C:/workspace/old.txt' },
    groupCollapsed: { 1: true },
    ungroupedCollapsed: false,
    nextGroupId: 2,
    zipGunMemory: {
      groups: [{ id: 1, label: 'G1' }],
      fileGroups: [{ filePath: 'C:/workspace/old.txt', groupId: 1 }],
      groupAnchors: { 1: 'C:/workspace/old.txt' },
      nextGroupId: 2,
      groupNaming: 'anchor',
      namingBase: '',
      selectedFiles: ['C:/workspace/old.txt'],
    },
    fileUploadStatuses: { 'C:/workspace/old.txt': { upload: 'done' } },
    groupUploadStatuses: { 1: { upload: 'done' } },
    uploadProgressText: '100%',
    logs: [],
    logFilter: new Set(['upload']),
    uploading: false,
    ...initialStateOverrides,
  };

  const context: any = {
    state,
    window: {
      addEventListener: (_type: string, handler: (event: { data: any }) => void) => {
        messageHandler = handler;
      },
      scrollTo: jest.fn(),
    },
    document: {
      querySelectorAll: jest.fn(() => []),
      querySelector: jest.fn(() => null),
      createElement: jest.fn(() => ({
        className: '',
        appendChild: jest.fn(),
        remove: jest.fn(),
        style: {},
        setAttribute: jest.fn(),
        textContent: '',
      })),
    },
    console,
    Set,
    Object,
    Array,
    String,
    Number,
    Math,
    JSON,
    Date,
    requestAnimationFrame: (cb: () => void) => cb(),
    render: jest.fn(),
    persistState: jest.fn(),
    pushLog: jest.fn(),
    formatBytes: (value: number) => `${value}`,
    advanceStatusTrail: jest.fn((_existing, status) => ({ upload: status })),
    renderStatusTrail: jest.fn(),
    applyProgressBar: jest.fn(),
    clearEl: jest.fn(),
    vscode: { postMessage: jest.fn(), getState: jest.fn(() => null), setState: jest.fn() },
  };

  vm.runInNewContext(helpersSource, context, { filename: 'helpers.js' });
  vm.runInNewContext(bridgeSource, context, { filename: 'bridge.js' });

  if (!messageHandler) {
    throw new Error('Panel bridge did not register a message handler.');
  }

  return {
    state,
    persistState: context.persistState as jest.Mock,
    dispatch: messageHandler,
  };
}

describe('panel bridge filesListed handling', () => {
  it('prunes stale local folder state when the same folder is re-listed', () => {
    const harness = loadPanelBridgeHarness();

    harness.dispatch({
      data: {
        kind: 'filesListed',
        payload: {
          folderPath: 'C:/workspace',
          files: [{ name: 'new.txt', isDirectory: false }],
        },
      },
    });

    expect(Array.from(harness.state.selectedFiles)).toEqual([]);
    expect(harness.state.anchorFile).toBeNull();
    expect(harness.state.modeAnchors).toEqual({});
    expect(Array.from(harness.state.modeSelectedFiles.pistol_file)).toEqual([]);
    expect(harness.state.fileGroups).toEqual([]);
    expect(harness.state.groups).toEqual([]);
    expect(harness.state.groupAnchors).toEqual({});
    expect(harness.state.zipGunMemory).toBeNull();
    expect(harness.state.fileUploadStatuses).toEqual({});
    expect(harness.state.groupUploadStatuses).toEqual({});
    expect(harness.persistState).toHaveBeenCalledTimes(1);
  });
});
