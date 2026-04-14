export function makeMockContext() {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        (store.has(key) ? store.get(key) : defaultValue) as T | undefined,
      update: (key: string, val: unknown): Thenable<void> => {
        store.set(key, val);
        return Promise.resolve();
      },
      keys: (): readonly string[] => [...store.keys()],
      setKeysForSync: (_keys: readonly string[]): void => {},
    },
    secrets: {
      get: async (_key: string): Promise<string | undefined> => undefined,
      store: async (_key: string, _value: string): Promise<void> => {},
      delete: async (_key: string): Promise<void> => {},
    },
    subscriptions: [] as { dispose(): unknown }[],
  };
}
