type MockStore = Map<string, unknown>;

const configurationStore = new Map<string, MockStore>();
const registeredCommands: string[] = [];

function makeDisposable(fn?: () => void) {
  return {
    dispose: fn ?? (() => {}),
  };
}

function getSectionStore(section: string): MockStore {
  const key = section || '';
  let store = configurationStore.get(key);
  if (!store) {
    store = new Map<string, unknown>();
    configurationStore.set(key, store);
  }
  return store;
}

export const ConfigurationTarget = {
  Global: 1,
};

export const workspace = {
  getConfiguration: (section = '') => ({
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (getSectionStore(section).has(key)
        ? getSectionStore(section).get(key)
        : defaultValue) as T | undefined,
    update: (key: string, value: unknown): Thenable<void> => {
      getSectionStore(section).set(key, value);
      return Promise.resolve();
    },
  }),
  onDidChangeConfiguration: jest.fn(() => makeDisposable()),
};

export function resetMockWorkspace(): void {
  configurationStore.clear();
}

export function setMockConfiguration(section: string, values: Record<string, unknown>): void {
  const store = getSectionStore(section);
  store.clear();
  for (const [key, value] of Object.entries(values)) {
    store.set(key, value);
  }
}

export function getMockConfiguration(section: string): Record<string, unknown> {
  return Object.fromEntries(getSectionStore(section));
}

const outputChannel = {
  appendLine: jest.fn(),
  dispose: jest.fn(),
};

export const window = {
  createOutputChannel: jest.fn(() => outputChannel),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  activeTextEditor: undefined,
};

export const commands = {
  registerCommand: jest.fn((command: string) => {
    registeredCommands.push(command);
    return makeDisposable();
  }),
  executeCommand: jest.fn(() => Promise.resolve(undefined)),
};

export function resetMockWindow(): void {
  outputChannel.appendLine.mockReset();
  outputChannel.dispose.mockReset();
  window.createOutputChannel.mockClear();
  window.showInformationMessage.mockClear();
  window.showWarningMessage.mockClear();
  window.showErrorMessage.mockClear();
  window.activeTextEditor = undefined;
}

export function resetRegisteredCommands(): void {
  registeredCommands.length = 0;
  commands.registerCommand.mockClear();
  commands.executeCommand.mockClear();
  workspace.onDidChangeConfiguration.mockClear();
}

export function getRegisteredCommands(): string[] {
  return [...registeredCommands];
}

export function makeMockContext(options?: {
  globalState?: Record<string, unknown>;
  secrets?: Record<string, string>;
}) {
  const globalStateStore = new Map<string, unknown>(Object.entries(options?.globalState ?? {}));
  const secretStore = new Map<string, string>(Object.entries(options?.secrets ?? {}));

  return {
    globalState: {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        (globalStateStore.has(key) ? globalStateStore.get(key) : defaultValue) as T | undefined,
      update: (key: string, val: unknown): Thenable<void> => {
        globalStateStore.set(key, val);
        return Promise.resolve();
      },
      keys: (): readonly string[] => [...globalStateStore.keys()],
      setKeysForSync: (_keys: readonly string[]): void => {},
    },
    secrets: {
      get: async (key: string): Promise<string | undefined> => secretStore.get(key),
      store: async (key: string, value: string): Promise<void> => {
        secretStore.set(key, value);
      },
      delete: async (key: string): Promise<void> => {
        secretStore.delete(key);
      },
    },
    subscriptions: [] as { dispose(): unknown }[],
    __mock: {
      globalStateStore,
      secretStore,
    },
  };
}
