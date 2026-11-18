// calc.js: all business maths. Pure functions only (no screen, no storage),
// so the same file runs in the browser and in Node (tests/calc.test.js).
//
// Units used everywhere:
//   money      = whole centavos (₱38.50 is 3850)
//   quantities = whole grams (rice) or millilitres (oil)   ("base units")
//   prices and costs "per kg or L" = centavos per 1,000 base units
//   pack counts (qty) are kept as whole thousandths (1.5 packs = 1500) while calculating
//   dates      = "YYYY-MM-DD" strings, Philippine time

// ---------- parsing typed numbers (no floating-point money) ----------

// "1,234.5" -> 123450 centavos. Returns null if it is not a valid amount.
export function parsePeso(text) {
  const s = String(text ?? '').replace(/[₱,\s]/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
  const whole = m[1] === '' ? 0 : parseInt(m[1], 10);
  const cents = parseInt(((m[2] || '') + '00').slice(0, 2), 10);
  return whole * 100 + cents;
}

// "1.5" -> 1500 (thousandths). Up to 3 decimals. Returns null if invalid.
export function parseQtyMilli(text) {
  const s = String(text ?? '').replace(/[,\s]/g, '');
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
  const whole = m[1] === '' ? 0 : parseInt(m[1], 10);
  const frac = parseInt(((m[2] || '') + '000').slice(0, 3), 10);
  return whole * 1000 + frac;
}

// ---------- formatting ----------

export function formatPeso(centavos) {
  const neg = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const pesos = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = String(abs % 100).padStart(2, '0');
  return (neg ? '-' : '') + '₱' + pesos + '.' + cents;
}

// 1050 (ml) -> "1.05 L"; 62500 (g) -> "62.5 kg"
export function formatBase(base, unit) {
  const neg = base < 0;
  const abs = Math.abs(Math.round(base));
  const whole = Math.floor(abs / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '') + ' ' + unit;
}

// 1500 -> "1.5"
export function formatQty(qtyMilli) {
  const whole = Math.floor(qtyMilli / 1000);
  const frac = String(qtyMilli % 1000).padStart(3, '0').replace(/0+$/, '');
  return whole + (frac ? '.' + frac : '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-17" -> "17 Nov 2026"
export function formatDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Today's date in the Philippines, whatever the phone's time zone.
export function todayManila(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Whole days from ymdA to ymdB (B later = positive).
export function daysBetween(ymdA, ymdB) {
  const a = Date.UTC(...ymdA.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...ymdB.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

// ---------- phone numbers ----------

// "+63 917 123 4567", "63917...", "0917-123-4567", "917 123 4567" -> "09171234567"
export function normalizePhone(text) {
  let d = String(text ?? '').replace(/\D/g, '');
  if (d.startsWith('63') && d.length === 12) d = '0' + d.slice(2);
  else if (d.startsWith('9') && d.length === 10) d = '0' + d;
  return d;
}

// ---------- order lines ----------

// Pack size in g/ml × pack count (thousandths) -> base units
export function qtyBaseOf(qtyMilli, sizeInBase) {
  return Math.round((qtyMilli * sizeInBase) / 1000);
}

// Suggested price for one pack: price per kg/L × size, rounded to the nearest ₱0.50.
export function prefillUnitPrice(sellPricePerBase, sizeInBase) {
  return Math.round((sellPricePerBase * sizeInBase) / 50000) * 50;
}

export function lineTotalOf(qtyMilli, pricePerUnit) {
  return Math.round((qtyMilli * pricePerUnit) / 1000);
}

// Cost of a line in centavos, from base quantity and cost per kg/L.
export function lineCost(qtyBase, costPerBase) {
  return Math.round((qtyBase * costPerBase) / 1000);
}

// ---------- payments ----------

export function paidAmount(order) {
  return (order.payments || []).reduce((s, p) => s + p.amount, 0);
}

export function balanceOf(order) {
  if (order.status === 'cancelled') return 0;
  return Math.max(0, order.total - paidAmount(order));
}

// "paid" | "partial" | "unpaid" | "cancelled"
export function paymentStatus(order) {
  if (order.status === 'cancelled') return 'cancelled';
  const paid = paidAmount(order);
  if (paid >= order.total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

// ---------- stock ----------

const isActive = (r) => r.status !== 'cancelled';
const goodsOut = (w) => isActive(w) && w.type === 'goods';

// Remaining stock per product, in base units:
//   stock in − active order lines (a return line is negative, so it adds back)
//   − goods taken for home use + stock-count adjustments (counted − expected).
// `more` may hold { withdrawals, stockCounts }.
export function inventory(products, stockIns, orders, more = {}) {
  const inv = {};
  const add = (id, q) => { inv[id] = (inv[id] || 0) + q; };
  for (const p of products) inv[p.id] = 0;
  for (const s of stockIns) if (isActive(s)) add(s.productId, s.qtyBase);
  for (const o of orders) {
    if (!isActive(o)) continue;
    for (const it of o.items) add(it.productId, -it.qtyBase);
  }
  for (const w of more.withdrawals || []) if (goodsOut(w)) add(w.productId, -w.qtyBase);
  for (const c of more.stockCounts || []) if (isActive(c)) add(c.productId, c.difference);
  return inv;
}

// Moving-average cost per kg or L (centavos), replaying stock movements in the order
// they were entered. Returns { [productId]: { onHand, avg } }.
//  - stock in: avg = (onHand × avg + cost) ÷ (onHand + qty)   (onHand below 0 counts as 0)
//  - goods coming back (cancelled order, return line): same formula at the cost saved on the line
//  - goods going out (sale, home use, count shortfall): stock goes down, avg unchanged
//  - cancelled stock-in, withdrawal or count: left out completely
export function averageCosts(stockIns, orders, more = {}) {
  const events = [];
  for (const s of stockIns) if (isActive(s)) events.push({ t: s.createdAt, k: 0, s });
  for (const o of orders) {
    events.push({ t: o.createdAt, k: 1, o, sign: -1 });
    if (o.status === 'cancelled') events.push({ t: o.cancelledAt || o.updatedAt, k: 2, o, sign: 1 });
  }
  for (const w of more.withdrawals || []) if (goodsOut(w)) events.push({ t: w.createdAt, k: 3, w });
  for (const c of more.stockCounts || []) if (isActive(c)) events.push({ t: c.createdAt, k: 4, c });
  events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.k - b.k));
  const st = {};
  const get = (id) => (st[id] ||= { onHand: 0, avg: 0 });
  const comeIn = (p, qty, costPerBase) => {
    const base = Math.max(0, p.onHand);
    if (base + qty > 0) p.avg = Math.round((base * p.avg + qty * costPerBase) / (base + qty));
    p.onHand += qty;
  };
  for (const e of events) {
    if (e.k === 0) {
      const p = get(e.s.productId);
      const base = Math.max(0, p.onHand);
      p.avg = Math.round((base * p.avg + e.s.totalCost * 1000) / (base + e.s.qtyBase));
      p.onHand += e.s.qtyBase;
    } else if (e.k === 3) {
      get(e.w.productId).onHand -= e.w.qtyBase;
    } else if (e.k === 4) {
      get(e.c.productId).onHand += e.c.difference;
    } else {
      for (const it of e.o.items) {
        const p = get(it.productId);
        const qty = e.sign * it.qtyBase; // + means goods come in
        if (qty > 0) comeIn(p, qty, it.costPerBaseAtSale);
        else p.onHand += qty;
      }
    }
  }
  return st;
}

// Value of the stock on hand (stock below zero counts as zero).
export function stockValue(products, stockIns, orders, more = {}) {
  const inv = inventory(products, stockIns, orders, more);
  const avgs = averageCosts(stockIns, orders, more);
  let total = 0;
  const byProduct = {};
  for (const p of products) {
    const v = lineCost(Math.max(0, inv[p.id] || 0), avgs[p.id] ? avgs[p.id].avg : 0);
    byProduct[p.id] = v;
    total += v;
  }
  return { total, byProduct };
}

// Stock count accuracy in tenths of a percent: |difference| ÷ expected. 25 = 2.5%.
export function stockAccuracy(count) {
  if (!count.systemBase || count.systemBase <= 0) return null;
  return Math.round((Math.abs(count.difference) * 1000) / count.systemBase);
}

// Loss from a stock count in centavos: shortfall × average cost at the count.
// A surplus gives a negative loss (it reduces losses).
export function countLoss(count) {
  return lineCost(-count.difference, count.costPerBaseAtCount || 0);
}

// ---------- dates and periods ----------

const pad2 = (n) => String(n).padStart(2, '0');
const toUTC = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };

export const addDays = (ymd, n) => fromUTC(toUTC(ymd) + n * 86400000);
export const dayOfWeek = (ymd) => new Date(toUTC(ymd)).getUTCDay(); // 0 = Sunday
export const weekStart = (ymd) => addDays(ymd, -((dayOfWeek(ymd) + 6) % 7)); // Monday
export const monthStart = (ymd) => ymd.slice(0, 8) + '01';
export const monthEnd = (ymd) => addDays(fromUTC(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 1)), -1);
const inRange = (ymd, from, to) => ymd >= from && ymd <= to;

// "10 Nov – 16 Nov 2026"
export function formatRange(from, to) {
  if (from === to) return formatDate(from);
  const a = formatDate(from).split(' ');
  return (from.slice(0, 4) === to.slice(0, 4) ? `${a[0]} ${a[1]}` : formatDate(from)) + ' – ' + formatDate(to);
}

// Tenths of a percent -> "12.3%"
export function formatPct(tenths) {
  if (tenths == null) return '—';
  const neg = tenths < 0;
  const a = Math.abs(tenths);
  return (neg ? '-' : '') + Math.floor(a / 10) + '.' + (a % 10) + '%';
}

// ---------- home expense type ----------
// Goods from stock are grouped as "From stock"; cash entries keep their type
// (entries made before types existed count as "Other").
export function homeCategory(w) {
  if (w.type === 'goods') return 'From stock';
  return w.category || 'Other';
}

// ---------- income for a period ----------
// d = { orders, expenses, withdrawals, stockCounts } (missing lists count as empty)

export function periodSummary(d, from, to) {
  const orders = (d.orders || []).filter((o) => isActive(o) && inRange(o.dateOrdered, from, to));
  const sales = orders.reduce((s, o) => s + o.total, 0);
  const cogs = orders.reduce((s, o) => s + o.items.reduce((t, it) => t + lineCost(it.qtyBase, it.costPerBaseAtSale), 0), 0);
  const counts = (d.stockCounts || []).filter((c) => isActive(c) && inRange(c.date, from, to));
  const losses = counts.reduce((s, c) => s + countLoss(c), 0);
  const exps = (d.expenses || []).filter((e) => isActive(e) && inRange(e.date, from, to));
  const expenses = exps.reduce((s, e) => s + e.amount, 0);
  const income = sales - cogs - losses - expenses;
  const marginTenths = sales > 0 ? Math.round((income * 1000) / sales) : null;

  let collected = 0;
  for (const o of d.orders || []) for (const p of o.payments || []) if (inRange(p.date, from, to)) collected += p.amount;

  const wds = (d.withdrawals || []).filter((w) => isActive(w) && inRange(w.date, from, to));
  const takenCash = wds.filter((w) => w.type === 'cash').reduce((s, w) => s + w.amount, 0);
  const takenGoods = wds.filter((w) => w.type === 'goods').reduce((s, w) => s + w.amount, 0);
  // Home expenses (records kept as "withdrawals"): money or goods used for the family.
  // They are not business costs, so they do not change Income or Margin; they are shown
  // after Income as "Left after home expenses".
  const homeExpenses = takenCash + takenGoods;
  const leftAfterHome = income - homeExpenses;
  const homeByCat = {};
  for (const w of wds) {
    const k = homeCategory(w);
    homeByCat[k] = (homeByCat[k] || 0) + w.amount;
  }

  const expenseByCat = {};
  for (const e of exps) expenseByCat[e.category] = (expenseByCat[e.category] || 0) + e.amount;

  const cust = {}, prod = {};
  for (const o of orders) {
    const c = (cust[o.customerId] ||= { customerId: o.customerId, sales: 0, orders: 0 });
    c.sales += o.total; c.orders += 1;
    for (const it of o.items) {
      const p = (prod[it.productId] ||= { productId: it.productId, qtyBase: 0, sales: 0 });
      p.qtyBase += it.qtyBase; p.sales += it.lineTotal;
    }
  }
  const top = (obj) => Object.values(obj).sort((a, b) => b.sales - a.sales);
  return {
    from, to, sales, cogs, losses, expenses, income, marginTenths, collected,
    takenCash, takenGoods, homeExpenses, leftAfterHome, homeByCat, expenseByCat, orderCount: orders.length,
    topCustomers: top(cust).slice(0, 3), topProducts: top(prod),
  };
}

// ---------- unpaid (utang) by age ----------

export function unpaidByAge(orders, asOf) {
  const r = { total: 0, count: 0, oldestDays: 0, b0: 0, b31: 0, b61: 0, n0: 0, n31: 0, n61: 0 };
  for (const o of orders) {
    const bal = balanceOf(o);
    if (bal <= 0) continue;
    const age = Math.max(0, daysBetween(o.dateOrdered, asOf));
    r.total += bal; r.count += 1;
    if (age > r.oldestDays) r.oldestDays = age;
    if (age <= 30) { r.b0 += bal; r.n0 += 1; } else if (age <= 60) { r.b31 += bal; r.n31 += 1; } else { r.b61 += bal; r.n61 += 1; }
  }
  // Counted for the capital check: 100% up to 30 days, 50% from 31 to 60, 0% after 60.
  r.collectible = r.b0 + Math.round(r.b31 / 2);
  return r;
}

// ---------- cash ----------
// d = { capital, orders, stockIns, expenses, withdrawals }

// What the cash should be on a date: capital released + all payments received
// − all stock bought − all business expenses − home expenses paid in cash.
export function computedCash(d, upTo) {
  const upto = (r) => isActive(r) && r.date <= upTo;
  let cash = 0;
  for (const c of d.capital || []) if (upto(c)) cash += c.amount;
  for (const o of d.orders || []) for (const p of o.payments || []) if (p.date <= upTo) cash += p.amount;
  for (const s of d.stockIns || []) if (upto(s)) cash -= s.totalCost;
  for (const e of d.expenses || []) if (upto(e)) cash -= e.amount;
  for (const w of d.withdrawals || []) if (upto(w) && w.type === 'cash') cash -= w.amount;
  return cash;
}

// Latest cash count on or before a date (active only).
export function latestCashCount(cashCounts, asOf) {
  return (cashCounts || []).filter((c) => isActive(c) && c.date <= asOf)
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt)).pop() || null;
}

// Cash for the capital check: the latest count, plus the money in and out recorded since
// that count. With no count yet, the computed cash ("not counted yet").
export function cashPosition(d, asOf) {
  const now = computedCash(d, asOf);
  const last = latestCashCount(d.cashCounts, asOf);
  if (!last) return { cash: now, counted: false, count: null, computedNow: now };
  return { cash: last.countedCash + (now - last.computedCash), counted: true, count: last, computedNow: now };
}

// ---------- capital check ----------
// cash + stock value + collectible unpaid ≥ capital released -> OK.

export function capitalCheck(d, asOf) {
  const capital = (d.capital || []).filter((c) => isActive(c) && c.date <= asOf).reduce((s, c) => s + c.amount, 0);
  const pos = cashPosition(d, asOf);
  const stock = stockValue(d.products || [], d.stockIns || [], d.orders || [], d).total;
  const unpaid = unpaidByAge(d.orders || [], asOf);
  const total = pos.cash + stock + unpaid.collectible;
  return { capital, cash: pos.cash, cashCounted: pos.counted, cashCount: pos.count, stock, collectible: unpaid.collectible, total, gap: total - capital, ok: total >= capital };
}

// ---------- customers ----------

export function customerSummary(customerId, orders) {
  let bought = 0, unpaid = 0, lastDate = '', count = 0;
  for (const o of orders) {
    if (o.customerId !== customerId || o.status === 'cancelled') continue;
    bought += o.total;
    unpaid += balanceOf(o);
    count += 1;
    if (o.dateOrdered > lastDate) lastDate = o.dateOrdered;
  }
  return { bought, unpaid, lastDate, count };
}
