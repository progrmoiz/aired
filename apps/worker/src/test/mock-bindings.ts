// Minimal in-memory stand-ins for the Cloudflare bindings used by the routes
// under test. Only the methods actually exercised by api.ts / auth.ts /
// authMiddleware are implemented.

export class MemoryKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class MemoryBucket {
  private store = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export const noopExecutionContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;
