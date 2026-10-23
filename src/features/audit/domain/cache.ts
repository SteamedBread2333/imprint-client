import type { GraphData } from "./contracts";

const DB_NAME = "imprint-desk";
const STORE = "graph";
const DB_VERSION = 1;

export type CachedGraph = GraphData & { cached_at: string; vault: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedGraph(vaultKey: string): Promise<CachedGraph | null> {
  if (!vaultKey) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(vaultKey);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as CachedGraph | undefined) ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function putCachedGraph(vaultKey: string, graph: GraphData): Promise<void> {
  if (!vaultKey) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(
      { ...graph, cached_at: new Date().toISOString(), vault: vaultKey },
      vaultKey,
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function clearAuditCache(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("audit cache is in use"));
  });
}
