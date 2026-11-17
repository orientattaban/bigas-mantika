// app.js: the screens of Bigas at Mantika (Phase 1: records).
import * as C from './calc.js';
import * as DB from './db.js';
import { esc, img, toast, ask, openSheet, closeSheet, topSheet, setAfterClose } from './ui.js';

export const APP_VERSION = '0.1.0';

const S = {
  products: [], stockIns: [], customers: [], orders: [], settings: {},
  tab: 'orders', customerSearch: '',
};

const CUSTOMER_TYPES = [
  { v: 'Household', label: 'Household' },
  { v: 'Sari-sari', label: 'Sari-sari store' },
  { v: 'Carinderia', label: 'Carinderia' },
  { v: 'Other', label: 'Other' },
];
const CANCEL_REASONS = ['Customer changed mind', 'Wrong entry', 'Goods returned', 'Other'];

const byId = (list, id) => list.find((x) => x.id === id);
const productOf = (id) => byId(S.products, id);
const customerOf = (id) => byId(S.customers, id);
const today = () => C.todayManila();
const peso = C.formatPeso;
const fmtDate = C.formatDate;
const main = () => document.getElementById('main');
const clone = (o) => structuredClone(o);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

// centavos -> text for an input box ("38.50")
const pesoInput = (c) => (c == null ? '' : Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0'));
// base units -> text for an input box ("2.25")
const baseInput = (b) => (b == null ? '' : C.formatQty(b));

function itemText(it) {
  const p = productOf(it.productId);
  return `${p ? p.name : 'Product'}: ${C.formatQty(Math.round(it.qty * 1000))} × ${it.packagingLabel}`;
}

// ===================================================================
// Saving
// ===================================================================

async function save(puts, log, counters = []) {
  try {
    await DB.commit({ puts, log, counters }, S.settings);
  } catch (err) {
    console.warn('Save failed', err);
    toast(DB.isStorageFull(err)
      ? 'Phone storage is full. Free up some space (photos, videos), then try again.'
      : 'Could not save. Please try again.', true);
    return false;
  }
  for (const p of puts) {
    const list = S[p.store];
    const i = list.findIndex((x) => x.id === p.value.id);
    if (i >= 0) list[i] = p.value; else list.push(p.value);
  }
  renderMain();
  return true;
}

// ===================================================================
// Start-up
// ===================================================================

async function init() {
  try {
    await DB.openDb();
    Object.assign(S, await DB.loadAll());
    if (!S.settings.installId) await firstRun();
  } catch (err) {
    console.warn(err);
    main().innerHTML = `<div class="card"><h2>The app could not open its records</h2>
      <p class="muted" style="margin-top:8px">Close Chrome completely, then open the app again. If this keeps happening, tell Coach.</p></div>`;
    return;
  }
  wireGlobal();
  renderMain();
  updateOnline();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

async function firstRun() {
  const stamp = DB.nowStamp();
  const products = DB.defaultProducts(stamp);
  const installId = DB.newId('i');
  const settings = { installId, firstRunAt: stamp, schemaVersion: DB.SCHEMA_VERSION, counters: {} };
  await DB.commit({
    puts: [
      ...products.map((v) => ({ store: 'products', value: v })),
      ...Object.entries(settings).map(([key, value]) => ({ store: 'settings', value: { key, value } })),
    ],
    log: { action: 'create', entity: 'setup', id: installId, summary: { text: 'App set up with the default products' } },
  }, S.settings);
  S.products = products;
  Object.assign(S.settings, settings);
  let persisted = 'not supported';
  try { if (navigator.storage && navigator.storage.persist) persisted = (await navigator.storage.persist()) ? 'yes' : 'no'; } catch { /* ignore */ }
  await DB.putSetting('storagePersisted', persisted);
  S.settings.storagePersisted = persisted;
}

function updateOnline() {
  document.getElementById('offline').hidden = navigator.onLine;
}

function wireGlobal() {
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  setAfterClose(() => {
    renderMain();
    const top = topSheet();
    if (top) top.refresh();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    const actions = {
      'tab': () => setTab(el.dataset.tab),
      'new-order': () => openOrderForm({ customerId: el.dataset.customer }),
      'open-order': () => openOrderDetail(id),
      'deliver': () => setDelivered(id, true),
      'pay': () => openPaymentForm(id),
      'new-customer': () => openCustomerForm(),
      'open-customer': () => openCustomerDetail(id),
      'add-stock': () => openStockInForm(),
      'open-stockin': () => openStockInDetail(id),
      'edit-product': () => openProductForm(id),
      'new-product': () => openProductForm(null),
    };
    if (actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](); }
  });
}

function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderMain();
  window.scrollTo(0, 0);
}

function renderMain() {
  const views = { orders: renderOrders, customers: renderCustomers, stock: renderStock, income: renderIncome, quest: renderQuest };
  (views[S.tab] || renderOrders)();
}

const footer = () => `<p class="version">Bigas at Mantika · version ${APP_VERSION}</p>`;

// ===================================================================
// ORDERS tab
// ===================================================================

function statusBadges(o) {
  if (o.status === 'cancelled') return `<span class="badge b-grey">Cancelled</span>`;
  const out = [];
  out.push(o.delivery.status === 'delivered'
    ? `<span class="badge b-green">Delivered ${fmtDate(o.delivery.dateDelivered)}</span>`
    : `<span class="badge b-orange">Not delivered</span>`);
  const st = C.paymentStatus(o);
  if (st === 'paid') out.push(`<span class="badge b-green">Paid</span>`);
  else if (st === 'partial') out.push(`<span class="badge b-orange">Balance ${peso(C.balanceOf(o))}</span>`);
  else out.push(`<span class="badge b-red">Not paid</span>`);
  if (o.stockShort) out.push(`<span class="badge b-orange">Stock was short</span>`);
  return out.join('');
}

function orderCard(o, { actions = true } = {}) {
  const c = customerOf(o.customerId);
  const cancelled = o.status === 'cancelled';
  const btns = [];
  if (actions && !cancelled) {
    if (o.delivery.status === 'pending') btns.push(`<button type="button" class="btn btn-small" data-act="deliver" data-id="${o.id}">✓ Mark delivered</button>`);
    if (C.balanceOf(o) > 0) btns.push(`<button type="button" class="btn btn-small btn-gold" data-act="pay" data-id="${o.id}">₱ Receive payment</button>`);
  }
  return `
    <article class="card tap ${cancelled ? 'cancelled' : ''}" data-act="open-order" data-id="${o.id}">
      <div class="row"><h3>${esc(c ? c.name : 'Unknown customer')}</h3>
        <span class="amount ${cancelled ? 'strike' : ''}">${peso(o.total)}</span></div>
      <ul class="items">${o.items.map((it) => `<li>${esc(itemText(it))}</li>`).join('')}</ul>
      <p class="muted">Ordered ${fmtDate(o.dateOrdered)}</p>
      <div class="badges">${statusBadges(o)}</div>
      ${btns.length ? `<div class="card-actions">${btns.join('')}</div>` : ''}
    </article>`;
}

const asc = (a, b) => (a.dateOrdered + a.createdAt).localeCompare(b.dateOrdered + b.createdAt);
const desc = (a, b) => asc(b, a);

function renderOrders() {
  const active = S.orders.filter((o) => o.status !== 'cancelled');
  const pending = active.filter((o) => o.delivery.status === 'pending').sort(asc);
  const unpaid = active.filter((o) => o.delivery.status === 'delivered' && C.balanceOf(o) > 0).sort(asc);
  const shown = new Set([...pending, ...unpaid].map((o) => o.id));
  const recent = S.orders.filter((o) => !shown.has(o.id)).sort(desc).slice(0, 20);

  const section = (title, list, emptyText) => `
    <section class="section">
      <div class="section-head"><h2>${title}</h2><span class="count">${list.length}</span></div>
      ${list.length ? list.map((o) => orderCard(o)).join('') : `<p class="muted">${emptyText}</p>`}
    </section>`;

  main().innerHTML = `
    <button type="button" class="btn btn-primary btn-big" data-act="new-order">+ New Order</button>
    ${S.orders.length === 0 ? `
      <div class="empty section">
        ${img('empty-orders.jpg', 'No orders yet')}
        <p>No orders yet. Tap <strong>+ New Order</strong> to record a sale.</p>
      </div>` : `
      ${section('Not delivered yet', pending, 'All orders are delivered.')}
      ${section('Not paid yet', unpaid, 'No unpaid delivered orders.')}
      ${section('Recent orders', recent, 'No other orders yet.')}`}
    ${footer()}`;
}

// ---------- New order ----------

function openOrderForm({ customerId } = {}) {
  const d = {
    customerId: customerId || null, dateOrdered: today(), items: [],
    payMode: null, paidText: '', ref: '', delivered: false, note: '', error: '',
  };
  openSheet({ title: 'New Order', render: (sh) => renderOrderForm(sh, d) });
}

function stockLeft(productId, draftItems, skipIndex = -1) {
  const inv = C.inventory(S.products, S.stockIns, S.orders)[productId] || 0;
  return inv - sum(draftItems.filter((l, i) => l.productId === productId && i !== skipIndex), (l) => l.qtyBase);
}

function renderOrderForm(sh, d) {
  const c = customerOf(d.customerId);
  const total = sum(d.items, (l) => l.lineTotal);
  const chip = (group, v, label, sel) => `<button type="button" class="chip" data-${group}="${v}" aria-pressed="${sel}">${label}</button>`;

  const shortWarnings = [...new Set(d.items.map((l) => l.productId))]
    .filter((pid) => stockLeft(pid, d.items) < 0)
    .map((pid) => {
      const p = productOf(pid);
      const have = C.inventory(S.products, S.stockIns, S.orders)[pid] || 0;
      return `<p class="warn">Not enough ${esc(p.name)} in stock: only ${C.formatBase(have, p.baseUnit)} left. You can still save; stock will show below zero.</p>`;
    }).join('');

  sh.set(`
    <div class="field"><span class="label">Customer</span>
      ${c ? `<div class="card row"><div><strong>${esc(c.name)}</strong>${c.area ? `<p class="muted">${esc(c.area)}</p>` : ''}</div>
              <button type="button" class="btn btn-small" id="pick-cust">Change</button></div>`
          : `<button type="button" class="btn btn-big" id="pick-cust">Choose customer</button>`}
    </div>

    <label class="field"><span class="label">Date ordered</span>
      <input class="input" type="date" id="o-date" value="${d.dateOrdered}" max="${today()}"></label>

    <div class="field"><span class="label">Items</span>
      ${d.items.map((l, i) => `
        <div class="card">
          <div class="row"><strong>${esc(itemText(l))}</strong><span class="amount">${peso(l.lineTotal)}</span></div>
          <p class="muted">${C.formatQty(l.qtyMilli)} × ${peso(l.pricePerUnit)} = ${C.formatBase(l.qtyBase, productOf(l.productId).baseUnit)}</p>
          <div class="card-actions"><button type="button" class="btn btn-small btn-danger" data-remove="${i}">Remove</button></div>
        </div>`).join('')}
      <button type="button" class="btn btn-big" id="add-item" style="margin-top:10px">+ Add item</button>
      ${shortWarnings}
    </div>

    <div class="total-line"><span>Total</span><span>${peso(total)}</span></div>

    <div class="field"><span class="label">Payment</span>
      <div class="chips stack">
        ${chip('pay', 'full', 'Paid in full', d.payMode === 'full')}
        ${chip('pay', 'part', 'Partly paid', d.payMode === 'part')}
        ${chip('pay', 'none', 'Not paid', d.payMode === 'none')}
      </div>
    </div>
    ${d.payMode === 'part' ? `
      <label class="field"><span class="label">Amount paid now (₱)</span>
        <input class="input big" id="o-paid" inputmode="decimal" autocomplete="off" value="${esc(d.paidText)}" placeholder="0.00"></label>` : ''}
    ${d.payMode === 'full' || d.payMode === 'part' ? `
      <label class="field"><span class="label">GCash reference (optional)</span>
        <input class="input" id="o-ref" autocomplete="off" value="${esc(d.ref)}"></label>` : ''}

    <div class="field"><span class="label">Delivery</span>
      <div class="chips">
        ${chip('deliv', 'no', 'Not yet delivered', !d.delivered)}
        ${chip('deliv', 'yes', 'Delivered now', d.delivered)}
      </div>
    </div>

    <label class="field"><span class="label">Note (optional)</span>
      <input class="input" id="o-note" autocomplete="off" value="${esc(d.note)}"></label>
    ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="save-order">Save Order · ${peso(total)}</button>`);

  sh.q('#pick-cust').onclick = () => openCustomerPicker((id) => { d.customerId = id; });
  sh.q('#o-date').onchange = (e) => { d.dateOrdered = e.target.value || today(); };
  sh.q('#add-item').onclick = () => openItemForm(d);
  sh.qa('[data-remove]').forEach((b) => { b.onclick = () => { d.items.splice(Number(b.dataset.remove), 1); sh.refresh(); }; });
  sh.qa('[data-pay]').forEach((b) => { b.onclick = () => { d.payMode = b.dataset.pay; d.error = ''; sh.refresh(); }; });
  sh.qa('[data-deliv]').forEach((b) => { b.onclick = () => { d.delivered = b.dataset.deliv === 'yes'; sh.refresh(); }; });
  const paid = sh.q('#o-paid'); if (paid) paid.oninput = (e) => { d.paidText = e.target.value; };
  const ref = sh.q('#o-ref'); if (ref) ref.oninput = (e) => { d.ref = e.target.value; };
  sh.q('#o-note').oninput = (e) => { d.note = e.target.value; };
  sh.q('#save-order').onclick = () => saveOrder(sh, d);
}

async function saveOrder(sh, d) {
  const total = sum(d.items, (l) => l.lineTotal);
  let paidNow = 0;
  if (!d.customerId) d.error = 'Choose a customer first.';
  else if (!d.items.length) d.error = 'Add at least one item.';
  else if (!d.payMode) d.error = 'Choose a payment option.';
  else if (d.payMode === 'part') {
    paidNow = C.parsePeso(d.paidText);
    if (!paidNow) d.error = 'Type the amount paid now.';
    else if (paidNow >= total) d.error = `The amount is the full total or more. Choose "Paid in full" instead.`;
    else d.error = '';
  } else d.error = '';
  if (d.error) { sh.refresh(); return; }
  if (d.payMode === 'full') paidNow = total;

  const stamp = DB.nowStamp();
  const avgs = C.averageCosts(S.stockIns, S.orders);
  const stockShort = d.items.some((l) => stockLeft(l.productId, d.items) < 0);
  const order = {
    id: DB.newId('o'),
    customerId: d.customerId,
    dateOrdered: d.dateOrdered,
    status: 'active', cancelReason: null,
    items: d.items.map((l) => ({
      productId: l.productId, packagingLabel: l.packagingLabel,
      qty: l.qtyMilli / 1000, qtyBase: l.qtyBase,
      pricePerUnit: l.pricePerUnit, lineTotal: l.lineTotal,
      costPerBaseAtSale: avgs[l.productId] ? avgs[l.productId].avg : 0,
    })),
    total,
    delivery: d.delivered ? { status: 'delivered', dateDelivered: d.dateOrdered } : { status: 'pending', dateDelivered: null },
    payments: paidNow > 0 ? [{ id: DB.newId('pay'), date: d.dateOrdered, amount: paidNow, ref: d.ref.trim(), kind: 'payment', createdAt: stamp }] : [],
    note: d.note.trim(),
    stockShort,
    createdAt: stamp, updatedAt: stamp,
  };
  const c = customerOf(d.customerId);
  const ok = await save([{ store: 'orders', value: order }],
    { action: 'create', entity: 'order', id: order.id, summary: { text: `${c.name}, ${peso(total)}`, after: order } },
    ['ordersCreated']);
  if (!ok) return;
  await closeSheet();
  toast('Order saved');
}

// ---------- Add one item to an order ----------

function openItemForm(d) {
  const active = S.products.filter((p) => p.active !== false);
  const it = { productId: active.length === 1 ? active[0].id : null, packagingLabel: null, qtyText: '1', priceText: '', error: '' };
  openSheet({ title: 'Add item', render: (sh) => renderItemForm(sh, d, it) });
}

function itemCalc(it) {
  const p = productOf(it.productId);
  const pk = p && p.packagings.find((x) => x.label === it.packagingLabel);
  const qtyMilli = C.parseQtyMilli(it.qtyText);
  const price = C.parsePeso(it.priceText);
  if (!p || !pk || !qtyMilli || price == null) return null;
  return { p, pk, qtyMilli, price, qtyBase: C.qtyBaseOf(qtyMilli, pk.sizeInBase), lineTotal: C.lineTotalOf(qtyMilli, price) };
}

function renderItemForm(sh, d, it) {
  const active = S.products.filter((p) => p.active !== false);
  const p = productOf(it.productId);
  const pk = p && p.packagings.find((x) => x.label === it.packagingLabel);

  sh.set(`
    <div class="field"><span class="label">Product</span>
      <div class="chips">${active.map((x) => `<button type="button" class="chip" data-prod="${x.id}" aria-pressed="${x.id === it.productId}">${esc(x.name)}</button>`).join('')}</div>
    </div>
    ${p ? `
      <div class="field"><span class="label">Packaging</span>
        <div class="chips stack">${p.packagings.map((x) => `
          <button type="button" class="chip" data-pack="${esc(x.label)}" aria-pressed="${x.label === it.packagingLabel}">
            ${esc(x.label)} <span class="muted">· ${C.formatBase(x.sizeInBase, p.baseUnit)}</span></button>`).join('')}</div>
        ${pk && pk.note ? `<p class="warn">${esc(pk.note)}</p>` : ''}
      </div>` : ''}
    ${pk ? `
      <div class="field"><span class="label">How many?</span>
        <div class="stepper">
          <button type="button" class="btn" id="minus" aria-label="One less">−</button>
          <input class="input big" id="i-qty" inputmode="decimal" autocomplete="off" value="${esc(it.qtyText)}">
          <button type="button" class="btn" id="plus" aria-label="One more">+</button>
        </div>
      </div>
      <label class="field"><span class="label">Price for one ${esc(pk.label)} (₱)</span>
        <input class="input big" id="i-price" inputmode="decimal" autocomplete="off" value="${esc(it.priceText)}">
        <span class="hint">Suggested: ${peso(C.prefillUnitPrice(p.sellPricePerBase, pk.sizeInBase))} (${peso(p.sellPricePerBase)} per ${p.baseUnit}). Change it for a suki discount.</span>
      </label>
      <div id="i-live"></div>` : ''}
    ${it.error ? `<p class="error">${esc(it.error)}</p>` : ''}
  `, pk ? `<button type="button" class="btn btn-primary btn-big" id="add">Add to order</button>` : '');

  sh.qa('[data-prod]').forEach((b) => { b.onclick = () => { it.productId = b.dataset.prod; it.packagingLabel = null; it.priceText = ''; sh.refresh(); }; });
  sh.qa('[data-pack]').forEach((b) => {
    b.onclick = () => {
      it.packagingLabel = b.dataset.pack;
      const x = p.packagings.find((y) => y.label === it.packagingLabel);
      it.priceText = pesoInput(C.prefillUnitPrice(p.sellPricePerBase, x.sizeInBase));
      sh.refresh();
    };
  });
  if (!pk) return;

  const live = () => {
    const r = itemCalc(it);
    const box = sh.q('#i-live');
    if (!r) { box.innerHTML = ''; return; }
    const left = stockLeft(r.p.id, d.items) - r.qtyBase;
    box.innerHTML = `
      <div class="total-line"><span>Line total</span><span>${peso(r.lineTotal)}</span></div>
      <p class="muted">= ${C.formatBase(r.qtyBase, r.p.baseUnit)}. In stock now: ${C.formatBase(stockLeft(r.p.id, d.items), r.p.baseUnit)}</p>
      ${left < 0 ? `<p class="warn">Not enough stock for this. You can still add it; stock will show below zero.</p>` : ''}`;
  };
  const qty = sh.q('#i-qty');
  qty.oninput = () => { it.qtyText = qty.value; live(); };
  sh.q('#i-price').oninput = (e) => { it.priceText = e.target.value; live(); };
  const step = (delta) => {
    const m = C.parseQtyMilli(it.qtyText) || 0;
    const next = Math.max(1000, (Math.floor(m / 1000) + delta) * 1000);
    it.qtyText = C.formatQty(next); qty.value = it.qtyText; live();
  };
  sh.q('#minus').onclick = () => step(-1);
  sh.q('#plus').onclick = () => step(1);
  live();

  sh.q('#add').onclick = async () => {
    const r = itemCalc(it);
    if (!r || r.qtyMilli <= 0) { it.error = 'Check the number and the price.'; sh.refresh(); return; }
    d.items.push({ productId: r.p.id, packagingLabel: r.pk.label, qtyMilli: r.qtyMilli, qty: r.qtyMilli / 1000, qtyBase: r.qtyBase, pricePerUnit: r.price, lineTotal: r.lineTotal });
    await closeSheet();
  };
}

// ---------- Order details ----------

function openOrderDetail(id) {
  openSheet({ title: 'Order', render: (sh) => renderOrderDetail(sh, id) });
}

function renderOrderDetail(sh, id) {
  const o = byId(S.orders, id);
  if (!o) { sh.set('<p>Order not found.</p>'); return; }
  const c = customerOf(o.customerId);
  const cancelled = o.status === 'cancelled';
  const reversed = new Set(o.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const paid = C.paidAmount(o);
  const bal = C.balanceOf(o);

  const payRow = (p) => {
    const label = p.kind === 'refund' ? 'Refund to customer' : p.kind === 'reversal' ? 'Payment undone' : 'Payment';
    const canUndo = !cancelled && p.kind === 'payment' && !reversed.has(p.id);
    return `<div class="card">
      <div class="row"><span>${label} · ${fmtDate(p.date)}</span><span class="amount ${p.amount < 0 ? 'red' : ''}">${peso(p.amount)}</span></div>
      ${p.ref ? `<p class="muted">Ref: ${esc(p.ref)}</p>` : ''}
      ${p.reason ? `<p class="muted">Reason: ${esc(p.reason)}</p>` : ''}
      ${reversed.has(p.id) ? `<p class="muted">This payment was undone.</p>` : ''}
      ${canUndo ? `<div class="card-actions"><button type="button" class="btn btn-small btn-danger" data-undo="${p.id}">Undo this payment</button></div>` : ''}
    </div>`;
  };

  sh.set(`
    <div class="card tap" data-act="open-customer" data-id="${o.customerId}">
      <div class="row"><h2>${esc(c ? c.name : 'Unknown customer')}</h2><span class="muted">View ›</span></div>
      <p class="muted">Ordered ${fmtDate(o.dateOrdered)}</p>
      <div class="badges">${statusBadges(o)}</div>
    </div>
    ${cancelled ? `<p class="warn">Cancelled on ${fmtDate(o.cancelledDate)}. Reason: ${esc(o.cancelReason)}. The goods went back to stock.</p>` : ''}
    ${o.stockShort && !cancelled ? `<p class="warn">When this order was saved, there was not enough stock recorded. Add the missing stock in the Stock tab.</p>` : ''}

    <section class="section"><h3>Items</h3>
      ${o.items.map((it) => {
        const p = productOf(it.productId);
        return `<div class="card"><div class="row"><strong>${esc(itemText(it))}</strong><span class="amount">${peso(it.lineTotal)}</span></div>
          <p class="muted">${C.formatQty(Math.round(it.qty * 1000))} × ${peso(it.pricePerUnit)} · ${C.formatBase(it.qtyBase, p ? p.baseUnit : '')}</p></div>`;
      }).join('')}
      <div class="total-line"><span>Total</span><span class="${cancelled ? 'strike' : ''}">${peso(o.total)}</span></div>
    </section>

    <section class="section"><h3>Delivery</h3>
      <div class="card">
        ${o.delivery.status === 'delivered'
          ? `<p><strong class="green">Delivered</strong> on ${fmtDate(o.delivery.dateDelivered)}</p>
             ${cancelled ? '' : `<div class="card-actions"><button type="button" class="btn btn-small" id="undeliver">Mark as not delivered</button></div>`}`
          : `<p><strong class="orange">Not delivered yet</strong></p>
             ${cancelled ? '' : `<div class="card-actions"><button type="button" class="btn btn-small btn-primary" id="deliver">✓ Mark delivered today</button></div>`}`}
      </div>
    </section>

    <section class="section"><h3>Payments</h3>
      ${o.payments.length ? o.payments.map(payRow).join('') : `<p class="muted">No payment yet.</p>`}
      <div class="card" style="margin-top:10px">
        <div class="row"><span>Paid</span><span class="amount">${peso(paid)}</span></div>
        ${cancelled ? '' : `<div class="row"><span>Balance</span><span class="amount ${bal > 0 ? 'red' : 'green'}">${peso(bal)}</span></div>`}
      </div>
      ${!cancelled && bal > 0 ? `<button type="button" class="btn btn-gold btn-big" style="margin-top:10px" data-act="pay" data-id="${o.id}">₱ Receive payment</button>` : ''}
    </section>

    ${o.note ? `<section class="section"><h3>Note</h3><p>${esc(o.note)}</p></section>` : ''}

    ${cancelled ? '' : `<section class="section">
      <button type="button" class="btn btn-danger btn-big" id="cancel-order">Cancel this order</button>
      <p class="muted small" style="margin-top:6px">To fix a wrong order: cancel it, then make a new one.</p></section>`}
  `);

  const dl = sh.q('#deliver'); if (dl) dl.onclick = () => setDelivered(o.id, true);
  const ud = sh.q('#undeliver'); if (ud) ud.onclick = () => setDelivered(o.id, false);
  const co = sh.q('#cancel-order'); if (co) co.onclick = () => openCancelForm(o.id);
  sh.qa('[data-undo]').forEach((b) => { b.onclick = () => undoPayment(o.id, b.dataset.undo); });
}

async function setDelivered(id, delivered) {
  const o = byId(S.orders, id);
  if (!o || o.status === 'cancelled') return;
  if (!delivered && !(await ask('Mark this order as NOT delivered?', { yes: 'Yes, not delivered' }))) return;
  const after = clone(o);
  after.delivery = delivered ? { status: 'delivered', dateDelivered: today() } : { status: 'pending', dateDelivered: null };
  after.updatedAt = DB.nowStamp();
  const ok = await save([{ store: 'orders', value: after }],
    { action: 'edit', entity: 'order', id, summary: { text: delivered ? 'Marked delivered' : 'Marked not delivered', before: o.delivery, after: after.delivery } },
    delivered ? [] : ['edits']);
  if (ok) { toast(delivered ? 'Marked as delivered' : 'Marked as not delivered'); const t = topSheet(); if (t) t.refresh(); }
}

// ---------- Receive payment ----------

function openPaymentForm(orderId) {
  const o = byId(S.orders, orderId);
  const f = { amountText: pesoInput(C.balanceOf(o)), date: today(), ref: '', error: '' };
  openSheet({ title: 'Receive Payment', render: (sh) => renderPaymentForm(sh, orderId, f) });
}

function renderPaymentForm(sh, orderId, f) {
  const o = byId(S.orders, orderId);
  const c = customerOf(o.customerId);
  const bal = C.balanceOf(o);
  sh.set(`
    <div class="card">
      <h3>${esc(c ? c.name : '')}</h3>
      <div class="row" style="margin-top:6px"><span>Order total</span><span class="amount">${peso(o.total)}</span></div>
      <div class="row"><span>Paid so far</span><span class="amount">${peso(C.paidAmount(o))}</span></div>
      <div class="row"><span><strong>Balance</strong></span><span class="amount red">${peso(bal)}</span></div>
    </div>
    <label class="field"><span class="label">Amount received (₱)</span>
      <input class="input big" id="p-amt" inputmode="decimal" autocomplete="off" value="${esc(f.amountText)}"></label>
    <label class="field"><span class="label">Date received</span>
      <input class="input" type="date" id="p-date" value="${f.date}" max="${today()}"></label>
    <label class="field"><span class="label">GCash reference (optional)</span>
      <input class="input" id="p-ref" autocomplete="off" value="${esc(f.ref)}"></label>
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="p-save">Save payment</button>`);

  sh.q('#p-amt').oninput = (e) => { f.amountText = e.target.value; };
  sh.q('#p-date').onchange = (e) => { f.date = e.target.value || today(); };
  sh.q('#p-ref').oninput = (e) => { f.ref = e.target.value; };
  sh.q('#p-save').onclick = async () => {
    const amt = C.parsePeso(f.amountText);
    if (!amt) { f.error = 'Type the amount received.'; sh.refresh(); return; }
    if (amt > bal) { f.error = `That is more than the balance of ${peso(bal)}.`; sh.refresh(); return; }
    const stamp = DB.nowStamp();
    const after = clone(o);
    const pay = { id: DB.newId('pay'), date: f.date, amount: amt, ref: f.ref.trim(), kind: 'payment', createdAt: stamp };
    after.payments.push(pay);
    after.updatedAt = stamp;
    const ok = await save([{ store: 'orders', value: after }],
      { action: 'create', entity: 'payment', id: pay.id, summary: { text: `${c ? c.name : ''}: payment ${peso(amt)}`, after: pay } });
    if (!ok) return;
    await closeSheet();
    toast(amt === bal ? 'Payment saved. Fully paid!' : 'Payment saved');
  };
}

async function undoPayment(orderId, payId) {
  const o = byId(S.orders, orderId);
  const p = o.payments.find((x) => x.id === payId);
  const reason = await ask(`Undo the payment of ${peso(p.amount)} on ${fmtDate(p.date)}?\nThe record stays, with an "undone" line.`,
    { yes: 'Undo payment', danger: true, input: { label: 'Why? (required)', required: true, requiredMsg: 'Please type the reason.' } });
  if (!reason) return;
  const stamp = DB.nowStamp();
  const after = clone(o);
  const rev = { id: DB.newId('pay'), date: today(), amount: -p.amount, kind: 'reversal', reversesId: p.id, reason, createdAt: stamp };
  after.payments.push(rev);
  after.updatedAt = stamp;
  const ok = await save([{ store: 'orders', value: after }],
    { action: 'edit', entity: 'payment', id: p.id, summary: { text: `Payment ${peso(p.amount)} undone: ${reason}`, before: p, after: rev } },
    ['edits']);
  if (ok) { toast('Payment undone'); const t = topSheet(); if (t) t.refresh(); }
}

// ---------- Cancel order ----------

function openCancelForm(orderId) {
  const f = { reason: null, detail: '', returned: false, error: '' };
  openSheet({ title: 'Cancel Order', render: (sh) => renderCancelForm(sh, orderId, f) });
}

function renderCancelForm(sh, orderId, f) {
  const o = byId(S.orders, orderId);
  const paid = C.paidAmount(o);
  sh.set(`
    <p class="info">The order stays in the records, marked <strong>Cancelled</strong>. Its goods go back to stock, and it no longer counts as a sale or as unpaid.</p>
    <div class="field"><span class="label">Why is it cancelled?</span>
      <div class="chips stack">${CANCEL_REASONS.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}" aria-pressed="${f.reason === r}">${esc(r)}</button>`).join('')}</div>
    </div>
    <label class="field"><span class="label">Details ${f.reason === 'Other' ? '(required)' : '(optional)'}</span>
      <input class="input" id="c-detail" autocomplete="off" value="${esc(f.detail)}"></label>
    ${paid > 0 ? `
      <p class="warn">The customer already paid ${peso(paid)} for this order.</p>
      <label class="check"><input type="checkbox" id="c-returned" ${f.returned ? 'checked' : ''}>
        <span>I returned ${peso(paid)} to the customer. (A refund will be recorded.)</span></label>` : ''}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-danger solid btn-big" id="c-save">Cancel this order</button>`);

  sh.qa('[data-reason]').forEach((b) => { b.onclick = () => { f.reason = b.dataset.reason; f.error = ''; sh.refresh(); }; });
  sh.q('#c-detail').oninput = (e) => { f.detail = e.target.value; };
  const ret = sh.q('#c-returned'); if (ret) ret.onchange = (e) => { f.returned = e.target.checked; };
  sh.q('#c-save').onclick = async () => {
    if (!f.reason) f.error = 'Choose a reason.';
    else if (f.reason === 'Other' && !f.detail.trim()) f.error = 'Type the reason in Details.';
    else if (paid > 0 && !f.returned) f.error = `Return the ${peso(paid)} to the customer first, then tick the box. If the customer is keeping the goods, do not cancel.`;
    else f.error = '';
    if (f.error) { sh.refresh(); return; }
    const reason = f.reason + (f.detail.trim() ? ': ' + f.detail.trim() : '');
    const stamp = DB.nowStamp();
    const after = clone(o);
    after.status = 'cancelled';
    after.cancelReason = reason;
    after.cancelledAt = stamp;
    after.cancelledDate = today();
    if (paid > 0) after.payments.push({ id: DB.newId('pay'), date: today(), amount: -paid, kind: 'refund', reason, createdAt: stamp });
    after.updatedAt = stamp;
    const c = customerOf(o.customerId);
    const ok = await save([{ store: 'orders', value: after }],
      { action: 'cancel', entity: 'order', id: o.id, summary: { text: `${c ? c.name : ''}, ${peso(o.total)} cancelled: ${reason}`, before: o, after } },
      ['cancels']);
    if (!ok) return;
    await closeSheet();
    toast('Order cancelled. Stock returned.');
  };
}

// ===================================================================
// CUSTOMERS tab
// ===================================================================

function customerCard(c, act = 'open-customer') {
  const s = C.customerSummary(c.id, S.orders);
  return `
    <article class="card tap" data-act="${act}" data-id="${c.id}">
      <div class="row"><h3>${esc(c.name)}</h3>${s.unpaid > 0 ? `<span class="amount red">${peso(s.unpaid)} unpaid</span>` : ''}</div>
      ${c.area || c.type ? `<p class="muted">${esc([c.area, typeLabel(c.type)].filter(Boolean).join(' · '))}</p>` : ''}
      <p class="muted">Bought ${peso(s.bought)}${s.lastDate ? ` · Last order ${fmtDate(s.lastDate)}` : ' · No orders yet'}</p>
    </article>`;
}
const typeLabel = (v) => (CUSTOMER_TYPES.find((t) => t.v === v) || {}).label || '';

function matchCustomer(c, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return c.name.toLowerCase().includes(s) || (c.area || '').toLowerCase().includes(s) ||
    (c.phoneNorm && C.normalizePhone(q).length >= 3 && c.phoneNorm.includes(C.normalizePhone(q)));
}

function sortedCustomers() {
  return [...S.customers].sort((a, b) => a.name.localeCompare(b.name));
}

function renderCustomers() {
  if (!S.customers.length) {
    main().innerHTML = `
      <button type="button" class="btn btn-primary btn-big" data-act="new-customer">+ New Customer</button>
      <div class="empty section">${img('empty-customers.jpg', 'No customers yet')}
        <p>No customers yet. Tap <strong>+ New Customer</strong> to add your first suki.</p></div>
      ${footer()}`;
    return;
  }
  main().innerHTML = `
    <button type="button" class="btn btn-primary btn-big" data-act="new-customer">+ New Customer</button>
    <label class="field"><span class="label">Search</span>
      <input class="input" id="cust-search" type="search" placeholder="Name, area or phone" autocomplete="off" value="${esc(S.customerSearch)}"></label>
    <section class="section" id="cust-list"></section>
    ${footer()}`;
  const input = document.getElementById('cust-search');
  input.oninput = () => { S.customerSearch = input.value; renderCustomerList(); };
  renderCustomerList();
}

function renderCustomerList() {
  const list = sortedCustomers().filter((c) => matchCustomer(c, S.customerSearch));
  document.getElementById('cust-list').innerHTML = `
    <div class="section-head"><h2>Customers</h2><span class="count">${list.length}</span></div>
    ${list.length ? list.map((c) => customerCard(c)).join('') : `<p class="muted">No customer matches "${esc(S.customerSearch)}".</p>`}`;
}

// ---------- Choose a customer (from the New Order screen) ----------

function openCustomerPicker(onPick) {
  const f = { q: '' };
  openSheet({
    title: 'Choose customer',
    render: (sh) => {
      sh.set(`
        <button type="button" class="btn btn-primary btn-big" id="pk-new">+ New Customer</button>
        ${S.customers.length ? `<label class="field"><span class="label">Search</span>
          <input class="input" id="pk-q" type="search" placeholder="Name, area or phone" autocomplete="off" value="${esc(f.q)}"></label>` : ''}
        <div class="section" id="pk-list"></div>`);
      const draw = () => {
        const list = sortedCustomers().filter((c) => matchCustomer(c, f.q));
        sh.q('#pk-list').innerHTML = list.length
          ? list.map((c) => `<button type="button" class="card tap" style="display:block;width:100%;text-align:left" data-pick="${c.id}">
              <strong>${esc(c.name)}</strong>${c.area ? `<p class="muted">${esc(c.area)}</p>` : ''}</button>`).join('')
          : `<p class="muted">${S.customers.length ? 'No match. Tap + New Customer.' : 'No customers yet. Tap + New Customer.'}</p>`;
        sh.qa('[data-pick]').forEach((b) => { b.onclick = async () => { onPick(b.dataset.pick); await closeSheet(); }; });
      };
      const qi = sh.q('#pk-q'); if (qi) qi.oninput = () => { f.q = qi.value; draw(); };
      sh.q('#pk-new').onclick = () => openCustomerForm(null, async (id) => { onPick(id); await closeSheet(); });
      draw();
    },
  });
}

// ---------- New / edit customer ----------

const hasContactPicker = () => 'contacts' in navigator && 'ContactsManager' in window;

function openCustomerForm(id = null, onSaved = null) {
  const c = id ? customerOf(id) : null;
  const f = c
    ? { name: c.name, phone: c.phone || '', area: c.area || '', type: c.type || null, note: c.note || '', source: c.source, error: '' }
    : { name: '', phone: '', area: '', type: null, note: '', source: 'manual', error: '' };
  openSheet({ title: c ? 'Edit Customer' : 'New Customer', render: (sh) => renderCustomerForm(sh, c, f, onSaved) });
}

function renderCustomerForm(sh, c, f, onSaved) {
  sh.set(`
    ${!c && hasContactPicker() ? `
      <button type="button" class="btn btn-gold btn-big" id="cf-contacts">Choose from Contacts</button>
      <p class="muted small" style="margin-top:6px">Or type the details below.</p>` : ''}
    <label class="field"><span class="label">Name (required)</span>
      <input class="input" id="cf-name" autocomplete="off" value="${esc(f.name)}"></label>
    <label class="field"><span class="label">Phone (optional)</span>
      <input class="input" id="cf-phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(f.phone)}" placeholder="0917 123 4567"></label>
    <label class="field"><span class="label">Area / barangay (optional)</span>
      <input class="input" id="cf-area" autocomplete="off" value="${esc(f.area)}"></label>
    <div class="field"><span class="label">Type</span>
      <div class="chips">${CUSTOMER_TYPES.map((t) => `<button type="button" class="chip" data-type="${t.v}" aria-pressed="${f.type === t.v}">${t.label}</button>`).join('')}</div>
    </div>
    <label class="field"><span class="label">Note (optional)</span>
      <input class="input" id="cf-note" autocomplete="off" value="${esc(f.note)}"></label>
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="cf-save">Save Customer</button>`);

  const bind = (sel, key) => { sh.q(sel).oninput = (e) => { f[key] = e.target.value; }; };
  bind('#cf-name', 'name'); bind('#cf-phone', 'phone'); bind('#cf-area', 'area'); bind('#cf-note', 'note');
  sh.qa('[data-type]').forEach((b) => { b.onclick = () => { f.type = f.type === b.dataset.type ? null : b.dataset.type; sh.refresh(); }; });

  const cb = sh.q('#cf-contacts');
  if (cb) cb.onclick = async () => {
    try {
      const res = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (res && res.length) {
        const ct = res[0];
        if (ct.name && ct.name[0]) f.name = ct.name[0].trim();
        if (ct.tel && ct.tel[0]) f.phone = ct.tel[0].trim();
        f.source = 'contacts';
        sh.refresh();
      }
    } catch (err) {
      console.warn(err);
      toast('Could not open Contacts. Please type the name instead.', true);
    }
  };

  sh.q('#cf-save').onclick = async () => {
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!name) { f.error = 'Type the customer\'s name.'; sh.refresh(); return; }
    const phoneNorm = C.normalizePhone(f.phone);
    const others = S.customers.filter((x) => !c || x.id !== c.id);
    const sameName = others.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const samePhone = phoneNorm && others.find((x) => x.phoneNorm === phoneNorm);
    if (sameName || samePhone) {
      const who = sameName || samePhone;
      const why = sameName ? 'the same name' : 'the same phone number';
      const go = await ask(`"${who.name}" already has ${why}. Is this a different person?`, { yes: 'Yes, save as new', no: 'Go back' });
      if (!go) return;
    }
    const stamp = DB.nowStamp();
    const value = {
      ...(c || { id: DB.newId('c'), createdAt: stamp }),
      name, phone: f.phone.trim(), phoneNorm, area: f.area.trim(), type: f.type, note: f.note.trim(),
      source: f.source || 'manual', updatedAt: stamp,
    };
    const ok = await save([{ store: 'customers', value }],
      { action: c ? 'edit' : 'create', entity: 'customer', id: value.id, summary: { text: name, before: c || null, after: value } });
    if (!ok) return;
    await closeSheet();
    toast(c ? 'Customer updated' : 'Customer saved');
    if (onSaved) await onSaved(value.id);
  };
}

// ---------- Customer details and purchase history ----------

function openCustomerDetail(id) {
  openSheet({ title: 'Customer', render: (sh) => renderCustomerDetail(sh, id) });
}

function renderCustomerDetail(sh, id) {
  const c = customerOf(id);
  if (!c) { sh.set('<p>Customer not found.</p>'); return; }
  const s = C.customerSummary(id, S.orders);
  const orders = S.orders.filter((o) => o.customerId === id).sort(desc);
  const statusBadge = (o) => {
    const st = C.paymentStatus(o);
    if (st === 'cancelled') return `<span class="badge b-grey">Cancelled</span>`;
    if (st === 'paid') return `<span class="badge b-green">Paid</span>`;
    if (st === 'partial') return `<span class="badge b-orange">Balance ${peso(C.balanceOf(o))}</span>`;
    return `<span class="badge b-red">Not paid</span>`;
  };

  sh.set(`
    <div class="card">
      <h2>${esc(c.name)}</h2>
      ${c.area || c.type ? `<p class="muted">${esc([c.area, typeLabel(c.type)].filter(Boolean).join(' · '))}</p>` : ''}
      ${c.phone ? `<p style="margin-top:6px"><a class="btn btn-small" href="tel:${esc(c.phoneNorm || c.phone)}">Call ${esc(c.phone)}</a></p>` : ''}
      ${c.note ? `<p class="muted" style="margin-top:6px">${esc(c.note)}</p>` : ''}
    </div>
    <div class="card">
      <div class="row"><span>Total bought</span><span class="amount">${peso(s.bought)}</span></div>
      <div class="row"><span>Unpaid</span><span class="amount ${s.unpaid > 0 ? 'red' : ''}">${peso(s.unpaid)}</span></div>
      <div class="row"><span>Orders</span><span class="amount">${s.count}</span></div>
      <div class="row"><span>Last order</span><span>${s.lastDate ? fmtDate(s.lastDate) : '—'}</span></div>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button type="button" class="btn btn-primary" data-act="new-order" data-customer="${c.id}">+ New Order</button>
      <button type="button" class="btn" id="cd-edit">Edit</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Purchase history</h2><span class="count">${orders.length}</span></div>
      ${orders.length ? orders.map((o) => `
        <article class="card tap ${o.status === 'cancelled' ? 'cancelled' : ''}" data-act="open-order" data-id="${o.id}">
          <div class="row"><strong>${fmtDate(o.dateOrdered)}</strong>${statusBadge(o)}</div>
          ${o.items.map((it) => {
            const p = productOf(it.productId);
            return `<div style="margin-top:6px">
              <div>${esc(p ? p.name : 'Product')} · ${esc(it.packagingLabel)}</div>
              <div class="row muted"><span>${C.formatQty(Math.round(it.qty * 1000))} × ${peso(it.pricePerUnit)}</span><span>${peso(it.lineTotal)}</span></div>
            </div>`;
          }).join('')}
          <div class="row" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px">
            <strong>Total</strong><strong class="${o.status === 'cancelled' ? 'strike' : ''}">${peso(o.total)}</strong></div>
        </article>`).join('') : `<p class="muted">No orders yet.</p>`}
    </section>`);
  sh.q('#cd-edit').onclick = () => openCustomerForm(id);
}

// ===================================================================
// STOCK tab
// ===================================================================

function renderStock() {
  const inv = C.inventory(S.products, S.stockIns, S.orders);
  const avgs = C.averageCosts(S.stockIns, S.orders);
  const products = S.products.filter((p) => p.active !== false);
  const hidden = S.products.filter((p) => p.active === false);
  const history = [...S.stockIns].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 30);

  const productCard = (p) => {
    const left = inv[p.id] || 0;
    const low = p.lowStockAt != null && left >= 0 && left <= p.lowStockAt;
    return `
      <article class="card">
        <div class="row"><h3>${esc(p.name)}</h3><button type="button" class="btn btn-small" data-act="edit-product" data-id="${p.id}">Edit</button></div>
        <p class="stock-big ${left < 0 ? 'neg' : low ? 'low' : ''}">${C.formatBase(left, p.baseUnit)}</p>
        ${left < 0 ? `<p class="red small"><strong>Below zero:</strong> some stock was sold but not recorded as stock in.</p>` : ''}
        ${low ? `<p class="orange small"><strong>Low stock.</strong> Time to restock?</p>` : ''}
        <p class="muted">Selling price ${peso(p.sellPricePerBase)} per ${p.baseUnit}</p>
        ${avgs[p.id] && avgs[p.id].avg ? `<p class="muted">Average cost ${peso(avgs[p.id].avg)} per ${p.baseUnit}</p>` : ''}
      </article>`;
  };

  main().innerHTML = `
    <button type="button" class="btn btn-primary btn-big" data-act="add-stock">+ Add Stock</button>
    <section class="section">
      <div class="section-head"><h2>Stock left</h2></div>
      ${products.map(productCard).join('')}
      <button type="button" class="btn btn-big" data-act="new-product" style="margin-top:10px">+ New Product</button>
      ${hidden.length ? `<p class="muted" style="margin-top:10px">Not selling now: ${hidden.map((p) => `<button type="button" class="btn-link" data-act="edit-product" data-id="${p.id}">${esc(p.name)}</button>`).join(', ')}</p>` : ''}
    </section>
    <section class="section">
      <div class="section-head"><h2>Stock in history</h2><span class="count">${S.stockIns.length}</span></div>
      ${history.length ? history.map((s) => {
        const p = productOf(s.productId);
        const cancelled = s.status === 'cancelled';
        return `<article class="card tap ${cancelled ? 'cancelled' : ''}" data-act="open-stockin" data-id="${s.id}">
          <div class="row"><strong>${esc(p ? p.name : '')}</strong><span class="amount ${cancelled ? 'strike' : ''}">${peso(s.totalCost)}</span></div>
          <p class="muted">${C.formatQty(Math.round(s.qty * 1000))} × ${esc(s.packagingLabel)} = ${C.formatBase(s.qtyBase, p ? p.baseUnit : '')}</p>
          <p class="muted">${fmtDate(s.date)}${s.supplier ? ' · ' + esc(s.supplier) : ''}</p>
          ${cancelled ? `<div class="badges"><span class="badge b-grey">Cancelled</span></div>` : ''}
        </article>`;
      }).join('') : `<p class="muted">No stock recorded yet. Tap <strong>+ Add Stock</strong> when you buy rice or oil.</p>`}
    </section>
    <p class="info" style="margin-top:18px">Stock count comes in the next version.</p>
    ${footer()}`;
}

// ---------- Add stock (stock in) ----------

function openStockInForm() {
  const active = S.products.filter((p) => p.active !== false);
  const f = { productId: active.length === 1 ? active[0].id : null, packagingLabel: null, qtyText: '1', costText: '', supplier: '', date: today(), note: '', error: '' };
  openSheet({ title: 'Add Stock', render: (sh) => renderStockInForm(sh, f) });
}

function renderStockInForm(sh, f) {
  const active = S.products.filter((p) => p.active !== false);
  const p = productOf(f.productId);
  const pk = p && p.packagings.find((x) => x.label === f.packagingLabel);
  sh.set(`
    <div class="field"><span class="label">Product</span>
      <div class="chips">${active.map((x) => `<button type="button" class="chip" data-prod="${x.id}" aria-pressed="${x.id === f.productId}">${esc(x.name)}</button>`).join('')}</div>
    </div>
    ${p ? `<div class="field"><span class="label">Packaging</span>
      <div class="chips stack">${p.packagings.map((x) => `
        <button type="button" class="chip" data-pack="${esc(x.label)}" aria-pressed="${x.label === f.packagingLabel}">
          ${esc(x.label)} <span class="muted">· ${C.formatBase(x.sizeInBase, p.baseUnit)}</span></button>`).join('')}</div>
      ${pk && pk.note ? `<p class="warn">${esc(pk.note)}</p>` : ''}</div>` : ''}
    ${pk ? `
      <label class="field"><span class="label">How many ${esc(pk.label)}?</span>
        <input class="input big" id="s-qty" inputmode="decimal" autocomplete="off" value="${esc(f.qtyText)}"></label>
      <label class="field"><span class="label">Total cost paid (₱)</span>
        <input class="input big" id="s-cost" inputmode="decimal" autocomplete="off" value="${esc(f.costText)}" placeholder="0.00">
        <span class="hint">Everything you paid for this stock.</span></label>
      <div id="s-live"></div>
      <label class="field"><span class="label">Supplier (optional)</span>
        <input class="input" id="s-sup" autocomplete="off" value="${esc(f.supplier)}"></label>
      <label class="field"><span class="label">Date bought</span>
        <input class="input" type="date" id="s-date" value="${f.date}" max="${today()}"></label>
      <label class="field"><span class="label">Note (optional)</span>
        <input class="input" id="s-note" autocomplete="off" value="${esc(f.note)}"></label>` : ''}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, pk ? `<button type="button" class="btn btn-primary btn-big" id="s-save">Save Stock</button>` : '');

  sh.qa('[data-prod]').forEach((b) => { b.onclick = () => { f.productId = b.dataset.prod; f.packagingLabel = null; sh.refresh(); }; });
  sh.qa('[data-pack]').forEach((b) => { b.onclick = () => { f.packagingLabel = b.dataset.pack; sh.refresh(); }; });
  if (!pk) return;

  const live = () => {
    const qm = C.parseQtyMilli(f.qtyText);
    const cost = C.parsePeso(f.costText);
    const box = sh.q('#s-live');
    if (!qm) { box.innerHTML = ''; return; }
    const base = C.qtyBaseOf(qm, pk.sizeInBase);
    box.innerHTML = `<p class="info">= ${C.formatBase(base, p.baseUnit)}${cost ? ` · ${peso(Math.round((cost * 1000) / base))} per ${p.baseUnit}` : ''}</p>`;
  };
  sh.q('#s-qty').oninput = (e) => { f.qtyText = e.target.value; live(); };
  sh.q('#s-cost').oninput = (e) => { f.costText = e.target.value; live(); };
  sh.q('#s-sup').oninput = (e) => { f.supplier = e.target.value; };
  sh.q('#s-date').onchange = (e) => { f.date = e.target.value || today(); };
  sh.q('#s-note').oninput = (e) => { f.note = e.target.value; };
  live();

  sh.q('#s-save').onclick = async () => {
    const qm = C.parseQtyMilli(f.qtyText);
    const cost = C.parsePeso(f.costText);
    if (!qm) f.error = 'Type how many you bought.';
    else if (!cost) f.error = 'Type the total cost you paid.';
    else f.error = '';
    if (f.error) { sh.refresh(); return; }
    const stamp = DB.nowStamp();
    const value = {
      id: DB.newId('s'), date: f.date, productId: p.id, packagingLabel: pk.label,
      qty: qm / 1000, qtyBase: C.qtyBaseOf(qm, pk.sizeInBase), totalCost: cost,
      supplier: f.supplier.trim(), note: f.note.trim(), status: 'active',
      createdAt: stamp, updatedAt: stamp,
    };
    const ok = await save([{ store: 'stockIns', value }],
      { action: 'create', entity: 'stockIn', id: value.id, summary: { text: `${p.name} ${C.formatBase(value.qtyBase, p.baseUnit)} for ${peso(cost)}`, after: value } });
    if (!ok) return;
    await closeSheet();
    toast('Stock saved');
  };
}

function openStockInDetail(id) {
  openSheet({
    title: 'Stock in',
    render: (sh) => {
      const s = byId(S.stockIns, id);
      const p = productOf(s.productId);
      const cancelled = s.status === 'cancelled';
      sh.set(`
        <div class="card">
          <h2>${esc(p ? p.name : '')}</h2>
          <p style="margin-top:6px">${C.formatQty(Math.round(s.qty * 1000))} × ${esc(s.packagingLabel)} = <strong>${C.formatBase(s.qtyBase, p ? p.baseUnit : '')}</strong></p>
          <div class="row" style="margin-top:6px"><span>Total cost</span><span class="amount">${peso(s.totalCost)}</span></div>
          <div class="row"><span>Cost per ${p ? p.baseUnit : ''}</span><span>${peso(Math.round((s.totalCost * 1000) / s.qtyBase))}</span></div>
          <div class="row"><span>Date bought</span><span>${fmtDate(s.date)}</span></div>
          ${s.supplier ? `<div class="row"><span>Supplier</span><span>${esc(s.supplier)}</span></div>` : ''}
          ${s.note ? `<p class="muted" style="margin-top:6px">${esc(s.note)}</p>` : ''}
        </div>
        ${cancelled ? `<p class="warn">Cancelled on ${fmtDate(s.cancelledDate)}. Reason: ${esc(s.cancelReason)}</p>` : `
          <button type="button" class="btn btn-danger btn-big" id="si-cancel" style="margin-top:16px">Cancel this stock in</button>
          <p class="muted small" style="margin-top:6px">Use this only if it was entered by mistake. Then add it again correctly.</p>`}`);
      const cb = sh.q('#si-cancel');
      if (cb) cb.onclick = async () => {
        const reason = await ask('Cancel this stock in? The record stays, marked Cancelled, and the stock is taken out.',
          { yes: 'Cancel stock in', danger: true, input: { label: 'Why? (required)', required: true, requiredMsg: 'Please type the reason.' } });
        if (!reason) return;
        const stamp = DB.nowStamp();
        const after = { ...clone(s), status: 'cancelled', cancelReason: reason, cancelledAt: stamp, cancelledDate: today(), updatedAt: stamp };
        const ok = await save([{ store: 'stockIns', value: after }],
          { action: 'cancel', entity: 'stockIn', id: s.id, summary: { text: `Stock in cancelled: ${reason}`, before: s, after } }, ['cancels']);
        if (ok) { toast('Stock in cancelled'); sh.refresh(); }
      };
    },
  });
}

// ---------- New / edit product ----------

function openProductForm(id) {
  const p = id ? productOf(id) : null;
  const f = p
    ? { name: p.name, baseUnit: p.baseUnit, priceText: pesoInput(p.sellPricePerBase), lowText: baseInput(p.lowStockAt), active: p.active !== false,
        packs: p.packagings.map((x) => ({ label: x.label, sizeText: String(x.sizeInBase), note: x.note || '' })), error: '' }
    : { name: '', baseUnit: 'kg', priceText: '', lowText: '', active: true, packs: [{ label: '', sizeText: '', note: '' }], error: '' };
  openSheet({ title: p ? 'Edit Product' : 'New Product', render: (sh) => renderProductForm(sh, p, f) });
}

function renderProductForm(sh, p, f) {
  const used = p && (S.stockIns.some((s) => s.productId === p.id) || S.orders.some((o) => o.items.some((it) => it.productId === p.id)));
  const small = f.baseUnit === 'kg' ? 'grams' : 'ml';
  sh.set(`
    <label class="field"><span class="label">Product name</span>
      <input class="input" id="pf-name" autocomplete="off" value="${esc(f.name)}" placeholder="e.g. Bigas – Dinorado"></label>
    <div class="field"><span class="label">Sold by</span>
      <div class="chips">
        <button type="button" class="chip" data-unit="kg" aria-pressed="${f.baseUnit === 'kg'}" ${used ? 'disabled' : ''}>kg (rice)</button>
        <button type="button" class="chip" data-unit="L" aria-pressed="${f.baseUnit === 'L'}" ${used ? 'disabled' : ''}>L (oil)</button>
      </div>
      ${used ? `<span class="hint">This can't change because the product already has records.</span>` : ''}
    </div>
    <label class="field"><span class="label">Selling price per ${f.baseUnit} (₱)</span>
      <input class="input big" id="pf-price" inputmode="decimal" autocomplete="off" value="${esc(f.priceText)}"></label>
    <label class="field"><span class="label">Low stock warning at (${f.baseUnit}, optional)</span>
      <input class="input" id="pf-low" inputmode="decimal" autocomplete="off" value="${esc(f.lowText)}" placeholder="e.g. 10">
      <span class="hint">The stock turns orange at this amount.</span></label>

    <div class="field"><span class="label">Packaging sizes (in ${small})</span>
      ${f.packs.map((x, i) => `
        <div class="card pack-row">
          <label><span class="muted small">Name</span><input class="input" data-plabel="${i}" autocomplete="off" value="${esc(x.label)}" placeholder="e.g. kilo"></label>
          <label><span class="muted small">${small}</span><input class="input" data-psize="${i}" inputmode="numeric" autocomplete="off" value="${esc(x.sizeText)}" placeholder="${f.baseUnit === 'kg' ? '1000' : '350'}"></label>
          ${x.note ? `<p class="muted small" style="grid-column:1/-1">${esc(x.note)}</p>` : ''}
          ${f.packs.length > 1 ? `<button type="button" class="btn btn-small btn-danger remove" data-premove="${i}">Remove</button>` : ''}
        </div>`).join('')}
      <button type="button" class="btn btn-big" id="pf-addpack" style="margin-top:10px">+ Add packaging</button>
    </div>
    ${p ? `<label class="check"><input type="checkbox" id="pf-active" ${f.active ? 'checked' : ''}><span>Still selling this product</span></label>` : ''}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="pf-save">Save Product</button>`);

  sh.q('#pf-name').oninput = (e) => { f.name = e.target.value; };
  sh.q('#pf-price').oninput = (e) => { f.priceText = e.target.value; };
  sh.q('#pf-low').oninput = (e) => { f.lowText = e.target.value; };
  sh.qa('[data-unit]').forEach((b) => { b.onclick = () => { f.baseUnit = b.dataset.unit; sh.refresh(); }; });
  sh.qa('[data-plabel]').forEach((el) => { el.oninput = () => { f.packs[Number(el.dataset.plabel)].label = el.value; }; });
  sh.qa('[data-psize]').forEach((el) => { el.oninput = () => { f.packs[Number(el.dataset.psize)].sizeText = el.value; }; });
  sh.qa('[data-premove]').forEach((b) => { b.onclick = () => { f.packs.splice(Number(b.dataset.premove), 1); sh.refresh(); }; });
  sh.q('#pf-addpack').onclick = () => { f.packs.push({ label: '', sizeText: '', note: '' }); sh.refresh(); };
  const act = sh.q('#pf-active'); if (act) act.onchange = (e) => { f.active = e.target.checked; };

  sh.q('#pf-save').onclick = async () => {
    const name = f.name.trim().replace(/\s+/g, ' ');
    const price = C.parsePeso(f.priceText);
    const low = f.lowText.trim() ? C.parseQtyMilli(f.lowText) : null;
    const packs = f.packs.map((x) => ({ label: x.label.trim(), size: /^\d+$/.test(x.sizeText.trim()) ? parseInt(x.sizeText.trim(), 10) : null, note: x.note }));
    const labels = packs.map((x) => x.label.toLowerCase());
    if (!name) f.error = 'Type the product name.';
    else if (S.products.some((x) => x.id !== (p && p.id) && x.name.toLowerCase() === name.toLowerCase())) f.error = 'Another product already has this name.';
    else if (!price) f.error = `Type the selling price per ${f.baseUnit}.`;
    else if (f.lowText.trim() && low == null) f.error = 'Check the low stock number.';
    else if (packs.some((x) => !x.label)) f.error = 'Every packaging needs a name.';
    else if (packs.some((x) => !x.size)) f.error = `Every packaging needs a size in whole ${small} (e.g. 350).`;
    else if (new Set(labels).size !== labels.length) f.error = 'Two packagings have the same name.';
    else f.error = '';
    if (f.error) { sh.refresh(); return; }
    const stamp = DB.nowStamp();
    const value = {
      ...(p ? clone(p) : { id: DB.newId('p'), createdAt: stamp }),
      name, baseUnit: f.baseUnit, sellPricePerBase: price, lowStockAt: low, active: f.active,
      packagings: packs.map((x) => (x.note ? { label: x.label, sizeInBase: x.size, note: x.note } : { label: x.label, sizeInBase: x.size })),
      updatedAt: stamp,
    };
    const ok = await save([{ store: 'products', value }],
      { action: p ? 'edit' : 'create', entity: 'product', id: value.id, summary: { text: name, before: p || null, after: value } });
    if (!ok) return;
    await closeSheet();
    toast('Product saved');
  };
}

// ===================================================================
// INCOME and QUEST tabs (next versions)
// ===================================================================

function renderIncome() {
  main().innerHTML = `
    <div class="placeholder-tab">
      ${img('mascot-bigas-isip.jpg', 'Coming soon')}
      <h2>Income</h2>
      <p class="muted" style="margin-top:8px">Sales, costs, expenses and income come in the next version.</p>
    </div>${footer()}`;
}

function renderQuest() {
  main().innerHTML = `
    <div class="placeholder-tab">
      ${img('mascot-mantika-cheer.jpg', 'Coming soon')}
      <h2>Negosyo Quest</h2>
      <p class="muted" style="margin-top:8px">The game comes in a later version. Keep recording every sale!</p>
    </div>${footer()}`;
}

init();
