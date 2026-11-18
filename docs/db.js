// db.js: saves everything on the phone in IndexedDB.
// Every schema change gets a new DB_VERSION and a migration step in onupgradeneeded
// that keeps existing data. Nothing is ever deleted: records are cancelled or reversed.

export const DB_NAME = 'bigas-mantika';
export const DB_VERSION = 2;
export const SCHEMA_VERSION = 2;

export const RECORD_STORES = ['products', 'stockIns', 'customers', 'orders', 'expenses', 'withdrawals', 'stockCounts', 'cashCounts'];
const STORES = [...RECORD_STORES, 'settings', 'changeLog'];

let db = null;

export function newId(prefix) {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + '-' + Date.now().toString(36) + '-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const nowStamp = () => new Date().toISOString(); // timestamps only; business dates use todayManila()

// onBlocked: called when an older copy of the app (another tab) still has the database open.
// The upgrade waits until that tab closes or reloads; it does not fail.
export function openDb(onBlocked = () => {}) {
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
      // Migration to version 2 (Phase 2): expenses, cash/goods taken out, stock counts, cash counts.
      // Existing stores and records are kept as they are.
      if (from < 2) {
        for (const s of ['expenses', 'withdrawals', 'stockCounts', 'cashCounts']) d.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      // Another tab or a newer version wants the database: let go, then reload.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => onBlocked();
  });
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function loadAll() {
  const t = db.transaction(STORES.filter((s) => s !== 'changeLog'), 'readonly');
  const out = {};
  for (const s of RECORD_STORES) out[s] = await reqP(t.objectStore(s).getAll());
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

export async function getChangeLog() {
  const t = db.transaction(['changeLog'], 'readonly');
  return reqP(t.objectStore('changeLog').getAll());
}

function done(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

/**
 * Import a backup: replaces every record, setting and change-log line in one transaction,
 * then adds one "import" line to the change log. If anything fails, nothing changes.
 */
export function replaceAll({ records, settings, changeLog }, log) {
  const t = db.transaction(STORES, 'readwrite');
  for (const s of STORES) t.objectStore(s).clear();
  for (const s of RECORD_STORES) for (const r of records[s] || []) t.objectStore(s).put(r);
  for (const [key, value] of Object.entries(settings)) t.objectStore('settings').put({ key, value });
  for (const line of changeLog || []) t.objectStore('changeLog').put(line);
  if (log) t.objectStore('changeLog').add({ timestamp: nowStamp(), ...log });
  return done(t);
}

/**
 * Demo data on or off in one transaction: puts and deletes records, saves settings,
 * adds one change-log line. Used only for demo records (they carry demo: true).
 */
export function applyDemo({ puts = [], deletes = [], settings = {} }, log) {
  const t = db.transaction(STORES, 'readwrite');
  for (const p of puts) t.objectStore(p.store).put(p.value);
  for (const d of deletes) t.objectStore(d.store).delete(d.id);
  for (const [key, value] of Object.entries(settings)) t.objectStore('settings').put({ key, value });
  if (log) t.objectStore('changeLog').add({ timestamp: nowStamp(), ...log });
  return done(t);
}
