// demo.js: sample records so Coach can test the app and the game. Every record has
// demo: true, so "Remove demo" takes out only these. Dates are counted back from today:
//   weeks 1–4   trial (Pagsubok)
//   weeks 5–12  after the trial: weeks 6 and 9 have low sales; week 9 also misses the
//               cash count, stock count, backup and report; in week 12 an unpaid order
//               turns 31 days old with no follow-up note
//   week 13     this week, only Monday and Tuesday sales so far (for the walkthrough)
import * as C from './calc.js';

const CUSTOMERS = [
  ['Aling Nena', 'Purok 1'], ['Mang Ramon', 'Purok 2'], ['Liza Sari-sari', 'Purok 3'], ['Carinderia ni Baby', 'Poblacion'],
  ['Kuya Ben', 'Purok 1'], ['Lola Charing', 'Purok 4'], ['Tess Store', 'Purok 2'], ['Jun Dela Cruz', 'Purok 5'],
  ['Mang Pido', 'Purok 3'], ['Ate Joy', 'Poblacion'],
];

// One week of orders: [day (0 = Monday), customer offset, items [[product, pack size, how many]], payment]
// payment: 'full' | 'none' | ['later', days]
const NORMAL = [
  [0, 0, [['b', 25000, 1]], 'full'],
  [1, 1, [['b', 1000, 10], ['m', 1000, 2]], ['later', 3]],
  [2, 2, [['b', 25000, 1]], 'full'],
  [3, 3, [['b', 1000, 10], ['m', 350, 6]], 'full'],
  [4, 4, [['b', 1000, 5], ['m', 1000, 3]], 'full'],
  [5, 5, [['b', 25000, 1], ['m', 1000, 2]], 'full'],
];
const LOW = [
  [0, 0, [['b', 1000, 10], ['m', 1000, 1]], 'full'],
  [2, 2, [['b', 25000, 1]], 'full'],
  [4, 4, [['b', 1000, 10], ['m', 350, 3]], 'full'],
];
const TRIAL = NORMAL.slice(0, 5);
const THIS_WEEK = [
  [0, 0, [['b', 1000, 10], ['m', 1000, 2]], 'full'],
  [1, 1, [['b', 1000, 5], ['m', 350, 3]], 'none'],
];

// Sunday cash count differences in pesos (index = week − 1) and their notes.
const CASH_DIFF = [0, -20, 10, 0, -150, 0, 0, 5, null, 0, -30, 0];
const CASH_NOTE = { 1: 'Gave too much change', 4: 'Bought merienda for the helper, forgot to record it', 10: 'Gave too much change' };
// Saturday stock count: [product, difference in g/ml, reason] (index = week − 1)
const COUNTS = [
  ['b', 0, null], ['m', -50, 'Wet/Damaged'], ['b', -200, 'Wet/Damaged'], ['m', 0, null], ['b', 0, null], ['m', 0, null],
  ['b', -300, "Don't know"], ['m', 0, null], null, ['b', 100, "Don't know"], ['m', 0, null], ['b', -200, 'Wet/Damaged'],
];

export function makeDemo({ today, products, newId }) {
  const kg = products.find((p) => p.id === 'p-bigas') || products.find((p) => p.baseUnit === 'kg');
  const L = products.find((p) => p.id === 'p-mantika') || products.find((p) => p.baseUnit === 'L');
  if (!kg || !L) return null;
  const prod = { b: kg, m: L };
  const goLive = C.addDays(C.weekStart(today), -84);
  let n = 0;
  const stampOf = (date) => { n += 1; return `${date}T${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`; };
  const label = (p, size) => (p.packagings.find((x) => x.sizeInBase === size) || { label: C.formatBase(size, p.baseUnit) }).label;

  const out = { customers: [], stockIns: [], orders: [], expenses: [], withdrawals: [], stockCounts: [], cashCounts: [], capital: [], backupDates: [], reportDates: [], goLiveDate: goLive };
  const all = () => ({ ...out, products });
  const rec = (date, extra) => { const s = stampOf(date); return { status: 'active', demo: true, createdAt: s, updatedAt: s, ...extra }; };

  out.capital.push({ id: newId('cap'), date: goLive, amount: 1500000, note: 'Pilot capital (demo)', ...rec(goLive, {}) });
  CUSTOMERS.forEach(([name, area]) => {
    out.customers.push({ id: newId('c'), name, phone: '', phoneNorm: '', area, note: 'Demo customer', source: 'manual', ...rec(goLive, {}) });
  });

  const later = []; // payments due later: { order, date }
  let custTurn = 0;
  const buy = (date, pk, size, qty, pesos, supplier) => {
    const p = prod[pk];
    out.stockIns.push({ id: newId('s'), date, productId: p.id, packagingLabel: label(p, size), qty, qtyBase: size * qty, totalCost: pesos * 100, supplier, note: '', ...rec(date, {}) });
  };
  const sell = (date, ci, items, pay, note = '') => {
    const avgs = C.averageCosts(out.stockIns, out.orders, out);
    const lines = items.map(([pk, size, qty]) => {
      const p = prod[pk];
      const pricePerUnit = C.prefillUnitPrice(p.sellPricePerBase, size);
      return { productId: p.id, packagingLabel: label(p, size), qty, qtyBase: size * qty, pricePerUnit,
        lineTotal: C.lineTotalOf(qty * 1000, pricePerUnit), costPerBaseAtSale: avgs[p.id] ? avgs[p.id].avg : 0 };
    });
    const total = lines.reduce((t, l) => t + l.lineTotal, 0);
    const o = { id: newId('o'), customerId: out.customers[ci % out.customers.length].id, dateOrdered: date, cancelReason: null, items: lines, total,
      delivery: { status: 'delivered', dateDelivered: date }, payments: [], note, stockShort: false, ...rec(date, {}) };
    if (pay === 'full') o.payments.push({ id: newId('pay'), date, amount: total, ref: '', kind: 'payment', createdAt: o.createdAt });
    else if (Array.isArray(pay)) later.push({ o, date: C.addDays(date, pay[1]) });
    out.orders.push(o);
    return o;
  };

  for (let day = 0; day <= 90; day++) {
    const date = C.addDays(goLive, day);
    if (date > today) break;
    const week = Math.floor(day / 7) + 1; // 1..13
    const dow = day % 7;                  // 0 = Monday … 6 = Sunday

    for (let i = later.length - 1; i >= 0; i--) {
      if (later[i].date !== date) continue;
      const { o } = later[i];
      o.payments.push({ id: newId('pay'), date, amount: o.total, ref: '', kind: 'payment', createdAt: stampOf(date) });
      later.splice(i, 1);
    }

    if (dow === 0) {
      if (day === 0) { buy(date, 'b', 50000, 2, 4500, 'Rice mill'); buy(date, 'm', 1000, 20, 1800, 'Palengke'); }
      else if (week < 13) {
        const inv = C.inventory(products, out.stockIns, out.orders, out);
        if (inv[kg.id] < 110000) buy(date, 'b', 50000, 2, week < 7 ? 4500 : 4600, 'Rice mill');
        if (inv[L.id] < 12000) buy(date, 'm', 1000, 10, week < 7 ? 900 : 920, 'Palengke');
      }
      if (week % 2 === 1) out.expenses.push({ id: newId('e'), date, category: 'Load', amount: 5000, note: '', ...rec(date, {}) });
    }
    if (dow === 2 && week % 3 === 0) out.expenses.push({ id: newId('e'), date, category: 'Plastic/Sacks', amount: 6000, note: 'Plastic bags', ...rec(date, {}) });

    const plan = week === 13 ? THIS_WEEK : week <= 4 ? TRIAL : (week === 6 || week === 9) ? LOW : NORMAL;
    for (const [d, c, items, pay] of plan) if (d === dow) sell(date, custTurn++ + c, items, pay);
    // The order that becomes "old unpaid": week 8, Thursday, still not paid.
    if (week === 8 && dow === 3) sell(date, 8, [['b', 1000, 3]], 'none', 'Will pay next week');

    if (dow === 5 && week < 13) {
      out.expenses.push({ id: newId('e'), date, category: 'Delivery/Fuel', amount: 10000, note: 'Tricycle gas', ...rec(date, {}) });
      const ct = COUNTS[week - 1];
      if (ct) {
        const p = prod[ct[0]];
        const systemBase = C.inventory(products, out.stockIns, out.orders, out)[p.id];
        const avg = C.averageCosts(out.stockIns, out.orders, out)[p.id].avg;
        out.stockCounts.push({ id: newId('k'), date, productId: p.id, countedBase: systemBase + ct[1], systemBase, difference: ct[1],
          costPerBaseAtCount: avg, reason: ct[2], note: '', ...rec(date, {}) });
      }
      if (week === 7) {
        const avg = C.averageCosts(out.stockIns, out.orders, out)[kg.id].avg;
        out.withdrawals.push({ id: newId('w'), date, type: 'goods', category: 'From stock', productId: kg.id, qtyBase: 2000, costPerBase: avg, amount: C.lineCost(2000, avg),
          note: 'Rice for the house', ...rec(date, {}) });
      }
    }

    if (dow === 6 && week < 13) {
      if (week === 4) out.withdrawals.push({ id: newId('w'), date, type: 'cash', category: 'Medicine', amount: 30000, note: 'Medicine for Lola', ...rec(date, {}) });
      if (week === 10) out.withdrawals.push({ id: newId('w'), date, type: 'cash', category: 'School', amount: 50000, note: 'School allowance', ...rec(date, {}) });
      if (week === 11) out.withdrawals.push({ id: newId('w'), date, type: 'cash', category: 'Food', amount: 25000, note: 'Ulam for the family', ...rec(date, {}) });
      if (week === 12) out.withdrawals.push({ id: newId('w'), date, type: 'cash', category: 'Bills', amount: 35000, note: 'Electric bill', ...rec(date, {}) });
      const diff = CASH_DIFF[week - 1];
      if (diff != null) {
        const computed = C.computedCash(all(), date);
        out.cashCounts.push({ id: newId('cc'), date, countedCash: computed + diff * 100, computedCash: computed, difference: diff * 100,
          note: CASH_NOTE[week - 1] || '', ...rec(date, {}) });
        out.backupDates.push(date);
        out.reportDates.push(date);
      }
    }
  }
  return out;
}
