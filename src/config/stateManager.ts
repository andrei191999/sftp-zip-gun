import * as vscode from 'vscode';
import { PanelState, HistoryEntry } from '../types/messages';

const STATE_KEY = 'sftpZipGun.panelState';
const HISTORY_KEY = 'sftpZipGun.history';
const HISTORY_CAP = 50;

export class StateManager {
  private stateCache: PanelState | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getState(): PanelState {
    if (this.stateCache) {
      return this.stateCache;
    }

    const raw = this.context.globalState.get<PanelState>(STATE_KEY);
    if (raw !== null && typeof raw === 'object') {
      this.stateCache = raw;
      return this.stateCache;
    }
    this.stateCache = {};
    return this.stateCache;
  }

  async setState(partial: Partial<PanelState>): Promise<void> {
    const current = this.getState();
    const merged: PanelState = { ...current, ...partial };
    this.stateCache = merged;
    await this.context.globalState.update(STATE_KEY, merged);
  }

  getHistory(): HistoryEntry[] {
    const raw = this.context.globalState.get<HistoryEntry[]>(HISTORY_KEY);
    if (Array.isArray(raw)) {
      return raw;
    }
    return [];
  }

  async addToHistory(entry: HistoryEntry): Promise<void> {
    const current = this.getHistory();
    const updated = [entry, ...current].slice(0, HISTORY_CAP);
    await this.context.globalState.update(HISTORY_KEY, updated);
  }

  async clearHistory(): Promise<void> {
    await this.context.globalState.update(HISTORY_KEY, []);
  }

  async clearState(): Promise<void> {
    this.stateCache = {};
    await this.context.globalState.update(STATE_KEY, undefined);
  }
}
