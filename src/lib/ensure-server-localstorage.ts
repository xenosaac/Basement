const globalWithStorage = globalThis as typeof globalThis & {
  localStorage?: Storage;
};

if (typeof window === "undefined") {
  const storage = new Map<string, string>();

  Object.defineProperty(globalWithStorage, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } satisfies Storage,
  });
}

export {};
