/**
 * IndexedDB key-value storage for zustand `persist`. One object store, string
 * values (the JSON zustand already writes). If IndexedDB is missing or blocked
 * (private windows, some embedded browsers) it falls back to memory, so the
 * app still runs; it just forgets on reload.
 */
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'moltol';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = conn.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const memory = new Map<string, string>();

export const idbStorage: StateStorage = {
  getItem: async (key) => {
    try {
      return (await run<string | undefined>('readonly', (s) => s.get(key))) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem: async (key, value) => {
    memory.set(key, value);
    try {
      await run('readwrite', (s) => s.put(value, key));
    } catch {
      /* memory copy is the fallback */
    }
  },
  removeItem: async (key) => {
    memory.delete(key);
    try {
      await run('readwrite', (s) => s.delete(key));
    } catch {
      /* nothing to clean up */
    }
  },
};
