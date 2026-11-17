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

// Remaining stock per product, in base units.
export function inventory(products, stockIns, orders) {
  const inv = {};
  for (const p of products) inv[p.id] = 0;
  for (const s of stockIns) if (isActive(s)) inv[s.productId] = (inv[s.productId] || 0) + s.qtyBase;
  for (const o of orders) {
    if (!isActive(o)) continue;
    for (const it of o.items) inv[it.productId] = (inv[it.productId] || 0) - it.qtyBase;
  }
  return inv;
}

// Moving-average cost per kg or L (centavos), replaying stock movements in the order
// they were entered. Returns { [productId]: { onHand, avg } }.
//  - stock in: avg = (onHand × avg + cost) ÷ (onHand + qty)   (onHand below 0 counts as 0)
//  - sale: stock goes down, avg unchanged
//  - cancelled order: goods come back at the cost saved on the order line
//  - cancelled stock-in: left out completely
export function averageCosts(stockIns, orders) {
  const events = [];
  for (const s of stockIns) if (isActive(s)) events.push({ t: s.createdAt, k: 0, s });
  for (const o of orders) {
    events.push({ t: o.createdAt, k: 1, o, sign: -1 });
    if (o.status === 'cancelled') events.push({ t: o.cancelledAt || o.updatedAt, k: 2, o, sign: 1 });
  }
  events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.k - b.k));
  const st = {};
  const get = (id) => (st[id] ||= { onHand: 0, avg: 0 });
  for (const e of events) {
    if (e.k === 0) {
      const p = get(e.s.productId);
      const base = Math.max(0, p.onHand);
      p.avg = Math.round((base * p.avg + e.s.totalCost * 1000) / (base + e.s.qtyBase));
      p.onHand += e.s.qtyBase;
    } else {
      for (const it of e.o.items) {
        const p = get(it.productId);
        if (e.sign > 0) {
          const base = Math.max(0, p.onHand);
          p.avg = base + it.qtyBase > 0
            ? Math.round((base * p.avg + it.qtyBase * it.costPerBaseAtSale) / (base + it.qtyBase))
            : p.avg;
        }
        p.onHand += e.sign * it.qtyBase;
      }
    }
  }
  return st;
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
