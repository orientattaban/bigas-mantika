// db.js: saves everything on the phone in IndexedDB.
// Every schema change gets a new DB_VERSION and a migration step in onupgradeneeded
// that keeps existing data. Nothing is ever deleted: records are cancelled or reversed.

export const DB_NAME = 'bigas-mantika';
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

const STORES = ['products', 'stockIns', 'customers', 'orders', 'settings', 'changeLog'];

let db = null;

export function newId(prefix) {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + '-' + Date.now().toString(36) + '-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const nowStamp = () => new Date().toISOString(); // timestamps only; business dates use todayManila()

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      const from = e.oldVersion;
      // Migration to version 1: first stores.
      if (from < 1) {
        for (const s of ['products', 'stockIns', 'customers', 'orders']) d.createObjectStore(s, { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'key' });
        d.createObjectStore('changeLog', { keyPath: 'seq', autoIncrement: true });
      }
      // Future: if (from < 2) { ... add Phase 2 stores ... }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function loadAll() {
  const t = db.transaction(STORES.filter((s) => s !== 'changeLog'), 'readonly');
  const out = {};
  for (const s of ['products', 'stockIns', 'customers', 'orders']) out[s] = await reqP(t.objectStore(s).getAll());
  const settingsRows = await reqP(t.objectStore('settings').getAll());
  out.settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  return out;
}

export function isStorageFull(err) {
  return err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
}

/**
 * Saves records and one ChangeLog line in a single transaction, so either all of it
 * is saved or none of it.
 *   puts:     [{ store, value }]
 *   log:      { action: 'create'|'edit'|'cancel'|'import', entity, id, summary }
 *   counters: names of lifetime counters to add 1 to (they only ever go up)
 */
export function commit({ puts = [], log = null, counters = [] }, settings) {
  return new Promise((resolve, reject) => {
    const stores = new Set(puts.map((p) => p.store));
    if (log) stores.add('changeLog');
    if (counters.length) stores.add('settings');
    const t = db.transaction([...stores], 'readwrite');
    for (const p of puts) t.objectStore(p.store).put(p.value);
    if (log) t.objectStore('changeLog').add({ timestamp: nowStamp(), ...log });
    if (counters.length) {
      const c = { ...(settings.counters || {}) };
      for (const k of counters) c[k] = (c[k] || 0) + 1;
      t.objectStore('settings').put({ key: 'counters', value: c });
      settings.counters = c;
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

export function putSetting(key, value) {
  const t = db.transaction(['settings'], 'readwrite');
  t.objectStore('settings').put({ key, value });
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

// Default products, all editable on the phone. Sizes in grams or millilitres;
// prices in centavos per kg or L (Pearl's starting values, 17 Nov 2026).
export function defaultProducts(stamp) {
  return [
    {
      id: 'p-bigas', name: 'Bigas', baseUnit: 'kg', sellPricePerBase: 5200, lowStockAt: null, active: true,
      packagings: [
        { label: 'kilo', sizeInBase: 1000 },
        { label: 'half kilo', sizeInBase: 500 },
        { label: 'sack 25 kg', sizeInBase: 25000 },
        { label: 'sack 50 kg', sizeInBase: 50000 },
        { label: 'salop', sizeInBase: 2250, note: 'Check how many kg your salop is' },
      ],
      createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'p-mantika', name: 'Mantika', baseUnit: 'L', sellPricePerBase: 11000, lowStockAt: null, active: true,
      packagings: [
        { label: 'liter', sizeInBase: 1000 },
        { label: 'gin bilog bottle (350 ml)', sizeInBase: 350 },
        { label: 'kwatro kantos (700 ml)', sizeInBase: 700 },
        { label: 'gallon', sizeInBase: 3785, note: 'Check the label' },
      ],
      createdAt: stamp, updatedAt: stamp,
    },
  ];
}
