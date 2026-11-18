// demo.js: sample records so Coach can test the app. Every record has demo: true,
// so "Remove demo" takes out only these. Dates are counted back from today.
import * as C from './calc.js';

const CUSTOMERS = [
  ['Aling Nena', 'Purok 1'], ['Mang Ramon', 'Purok 2'], ['Liza Sari-sari', 'Purok 3'], ['Carinderia ni Baby', 'Poblacion'],
  ['Kuya Ben', 'Purok 1'], ['Lola Charing', 'Purok 4'], ['Tess Store', 'Purok 2'], ['Jun Dela Cruz', 'Purok 5'],
];

// [days ago, customer, items [[product 'b'|'m', pack size, how many, price per pack or null]], payment, options]
// payment: 'full' | 'none' | ['part', pesos] | ['later', days ago]
const ORDERS = [
  [68, 1, [['b', 1000, 10]], 'none'],
  [66, 0, [['b', 1000, 5]], 'full'],
  [63, 2, [['m', 350, 3]], 'full'],
  [60, 3, [['b', 1000, 10], ['m', 1000, 2]], ['later', 55]],
  [56, 4, [['b', 25000, 1]], ['part', 800]],
  [53, 5, [['b', 1000, 5], ['m', 1000, 1]], 'full'],
  [49, 6, [['m', 700, 2]], 'full'],
  [45, 0, [['b', 1000, 5]], 'full'],
  [42, 7, [['b', 25000, 1, 125000]], 'full'],
  [38, 2, [['m', 350, 6]], 'full'],
  [35, 1, [['b', 1000, 3]], ['later', 30]],
  [33, 3, [['b', 25000, 1]], 'full'],
  [28, 5, [['b', 1000, 10]], 'none'],
  [26, 6, [['m', 1000, 2]], 'full'],
  [24, 0, [['b', 1000, 5]], 'full'],
  [21, 4, [['b', 1000, 5]], 'none', { cancel: 'Customer changed mind' }],
  [20, 7, [['b', 25000, 1]], 'full'],
  [17, 2, [['m', 350, 4]], 'full'],
  [14, 3, [['b', 1000, 10], ['m', 1000, 1]], 'full'],
  [10, 5, [['b', 1000, 5]], ['part', 100]],
  [8, 6, [['m', 700, 1]], 'full'],
  [6, 0, [['b', 1000, 5]], 'full'],
  [5, 1, [['b', 25000, 1]], 'full'],
  [4, 7, [['b', 1000, 10]], 'none'],
  [3, 2, [['m', 350, 3]], 'full'],
  [2, 3, [['b', 1000, 5], ['m', 1000, 1]], 'none', { pending: true }],
  [1, 4, [['m', 1000, 2]], 'full', { pending: true }],
];

// [days ago, product, pack size, how many, total cost in pesos, supplier]
const STOCK_INS = [
  [70, 'b', 50000, 3, 6750, 'Rice mill'],
  [70, 'm', 1000, 20, 1800, 'Palengke'],
  [40, 'b', 50000, 1, 2400, 'Rice mill'],
  [27, 'm', 1000, 10, 1000, 'Palengke'],
  [10, 'b', 50000, 1, 2500, 'Rice mill'],
];

// [days ago, category, pesos, note]
const EXPENSES = [
  [66, 'Plastic/Sacks', 60, 'Plastic bags'], [60, 'Load', 50, ''], [35, 'Plastic/Sacks', 60, 'Plastic bags'],
  [30, 'Load', 50, ''], [1, 'Load', 50, ''],
  ...[63, 56, 49, 42, 35, 28, 21, 14, 7].map((d) => [d, 'Delivery/Fuel', 100, 'Tricycle gas']),
];

export function makeDemo({ today, products, newId }) {
  const kg = products.find((p) => p.id === 'p-bigas') || products.find((p) => p.baseUnit === 'kg');
  const L = products.find((p) => p.id === 'p-mantika') || products.find((p) => p.baseUnit === 'L');
  if (!kg || !L) return null;
  const prod = { b: kg, m: L };
  const dateOf = (ago) => C.addDays(today, -ago);
  let n = 0;
  const stampOf = (ago) => { n += 1; return `${dateOf(ago)}T${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`; };
  const label = (p, size) => (p.packagings.find((x) => x.sizeInBase === size) || { label: C.formatBase(size, p.baseUnit) }).label;

  const out = { customers: [], stockIns: [], orders: [], expenses: [], withdrawals: [], stockCounts: [], cashCounts: [], capital: [] };
  const firstDay = dateOf(70);
  out.capital.push({ id: newId('cap'), date: firstDay, amount: 1500000, note: 'Pilot capital (demo)', status: 'active', demo: true, createdAt: stampOf(70) });
  CUSTOMERS.forEach(([name, area]) => {
    const s = stampOf(70);
    out.customers.push({ id: newId('c'), name, phone: '', phoneNorm: '', area, note: 'Demo customer', source: 'manual', demo: true, createdAt: s, updatedAt: s });
  });

  // Put every dated event in time order, so average costs and expected cash are right.
  const ev = [];
  STOCK_INS.forEach((x) => ev.push({ ago: x[0], k: 0, x }));
  ORDERS.forEach((x) => ev.push({ ago: x[0], k: 1, x }));
  EXPENSES.forEach((x) => ev.push({ ago: x[0], k: 2, x }));
  ev.push({ ago: 30, k: 3, x: { type: 'cash', pesos: 500, note: 'School allowance' } });
  ev.push({ ago: 12, k: 3, x: { type: 'goods', p: 'b', qtyBase: 2000, note: 'Rice for the house' } });
  ev.push({ ago: 21, k: 4, x: { p: 'm', diff: 0, reason: null } });
  ev.push({ ago: 7, k: 4, x: { p: 'b', diff: -500, reason: 'Wet/Damaged' } });
  // Cash counts on the last two Sundays before today.
  let sun = C.addDays(today, -1);
  while (C.dayOfWeek(sun) !== 0) sun = C.addDays(sun, -1);
  const sunAgo = C.daysBetween(sun, today);
  ev.push({ ago: sunAgo + 7, k: 5, x: { diff: 0, note: '' } });
  ev.push({ ago: sunAgo, k: 5, x: { diff: -2000, note: 'Gave too much change' } });
  ev.sort((a, b) => b.ago - a.ago || a.k - b.k);

  const all = () => ({ ...out, products });
  const payLater = [];
  for (const e of ev) {
    const date = dateOf(e.ago);
    if (e.k === 0) {
      const [, pk, size, qty, pesos, supplier] = e.x;
      const p = prod[pk];
      const s = stampOf(e.ago);
      out.stockIns.push({ id: newId('s'), date, productId: p.id, packagingLabel: label(p, size), qty, qtyBase: size * qty, totalCost: pesos * 100,
        supplier, note: '', status: 'active', demo: true, createdAt: s, updatedAt: s });
    } else if (e.k === 1) {
      const [, ci, items, pay, opt = {}] = e.x;
      const avgs = C.averageCosts(out.stockIns, out.orders, out);
      const s = stampOf(e.ago);
      const lines = items.map(([pk, size, qty, price]) => {
        const p = prod[pk];
        const pricePerUnit = price ?? C.prefillUnitPrice(p.sellPricePerBase, size);
        return { productId: p.id, packagingLabel: label(p, size), qty, qtyBase: size * qty, pricePerUnit,
          lineTotal: C.lineTotalOf(qty * 1000, pricePerUnit), costPerBaseAtSale: avgs[p.id] ? avgs[p.id].avg : 0 };
      });
      const total = lines.reduce((t, l) => t + l.lineTotal, 0);
      const o = {
        id: newId('o'), customerId: out.customers[ci].id, dateOrdered: date, status: 'active', cancelReason: null,
        items: lines, total,
        delivery: opt.pending ? { status: 'pending', dateDelivered: null } : { status: 'delivered', dateDelivered: date },
        payments: [], note: '', stockShort: false, demo: true, createdAt: s, updatedAt: s,
      };
      if (pay === 'full') o.payments.push({ id: newId('pay'), date, amount: total, ref: '', kind: 'payment', createdAt: s });
      else if (Array.isArray(pay) && pay[0] === 'part') o.payments.push({ id: newId('pay'), date, amount: pay[1] * 100, ref: '', kind: 'payment', createdAt: s });
      else if (Array.isArray(pay) && pay[0] === 'later') payLater.push({ o, ago: pay[1] });
      if (opt.cancel) {
        const cs = stampOf(e.ago);
        Object.assign(o, { status: 'cancelled', cancelReason: opt.cancel, cancelledAt: cs, cancelledDate: date, updatedAt: cs });
      }
      out.orders.push(o);
    } else if (e.k === 2) {
      const [, category, pesos, note] = e.x;
      const s = stampOf(e.ago);
      out.expenses.push({ id: newId('e'), date, category, amount: pesos * 100, note, status: 'active', demo: true, createdAt: s, updatedAt: s });
    } else if (e.k === 3) {
      const s = stampOf(e.ago);
      if (e.x.type === 'cash') {
        out.withdrawals.push({ id: newId('w'), date, type: 'cash', amount: e.x.pesos * 100, note: e.x.note, status: 'active', demo: true, createdAt: s, updatedAt: s });
      } else {
        const p = prod[e.x.p];
        const avg = C.averageCosts(out.stockIns, out.orders, out)[p.id].avg;
        out.withdrawals.push({ id: newId('w'), date, type: 'goods', productId: p.id, qtyBase: e.x.qtyBase, costPerBase: avg,
          amount: C.lineCost(e.x.qtyBase, avg), note: e.x.note, status: 'active', demo: true, createdAt: s, updatedAt: s });
      }
    } else if (e.k === 4) {
      const p = prod[e.x.p];
      const systemBase = C.inventory(products, out.stockIns, out.orders, out)[p.id];
      const avg = C.averageCosts(out.stockIns, out.orders, out)[p.id].avg;
      const s = stampOf(e.ago);
      out.stockCounts.push({ id: newId('k'), date, productId: p.id, countedBase: systemBase + e.x.diff, systemBase, difference: e.x.diff,
        costPerBaseAtCount: avg, reason: e.x.reason, status: 'active', demo: true, createdAt: s, updatedAt: s });
    } else if (e.k === 5) {
      // later payments dated on or before this count must be in before counting
      flushPayments(e.ago);
      const computed = C.computedCash(all(), date);
      const s = stampOf(e.ago);
      out.cashCounts.push({ id: newId('cc'), date, countedCash: computed + e.x.diff, computedCash: computed, difference: e.x.diff,
        note: e.x.note, status: 'active', demo: true, createdAt: s, updatedAt: s });
    }
    flushPayments(e.ago);
  }
  flushPayments(-1);

  function flushPayments(ago) {
    for (let i = payLater.length - 1; i >= 0; i--) {
      const { o, ago: payAgo } = payLater[i];
      if (payAgo < ago) continue;
      o.payments.push({ id: newId('pay'), date: dateOf(payAgo), amount: o.total, ref: '', kind: 'payment', createdAt: stampOf(payAgo) });
      payLater.splice(i, 1);
    }
  }
  return out;
}
