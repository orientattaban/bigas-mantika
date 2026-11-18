// backup.js: the backup file (JSON inside a .txt file, because Chrome will not share .json).
// Pure functions only, so the tests can check that backup -> import gives the same totals.

export const BACKUP_APP = 'bigas-mantika';
export const BACKUP_SCHEMA = 2;
export const RECORD_STORES = ['products', 'stockIns', 'customers', 'orders', 'expenses', 'withdrawals', 'stockCounts', 'cashCounts'];

export const LABELS = {
  products: 'Products', stockIns: 'Stock in', customers: 'Customers', orders: 'Orders',
  expenses: 'Expenses', withdrawals: 'Home expenses', stockCounts: 'Stock counts', cashCounts: 'Cash counts',
  changeLog: 'Change log lines',
};

// Settings that belong to this phone and are never copied from a backup.
const PHONE_ONLY = ['installId', 'storagePersisted', 'firstRunAt'];

export function makeBackup({ records, settings, changeLog, appVersion, exportedAt }) {
  const data = {};
  for (const s of RECORD_STORES) data[s] = records[s] || [];
  return JSON.stringify({
    app: BACKUP_APP, schemaVersion: BACKUP_SCHEMA, appVersion, exportedAt,
    installId: settings.installId || '',
    data, settings, changeLog: changeLog || [],
  });
}

// Older backups are brought up to the current layout here.
export function migrateBackup(b) {
  const out = { ...b, data: { ...(b.data || {}) } };
  // Version 1 (Phase 1) had no expenses, withdrawals, stock counts or cash counts.
  for (const s of RECORD_STORES) if (!Array.isArray(out.data[s])) out.data[s] = [];
  out.settings = out.settings || {};
  out.changeLog = out.changeLog || [];
  out.schemaVersion = BACKUP_SCHEMA;
  return out;
}

// Reads the text of a backup file. Returns { ok: true, backup, summary } or { ok: false, error }.
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return { ok: false, error: 'This file is not a Bigas at Mantika backup (it cannot be read).' }; }
  if (!b || b.app !== BACKUP_APP || typeof b.data !== 'object') return { ok: false, error: 'This file is not a Bigas at Mantika backup.' };
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > BACKUP_SCHEMA) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update the app first, then import.' };
  }
  const backup = migrateBackup(b);
  for (const s of RECORD_STORES) {
    if (backup.data[s].some((r) => !r || typeof r.id !== 'string')) return { ok: false, error: 'This backup is damaged (a record has no ID).' };
  }
  return { ok: true, backup, summary: summarize(backup) };
}

export function summarize(backup) {
  const counts = {};
  for (const s of RECORD_STORES) counts[s] = backup.data[s].length;
  counts.changeLog = backup.changeLog.length;
  const dates = [];
  for (const o of backup.data.orders) dates.push(o.dateOrdered);
  for (const s of ['stockIns', 'expenses', 'withdrawals', 'stockCounts', 'cashCounts']) for (const r of backup.data[s]) dates.push(r.date);
  const ds = dates.filter(Boolean).sort();
  return { counts, from: ds[0] || null, to: ds[ds.length - 1] || null, exportedAt: backup.exportedAt, appVersion: backup.appVersion };
}

// Settings after an import: everything from the backup, except this phone's own ID and
// storage status. Lifetime counters and the report number never go down.
export function mergeSettings(current, incoming) {
  const out = { ...incoming };
  for (const k of PHONE_ONLY) {
    if (k in current) out[k] = current[k]; else delete out[k];
  }
  const a = current.counters || {}, b = incoming.counters || {};
  const counters = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) counters[k] = Math.max(a[k] || 0, b[k] || 0);
  out.counters = counters;
  return out;
}
