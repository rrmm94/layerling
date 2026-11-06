import { scopedDatabase } from "@/lib/classroom/client";
/*
 * The card pictures of the designs in this browser, in a database of their own. They used to sit in the list of
 * designs in localStorage, and enough of them filled it up until the list could not be saved (#656). A picture
 * that cannot be kept here is no loss: the card shows none, and the next time the design is open it gets a new one.
 */

const DB_NAME = "layerling-design-thumbnails";
const DB_VERSION = 1;
const STORE = "thumbnails";

type StoredThumbnail = { id: string; dataUrl: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser keeps no local database"));
      return;
    }
    const request = indexedDB.open(scopedDatabase(DB_NAME), DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the card pictures"));
    request.onblocked = () => reject(new Error("The card pictures are busy in another tab"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result: T | undefined;
      const request = work(transaction.objectStore(STORE));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("The card pictures could not be written"));
      transaction.onabort = () => reject(transaction.error ?? new Error("The card pictures could not be written"));
    });
  } finally {
    db.close();
  }
}

/** Every picture kept, by design id. Never fails: without a database there are simply none. */
export async function loadDesignThumbnails(): Promise<Map<string, string>> {
  try {
    const all = (await withStore<StoredThumbnail[]>("readonly", (store) => store.getAll() as IDBRequest<StoredThumbnail[]>)) ?? [];
    return new Map(all.filter((entry) => typeof entry?.id === "string" && typeof entry.dataUrl === "string").map((entry) => [entry.id, entry.dataUrl]));
  } catch {
    return new Map();
  }
}

export async function saveDesignThumbnail(id: string, dataUrl: string): Promise<void> {
  await withStore("readwrite", (store) => {
    store.put({ id, dataUrl } satisfies StoredThumbnail);
  });
}

export async function deleteDesignThumbnail(id: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => {
      store.delete(id);
    });
  } catch {
    // A picture left behind only takes a little room; nothing shows it without its card.
  }
}
