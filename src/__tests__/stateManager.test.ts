import { StateManager } from '../config/stateManager';
import { makeMockContext } from '../__mocks__/vscode';
import { HistoryEntry } from '../types/messages';

function makeEntry(id: string): HistoryEntry {
  return {
    id,
    timestamp: new Date().toISOString(),
    presetName: 'preset-a',
    mode: 'zip',
    files: ['file.xml'],
    remoteFile: '/remote/file.zip',
    result: 'success',
  };
}

describe('StateManager — getState defaults', () => {
  it('returns empty object when no state has been set', () => {
    const ctx = makeMockContext();
    const sm = new StateManager(ctx as any);
    expect(sm.getState()).toEqual({});
  });
});

describe('StateManager — setState merging', () => {
  let sm: StateManager;

  beforeEach(() => {
    const ctx = makeMockContext();
    sm = new StateManager(ctx as any);
  });

  it('persists a partial state update', async () => {
    await sm.setState({ lastPresetName: 'my-preset' });
    expect(sm.getState().lastPresetName).toBe('my-preset');
  });

  it('merges without overwriting unmentioned fields', async () => {
    await sm.setState({ lastPresetName: 'preset-a', mode: 'zip' });
    await sm.setState({ mode: 'separate' });
    const state = sm.getState();
    expect(state.lastPresetName).toBe('preset-a');
    expect(state.mode).toBe('separate');
  });
});

describe('StateManager — addToHistory ordering', () => {
  let sm: StateManager;

  beforeEach(() => {
    const ctx = makeMockContext();
    sm = new StateManager(ctx as any);
  });

  it('stores entries newest-first', async () => {
    await sm.addToHistory(makeEntry('first'));
    await sm.addToHistory(makeEntry('second'));
    const history = sm.getHistory();
    expect(history[0].id).toBe('second');
    expect(history[1].id).toBe('first');
  });

  it('returns empty array when no history exists', () => {
    expect(sm.getHistory()).toEqual([]);
  });
});

describe('StateManager — history cap at 50', () => {
  it('caps at 50 entries and drops the oldest on overflow', async () => {
    const ctx = makeMockContext();
    const sm = new StateManager(ctx as any);

    for (let i = 0; i < 50; i++) {
      await sm.addToHistory(makeEntry(`entry-${i}`));
    }
    expect(sm.getHistory()).toHaveLength(50);
    expect(sm.getHistory()[0].id).toBe('entry-49');

    await sm.addToHistory(makeEntry('entry-50'));
    const history = sm.getHistory();
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe('entry-50');
    expect(history[history.length - 1].id).toBe('entry-1');
  });
});

describe('StateManager — clearHistory', () => {
  it('empties the history', async () => {
    const ctx = makeMockContext();
    const sm = new StateManager(ctx as any);
    await sm.addToHistory(makeEntry('x'));
    await sm.clearHistory();
    expect(sm.getHistory()).toEqual([]);
  });
});
