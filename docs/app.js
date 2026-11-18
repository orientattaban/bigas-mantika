// app.js: the screens of Bigas at Mantika (Phase 1: records; Phase 2: numbers; Phase 3: Negosyo Quest).
import * as C from './calc.js';
import * as DB from './db.js';
import * as B from './backup.js';
import { makeDemo } from './demo.js';
import { drawReport, COLORS } from './report.js';
import * as G from './game.js';
import { esc, img, toast, ask, openSheet, closeSheet, closeAllSheets, topSheet, setAfterClose, celebrate } from './ui.js';

export const APP_VERSION = '0.3.0';

const S = {
  products: [], stockIns: [], customers: [], orders: [], settings: {},
  expenses: [], withdrawals: [], stockCounts: [], cashCounts: [],
  tab: 'orders', customerSearch: '',
  period: { mode: 'week', from: null, to: null },
};

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
const capitalList = () => S.settings.capitalReleased || [];
// Everything the calculations need, in one object.
const allData = () => ({ ...S, capital: capitalList() });
const invNow = () => C.inventory(S.products, S.stockIns, S.orders, S);
const avgNow = () => C.averageCosts(S.stockIns, S.orders, S);
const active = (r) => r.status !== 'cancelled';
const counters = () => S.settings.counters || {};

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
    if (p.store === 'settings') { S.settings[p.value.key] = p.value.value; continue; }
    const list = S[p.store];
    const i = list.findIndex((x) => x.id === p.value.id);
    if (i >= 0) list[i] = p.value; else list.push(p.value);
  }
  renderMain();
  checkCelebrate();
  return true;
}

// ===================================================================
// Start-up
// ===================================================================

async function init() {
  try {
    await DB.openDb(() => {
      main().innerHTML = `<div class="card"><h2>Please close the other Bigas at Mantika tab</h2>
        <p class="muted" style="margin-top:8px">An older copy of the app is open in another Chrome tab. Close it (or close Chrome and open the app again). This screen continues by itself.</p></div>`;
    });
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
      'tab': async () => { await closeAllSheets(); setTab(el.dataset.tab); },
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
      'count-stock': () => openStockCountForm(el.dataset.product),
      'add-expense': () => openExpenseForm(),
      'add-taken': () => openTakenForm(),
      'count-cash': () => openCashCountForm(),
      'open-entry': () => openEntryDetail(el.dataset.kind, id),
      'send-report': () => openReport(),
      'backup': () => doBackup(),
      'coach': () => openCoach(),
      'go-income': async () => { await closeAllSheets(); setTab('income'); },
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

// Short payment badge for cards: Paid / Balance ₱X / Not paid / Cancelled
function payBadge(o) {
  const st = C.paymentStatus(o);
  if (st === 'cancelled') return `<span class="badge b-grey">Cancelled</span>`;
  if (st === 'paid') return `<span class="badge b-green">Paid</span>`;
  if (st === 'partial') return `<span class="badge b-orange">Balance ${peso(C.balanceOf(o))}</span>`;
  return `<span class="badge b-red">Not paid</span>`;
}

// Order card: line 1 = customer + amount; line 2 = items · date + payment status (under the amount).
function orderCard(o) {
  const c = customerOf(o.customerId);
  const cancelled = o.status === 'cancelled';
  const btns = [];
  if (!cancelled) {
    if (o.delivery.status === 'pending') btns.push(`<button type="button" class="btn btn-small" data-act="deliver" data-id="${o.id}">✓ Delivered</button>`);
    if (C.balanceOf(o) > 0) btns.push(`<button type="button" class="btn btn-small btn-gold" data-act="pay" data-id="${o.id}">₱ Receive payment</button>`);
  }
  return `
    <article class="card compact tap ${cancelled ? 'cancelled' : ''}" data-act="open-order" data-id="${o.id}">
      <div class="row"><h3 class="ell">${esc(c ? c.name : 'Unknown customer')}</h3>
        <span class="amount ${cancelled ? 'strike' : ''}">${peso(o.total)}</span></div>
      <div class="line2">
        <span class="left"><span class="ell">${esc(o.items.map(itemText).join(', '))}</span><span class="nowrap">· ${fmtDate(o.dateOrdered)}</span></span>
        ${payBadge(o)}
      </div>
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
    ${banners()}
    <button type="button" class="btn btn-primary btn-big" data-act="new-order">+ New Order</button>
    ${lowStockBanner()}
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
  const inv = invNow()[productId] || 0;
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
      const have = invNow()[pid] || 0;
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
      <div class="chips row3">
        ${chip('pay', 'full', 'Fully paid', d.payMode === 'full')}
        ${chip('pay', 'part', 'Partial', d.payMode === 'part')}
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
      <div class="chips row2">
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
    else if (paidNow >= total) d.error = `The amount is the full total or more. Choose "Fully paid" instead.`;
    else d.error = '';
  } else d.error = '';
  if (d.error) { sh.refresh(); return; }
  if (d.payMode === 'full') paidNow = total;

  const stamp = DB.nowStamp();
  const avgs = avgNow();
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
  const it = {
    productId: active.length === 1 ? active[0].id : null, packagingLabel: null,
    custom: false, customSizeText: '', customName: '',
    qtyText: '1', priceText: '', priceEdited: false, error: '',
  };
  openSheet({ title: 'Add item', render: (sh) => renderItemForm(sh, d, it) });
}

// The pack chosen: one from the list, or an "other size" typed for this order only.
function packOf(it, p) {
  if (!p) return null;
  if (it.custom) {
    const t = it.customSizeText.trim();
    const size = /^\d+$/.test(t) ? parseInt(t, 10) : 0;
    if (!size) return null;
    return { label: it.customName.trim() || C.formatBase(size, p.baseUnit), sizeInBase: size, custom: true };
  }
  return p.packagings.find((x) => x.label === it.packagingLabel) || null;
}

function itemCalc(it) {
  const p = productOf(it.productId);
  const pk = packOf(it, p);
  const qtyMilli = C.parseQtyMilli(it.qtyText);
  const price = C.parsePeso(it.priceText);
  if (!p || !pk || !qtyMilli || price == null) return null;
  return { p, pk, qtyMilli, price, qtyBase: C.qtyBaseOf(qtyMilli, pk.sizeInBase), lineTotal: C.lineTotalOf(qtyMilli, price) };
}

function renderItemForm(sh, d, it) {
  const active = S.products.filter((p) => p.active !== false);
  const p = productOf(it.productId);
  const listPk = p && !it.custom ? p.packagings.find((x) => x.label === it.packagingLabel) : null;
  const showQty = p && (listPk || it.custom);
  const small = p && p.baseUnit === 'kg' ? 'grams' : 'ml';

  sh.set(`
    <div class="field"><span class="label">Product</span>
      <div class="chips">${active.map((x) => `<button type="button" class="chip" data-prod="${x.id}" aria-pressed="${x.id === it.productId}">${esc(x.name)}</button>`).join('')}</div>
    </div>
    ${p ? `
      <div class="field"><span class="label">Packaging</span>
        <div class="chips stack">${p.packagings.map((x) => `
          <button type="button" class="chip" data-pack="${esc(x.label)}" aria-pressed="${!it.custom && x.label === it.packagingLabel}">
            ${esc(x.label)} <span class="muted">· ${C.formatBase(x.sizeInBase, p.baseUnit)}</span></button>`).join('')}
          <button type="button" class="chip" id="pack-other" aria-pressed="${it.custom}">Other size (type it)</button>
        </div>
        ${listPk && listPk.note ? `<p class="warn">${esc(listPk.note)}</p>` : ''}
      </div>` : ''}
    ${p && it.custom ? `
      <label class="field"><span class="label">Size of one pack (${small})</span>
        <input class="input big" id="i-size" inputmode="numeric" autocomplete="off" value="${esc(it.customSizeText)}" placeholder="${p.baseUnit === 'kg' ? 'e.g. 3000 for 3 kg' : 'e.g. 500'}"></label>
      <label class="field"><span class="label">Name (optional)</span>
        <input class="input" id="i-cname" autocomplete="off" value="${esc(it.customName)}" placeholder="e.g. plastic bag">
        <span class="hint">Only for this order. To keep a size for next time, add it in Stock → Edit product.</span></label>` : ''}
    ${showQty ? `
      <div class="field"><span class="label">How many?</span>
        <div class="stepper">
          <button type="button" class="btn" id="minus" aria-label="One less">−</button>
          <input class="input big" id="i-qty" inputmode="decimal" autocomplete="off" value="${esc(it.qtyText)}">
          <button type="button" class="btn" id="plus" aria-label="One more">+</button>
        </div>
      </div>
      <label class="field"><span class="label" id="i-price-label">Price for one pack (₱)</span>
        <input class="input big" id="i-price" inputmode="decimal" autocomplete="off" value="${esc(it.priceText)}">
        <span class="hint" id="i-suggest"></span>
      </label>
      <div id="i-live"></div>` : ''}
    ${it.error ? `<p class="error">${esc(it.error)}</p>` : ''}
  `, showQty ? `<button type="button" class="btn btn-primary btn-big" id="add">Add to order</button>` : '');

  sh.qa('[data-prod]').forEach((b) => {
    b.onclick = () => { it.productId = b.dataset.prod; it.packagingLabel = null; it.custom = false; it.priceText = ''; it.priceEdited = false; sh.refresh(); };
  });
  sh.qa('[data-pack]').forEach((b) => {
    b.onclick = () => {
      it.custom = false;
      it.packagingLabel = b.dataset.pack;
      const x = p.packagings.find((y) => y.label === it.packagingLabel);
      it.priceText = pesoInput(C.prefillUnitPrice(p.sellPricePerBase, x.sizeInBase));
      it.priceEdited = false;
      sh.refresh();
    };
  });
  const other = sh.q('#pack-other');
  if (other) other.onclick = () => { it.custom = true; it.packagingLabel = null; it.priceText = ''; it.priceEdited = false; sh.refresh(); };
  if (!showQty) return;

  const priceInput = sh.q('#i-price');
  const live = () => {
    const pk = packOf(it, p);
    sh.q('#i-price-label').textContent = pk ? `Price for one ${pk.label} (₱)` : 'Price for one pack (₱)';
    const suggested = pk ? C.prefillUnitPrice(p.sellPricePerBase, pk.sizeInBase) : null;
    if (pk && it.custom && !it.priceEdited) { it.priceText = pesoInput(suggested); priceInput.value = it.priceText; }
    sh.q('#i-suggest').textContent = pk
      ? `Suggested: ${peso(suggested)} (${peso(p.sellPricePerBase)} per ${p.baseUnit}). Change it for a suki discount.`
      : `Type the size first.`;
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
  priceInput.oninput = () => { it.priceText = priceInput.value; it.priceEdited = true; live(); };
  const size = sh.q('#i-size'); if (size) size.oninput = () => { it.customSizeText = size.value; live(); };
  const cname = sh.q('#i-cname'); if (cname) cname.oninput = () => { it.customName = cname.value; live(); };
  const step = (delta) => {
    const m = C.parseQtyMilli(it.qtyText) || 0;
    const next = Math.max(1000, (Math.floor(m / 1000) + delta) * 1000);
    it.qtyText = C.formatQty(next); qty.value = it.qtyText; live();
  };
  sh.q('#minus').onclick = () => step(-1);
  sh.q('#plus').onclick = () => step(1);
  live();

  sh.q('#add').onclick = async () => {
    if (it.custom && !packOf(it, p)) { it.error = `Type the size of one pack in whole ${small}.`; sh.refresh(); return; }
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
    ${(o.followUps || []).length || (!cancelled && bal > 0) ? `<section class="section"><h3>Follow-up notes</h3>
      ${(o.followUps || []).map((n) => `<div class="card compact"><p class="muted small">${fmtDate(n.date)}</p><p>${esc(n.text)}</p></div>`).join('') || '<p class="muted small">None yet. After 30 days unpaid, a follow-up note keeps the "No old unpaid" mission.</p>'}
      ${!cancelled && bal > 0 ? `<button type="button" class="btn btn-small" id="add-follow" style="margin-top:8px">+ Add follow-up note</button>` : ''}
    </section>` : ''}

    ${cancelled ? '' : `<section class="section">
      <button type="button" class="btn btn-danger btn-big" id="cancel-order">Cancel this order</button>
      <p class="muted small" style="margin-top:6px">To fix a wrong order: cancel it, then make a new one.</p></section>`}
  `);

  const dl = sh.q('#deliver'); if (dl) dl.onclick = () => setDelivered(o.id, true);
  const ud = sh.q('#undeliver'); if (ud) ud.onclick = () => setDelivered(o.id, false);
  const co = sh.q('#cancel-order'); if (co) co.onclick = () => openCancelForm(o.id);
  const fu = sh.q('#add-follow'); if (fu) fu.onclick = () => addFollowUp(o.id);
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

// One line: name on the left; bought, last order and unpaid in small text on the right.
function customerCard(c) {
  const s = C.customerSummary(c.id, S.orders);
  return `
    <article class="card compact tap row" data-act="open-customer" data-id="${c.id}" style="align-items:center">
      <h3 class="ell">${esc(c.name)}</h3>
      <div class="side small muted">
        ${s.count ? `${peso(s.bought)} · ${fmtDate(s.lastDate)}` : 'No orders yet'}
        ${s.unpaid > 0 ? `<br><strong class="red">${peso(s.unpaid)} unpaid</strong>` : ''}
      </div>
    </article>`;
}

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
          ? list.map((c) => `<button type="button" class="card compact tap row" style="width:100%;text-align:left;align-items:center" data-pick="${c.id}">
              <strong class="ell">${esc(c.name)}</strong>${c.area ? `<span class="side small muted">${esc(c.area)}</span>` : ''}</button>`).join('')
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
    ? { name: c.name, phone: c.phone || '', area: c.area || '', note: c.note || '', source: c.source, error: '' }
    : { name: '', phone: '', area: '', note: '', source: 'manual', error: '' };
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
    <label class="field"><span class="label">Note (optional)</span>
      <input class="input" id="cf-note" autocomplete="off" value="${esc(f.note)}"></label>
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="cf-save">Save Customer</button>`);

  const bind = (sel, key) => { sh.q(sel).oninput = (e) => { f[key] = e.target.value; }; };
  bind('#cf-name', 'name'); bind('#cf-phone', 'phone'); bind('#cf-area', 'area'); bind('#cf-note', 'note');

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
      name, phone: f.phone.trim(), phoneNorm, area: f.area.trim(), note: f.note.trim(),
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
      ${c.area ? `<p class="muted">${esc(c.area)}</p>` : ''}
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
  const inv = invNow();
  const avgs = avgNow();
  const products = S.products.filter((p) => p.active !== false);
  const hidden = S.products.filter((p) => p.active === false);
  const history = [...S.stockIns].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 30);
  const value = C.stockValue(S.products, S.stockIns, S.orders, S);
  const counts = [...S.stockCounts].sort(byDateDesc).slice(0, 10);

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
        ${avgs[p.id] && avgs[p.id].avg ? `<p class="muted">Average cost ${peso(avgs[p.id].avg)} per ${p.baseUnit} · value ${peso(value.byProduct[p.id] || 0)}</p>` : ''}
        <div class="card-actions"><button type="button" class="btn btn-small" data-act="count-stock" data-product="${p.id}">Count ${esc(p.name)}</button></div>
      </article>`;
  };

  main().innerHTML = `
    ${stopBanner(gameNow())}
    <div class="btn-row">
      <button type="button" class="btn btn-primary btn-big" data-act="add-stock">+ Add Stock</button>
      <button type="button" class="btn btn-big" data-act="count-stock">Count Stock</button>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row"><span>Total stock value <span class="muted small">(at average cost)</span></span><span class="amount">${peso(value.total)}</span></div>
    </div>
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
    <section class="section">
      <div class="section-head"><h2>Stock counts</h2><span class="count">${S.stockCounts.length}</span></div>
      ${counts.length ? counts.map(stockCountCard).join('') : `<p class="muted">No stock count yet. Count each product once a week: tap <strong>Count Stock</strong>.</p>`}
    </section>
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
// Phase 2: shared bits
// ===================================================================

const byDateDesc = (a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt);
const EXPENSE_CATEGORIES = ['Delivery/Fuel', 'Plastic/Sacks', 'Load', 'Other'];
const COUNT_REASONS = ['Wet/Damaged', 'Used at home', 'Credit sale not recorded', "Don't know"];
const TAKEN_TYPES = { cash: 'Cash', goods: 'Goods for home' };
const businessName = () => S.settings.businessName || 'Bigas at Mantika';
const activeProducts = () => S.products.filter((p) => p.active !== false);
const chipBtn = (attr, v, label, sel) => `<button type="button" class="chip" data-${attr}="${esc(v)}" aria-pressed="${sel}">${esc(label)}</button>`;
const rowHtml = (label, value, cls = '') => `<div class="row"><span>${label}</span><span class="amount ${cls}">${value}</span></div>`;
const reasonInput = (msg) => ({ label: 'Why? (required)', required: true, requiredMsg: msg || 'Please type the reason.' });

function daysSinceBackup() {
  const last = S.settings.lastBackupDate;
  if (last) return { days: C.daysBetween(last, today()), never: false };
  const first = S.settings.firstRunAt ? C.todayManila(new Date(S.settings.firstRunAt)) : today();
  return { days: C.daysBetween(first, today()), never: true };
}

// Red banner when the last backup is more than 7 days old; Sunday reminder.
function banners() {
  const out = [];
  const b = daysSinceBackup();
  if (b.days > 7) {
    out.push(`<button type="button" class="banner bad" data-act="backup">${b.never ? 'No backup yet' : `Last backup: ${b.days} days ago`}. Tap here to make a backup file for Coach.</button>`);
  }
  if (C.dayOfWeek(today()) === 0) {
    out.push(`<button type="button" class="banner" data-act="go-income">It's Sunday: count the cash, then send the report and backup to Coach.</button>`);
  }
  return out.join('');
}


function diffBadge(diff, fmt, cancelled = false) {
  if (cancelled) return `<span class="badge b-grey">Cancelled</span>`;
  if (diff === 0) return `<span class="badge b-green">Exact ✓</span>`;
  return diff < 0 ? `<span class="badge b-red">Short ${fmt(-diff)}</span>` : `<span class="badge b-orange">Over ${fmt(diff)}</span>`;
}

// Save one or more settings (key/value) with a change-log line.
function saveSettings(obj, log, ctrs = []) {
  return save(Object.entries(obj).map(([key, value]) => ({ store: 'settings', value: { key, value } })), log, ctrs);
}

// Share a file (Messenger etc.); if this phone can't share files, download it instead.
async function shareOrDownload(file, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    console.warn('Share failed, downloading instead', err);
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

// ===================================================================
// STOCK COUNT (blind: she types the count first, then sees the app's number)
// ===================================================================

function stockCountCard(k) {
  const p = productOf(k.productId);
  const unit = p ? p.baseUnit : '';
  const fmt = (b) => C.formatBase(b, unit);
  const cancelled = k.status === 'cancelled';
  const acc = C.stockAccuracy(k);
  return `<article class="card compact tap ${cancelled ? 'cancelled' : ''}" data-act="open-entry" data-kind="stockCounts" data-id="${k.id}">
    <div class="row"><h3 class="ell">${esc(p ? p.name : '')} · ${fmtDate(k.date)}</h3>${diffBadge(k.difference, fmt, cancelled)}</div>
    <p class="muted small">Counted ${fmt(k.countedBase)} · app had ${fmt(k.systemBase)}${acc != null && k.difference ? ` · ${C.formatPct(acc)} off` : ''}${k.reason ? ' · ' + esc(k.reason) : k.difference ? ' · <span class="orange">no reason yet</span>' : ''}</p>
  </article>`;
}

function openStockCountForm(productId) {
  const act = activeProducts();
  const f = { productId: productId || (act.length === 1 ? act[0].id : null), countText: '', date: today(), savedId: null, reason: null, error: '' };
  openSheet({ title: 'Count Stock', render: (sh) => (f.savedId ? renderStockCountResult(sh, f) : renderStockCountForm(sh, f)) });
}

function renderStockCountForm(sh, f) {
  const p = productOf(f.productId);
  sh.set(`
    <p class="info">Count or weigh everything you have now, then type it. The app shows its own number <strong>after</strong> you save.</p>
    <div class="field"><span class="label">Product</span>
      <div class="chips">${activeProducts().map((x) => chipBtn('prod', x.id, x.name, x.id === f.productId)).join('')}</div></div>
    ${p ? `
      <label class="field"><span class="label">How much ${esc(p.name)} is there now? (${p.baseUnit})</span>
        <input class="input big" id="k-count" inputmode="decimal" autocomplete="off" value="${esc(f.countText)}" placeholder="${p.baseUnit === 'kg' ? 'e.g. 23.5' : 'e.g. 8.75'}">
        <span class="hint">${p.baseUnit === 'kg' ? 'In kilos. Half a kilo = 0.5' : 'In liters. One gin bilog bottle = 0.35'}</span></label>
      <label class="field"><span class="label">Date counted</span>
        <input class="input" type="date" id="k-date" value="${f.date}" max="${today()}"></label>` : ''}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, p ? `<button type="button" class="btn btn-primary btn-big" id="k-save">Save count</button>` : '');

  sh.qa('[data-prod]').forEach((b) => { b.onclick = () => { f.productId = b.dataset.prod; f.error = ''; sh.refresh(); }; });
  if (!p) return;
  sh.q('#k-count').oninput = (e) => { f.countText = e.target.value; };
  sh.q('#k-date').onchange = (e) => { f.date = e.target.value || today(); };
  sh.q('#k-save').onclick = async () => {
    const counted = C.parseQtyMilli(f.countText); // kilos or liters with up to 3 decimals = grams or ml
    if (counted == null || !f.countText.trim()) { f.error = `Type how much ${p.name} you counted, in ${p.baseUnit}.`; sh.refresh(); return; }
    const systemBase = invNow()[p.id] || 0;
    const avg = avgNow()[p.id];
    const stamp = DB.nowStamp();
    const value = {
      id: DB.newId('k'), date: f.date, productId: p.id, countedBase: counted, systemBase, difference: counted - systemBase,
      costPerBaseAtCount: avg ? avg.avg : 0, reason: null, note: '', status: 'active', createdAt: stamp, updatedAt: stamp,
    };
    const ok = await save([{ store: 'stockCounts', value }],
      { action: 'create', entity: 'stockCount', id: value.id, summary: { text: `${p.name}: counted ${C.formatBase(counted, p.baseUnit)}, app had ${C.formatBase(systemBase, p.baseUnit)}`, after: value } });
    if (!ok) return;
    f.savedId = value.id;
    f.error = '';
    sh.refresh();
  };
}

function stockCountFacts(k) {
  const p = productOf(k.productId);
  const unit = p ? p.baseUnit : '';
  const fmt = (b) => C.formatBase(b, unit);
  const loss = C.countLoss(k);
  const acc = C.stockAccuracy(k);
  return `
    ${rowHtml('You counted', fmt(k.countedBase))}
    ${rowHtml('The app had', fmt(k.systemBase))}
    <div class="row"><strong>Difference</strong>${diffBadge(k.difference, fmt)}</div>
    ${k.difference ? rowHtml(k.difference < 0 ? 'Loss at average cost' : 'Gain at average cost', peso(Math.abs(loss)), k.difference < 0 ? 'red' : '') : ''}
    ${acc != null && k.difference ? `<p class="muted small">${C.formatPct(acc)} different from the app.</p>` : ''}`;
}

function renderStockCountResult(sh, f) {
  const k = byId(S.stockCounts, f.savedId);
  const p = productOf(k.productId);
  sh.set(`
    <h3>${esc(p ? p.name : '')} · ${fmtDate(k.date)}</h3>
    <div class="card" style="margin-top:8px">${stockCountFacts(k)}</div>
    ${k.difference === 0 ? `<p class="info">Exact match. Very good!</p>` : `
      <p class="muted" style="margin-top:12px">Stock is now set to what you counted. ${k.difference < 0 ? 'The shortfall is counted as a loss in Income.' : 'The extra lowers the losses in Income.'}</p>
      <div class="field"><span class="label">What is the likely reason?</span>
        <div class="chips stack">${COUNT_REASONS.map((r) => chipBtn('reason', r, r, f.reason === r)).join('')}</div></div>`}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="k-done">Done</button>`);
  sh.qa('[data-reason]').forEach((b) => { b.onclick = () => { f.reason = b.dataset.reason; f.error = ''; sh.refresh(); }; });
  sh.q('#k-done').onclick = async () => {
    if (k.difference !== 0) {
      if (!f.reason) { f.error = 'Pick a reason. "Don\'t know" is fine.'; sh.refresh(); return; }
      if (!(await setCountReason(k, f.reason))) return;
    }
    await closeSheet();
    toast('Stock count saved');
  };
}

function setCountReason(k, reason) {
  const after = { ...clone(k), reason, updatedAt: DB.nowStamp() };
  return save([{ store: 'stockCounts', value: after }],
    { action: 'edit', entity: 'stockCount', id: k.id, summary: { text: `Reason: ${reason}`, before: { reason: k.reason }, after: { reason } } });
}

// ===================================================================
// INCOME tab
// ===================================================================

function weekRange() {
  const from = C.weekStart(today());
  return { from, to: C.addDays(from, 6) };
}

function periodRange() {
  const p = S.period;
  if (p.mode === 'month') return { from: C.monthStart(today()), to: C.monthEnd(today()) };
  if (p.mode === 'custom' && p.from && p.to) return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from };
  return weekRange();
}

function renderIncome() {
  const { from, to } = periodRange();
  const d = allData();
  const s = C.periodSummary(d, from, to);
  const u = C.unpaidByAge(S.orders, today());
  const cc = C.capitalCheck(d, today());
  const last = C.latestCashCount(S.cashCounts, today());
  const entries = [
    ...S.expenses.map((r) => ({ kind: 'expenses', r })),
    ...S.withdrawals.map((r) => ({ kind: 'withdrawals', r })),
    ...S.cashCounts.map((r) => ({ kind: 'cashCounts', r })),
  ].filter((e) => e.r.date >= from && e.r.date <= to).sort((a, b) => byDateDesc(a.r, b.r));
  const pm = S.period.mode;

  main().innerHTML = `
    ${banners()}
    ${stopBanner(gameNow())}
    <div class="btn-row">
      <button type="button" class="btn btn-gold" data-act="send-report">Send Report</button>
      <button type="button" class="btn" data-act="backup">Backup file</button>
    </div>
    <div class="chips row3" style="margin-top:14px">
      ${chipBtn('period', 'week', 'This week', pm === 'week')}${chipBtn('period', 'month', 'This month', pm === 'month')}${chipBtn('period', 'custom', 'Custom', pm === 'custom')}
    </div>
    ${pm === 'custom' ? `
      <div class="two-dates">
        <label class="field"><span class="label">From</span><input class="input" type="date" id="pd-from" value="${from}" max="${today()}"></label>
        <label class="field"><span class="label">To</span><input class="input" type="date" id="pd-to" value="${to}"></label>
      </div>` : ''}
    <h2 class="period-title">${C.formatRange(from, to)}</h2>

    <div class="card stmt">
      ${rowHtml('Sales', peso(s.sales))}
      ${rowHtml('− Cost of goods sold', peso(s.cogs))}
      ${rowHtml('− Lost / damaged', peso(s.losses))}
      ${rowHtml('− Expenses', peso(s.expenses))}
      <div class="row total"><span>Income</span><span class="amount ${s.income < 0 ? 'red' : 'green'}">${peso(s.income)}</span></div>
      ${rowHtml('Margin', C.formatPct(s.marginTenths))}
      <p class="muted small">${s.orderCount} ${s.orderCount === 1 ? 'order' : 'orders'} · cancelled orders not counted</p>
    </div>

    <div class="grid3">
      <button type="button" class="btn" data-act="add-expense">+ Expense</button>
      <button type="button" class="btn" data-act="add-taken">+ Taken out</button>
      <button type="button" class="btn" data-act="count-cash">Count Cash</button>
    </div>

    <section class="section"><h2>Money</h2>
      <div class="card">
        ${rowHtml('Collected <span class="muted small">(payments received)</span>', peso(s.collected))}
        ${rowHtml('Taken out: cash', peso(s.takenCash))}
        ${rowHtml('Taken out: goods', peso(s.takenGoods))}
      </div>
    </section>

    <section class="section"><h2>Unpaid by customers <span class="muted small">today</span></h2>
      <div class="card">
        ${rowHtml(`0–30 days <span class="muted small">(${u.n0})</span>`, peso(u.b0))}
        ${rowHtml(`31–60 days <span class="muted small">(${u.n31})</span>`, peso(u.b31), u.b31 ? 'orange' : '')}
        ${rowHtml(`Over 60 days <span class="muted small">(${u.n61})</span>`, peso(u.b61), u.b61 ? 'red' : '')}
        <div class="row total"><span>Total unpaid</span><span class="amount">${peso(u.total)}</span></div>
        ${u.count ? `<p class="muted small">${u.count} unpaid ${u.count === 1 ? 'order' : 'orders'} · oldest ${u.oldestDays} days</p>` : ''}
      </div>
    </section>

    <section class="section"><h2>Cash count</h2>
      ${last ? `<div class="card tap" data-act="open-entry" data-kind="cashCounts" data-id="${last.id}">
          <div class="row"><strong>Last count: ${fmtDate(last.date)}</strong>${diffBadge(last.difference, peso)}</div>
          ${rowHtml('Counted', peso(last.countedCash))}
          ${rowHtml('The app expected', peso(last.computedCash))}
          ${last.note ? `<p class="muted small">${esc(last.note)}</p>` : ''}
        </div>` : `<p class="muted">No cash count yet. Count the cash every Sunday: tap <strong>Count Cash</strong>.</p>`}
    </section>

    <section class="section"><h2>Capital check <span class="muted small">today</span></h2>
      <div class="card">
        <p class="muted small" style="margin-bottom:6px">What the business has now:</p>
        ${rowHtml(cc.cashCounted ? `Cash <span class="muted small">(count ${fmtDate(cc.cashCount.date)} + money in and out since)</span>` : 'Cash <span class="muted small">(not counted yet)</span>', peso(cc.cash))}
        ${rowHtml('Stock value', peso(cc.stock))}
        ${rowHtml('Unpaid that counts <span class="muted small">(100% up to 30 days, 50% for 31–60, none after 60)</span>', peso(cc.collectible))}
        <div class="row total"><span>Total the business has</span><span class="amount">${peso(cc.total)}</span></div>
        <div class="compare">
          <p class="muted small">Compared with (not added):</p>
          ${rowHtml('<strong>Capital given by Coach</strong>', peso(cc.capital))}
        </div>
        ${cc.capital === 0 ? `<p class="muted" style="margin-top:8px">Coach has not recorded the capital yet (Quest → Coach).</p>`
          : cc.ok ? `<p class="result ok">Capital is complete ✓</p>` : `<p class="result bad">Capital is short by ${peso(-cc.gap)}</p>`}
      </div>
    </section>

    <section class="section"><h2>Top customers</h2>
      ${s.topCustomers.length ? `<div class="card">${s.topCustomers.map((t, i) => rowHtml(`${i + 1}. ${esc((customerOf(t.customerId) || { name: 'Unknown' }).name)} <span class="muted small">(${t.orders})</span>`, peso(t.sales))).join('')}</div>` : `<p class="muted">No sales in this period.</p>`}
    </section>
    <section class="section"><h2>Top products</h2>
      ${s.topProducts.length ? `<div class="card">${s.topProducts.map((t) => { const p = productOf(t.productId); return rowHtml(`${esc(p ? p.name : '')} <span class="muted small">${C.formatBase(t.qtyBase, p ? p.baseUnit : '')}</span>`, peso(t.sales)); }).join('')}</div>` : `<p class="muted">No sales in this period.</p>`}
    </section>

    <section class="section">
      <div class="section-head"><h2>Expenses, taken out, cash counts</h2><span class="count">${entries.length}</span></div>
      ${entries.length ? entries.map(({ kind, r }) => entryCard(kind, r)).join('') : `<p class="muted">Nothing in this period.</p>`}
    </section>
    ${footer()}`;

  document.querySelectorAll('[data-period]').forEach((b) => {
    b.onclick = () => {
      S.period.mode = b.dataset.period;
      if (S.period.mode === 'custom' && !S.period.from) { const w = weekRange(); S.period.from = w.from; S.period.to = today(); }
      renderIncome();
    };
  });
  const pf = document.getElementById('pd-from'); if (pf) pf.onchange = () => { S.period.from = pf.value || today(); renderIncome(); };
  const pt = document.getElementById('pd-to'); if (pt) pt.onchange = () => { S.period.to = pt.value || today(); renderIncome(); };
}

function entryCard(kind, r) {
  const cancelled = r.status === 'cancelled';
  let title, amount;
  if (kind === 'expenses') { title = `Expense · ${esc(r.category)}`; amount = peso(r.amount); }
  else if (kind === 'withdrawals') {
    const p = r.type === 'goods' ? productOf(r.productId) : null;
    title = r.type === 'goods' ? `Taken out · ${esc(p ? p.name : '')} ${C.formatBase(r.qtyBase, p ? p.baseUnit : '')}` : 'Taken out · cash';
    amount = peso(r.amount);
  } else { title = 'Cash count'; amount = `${peso(r.countedCash)}`; }
  return `<article class="card compact tap ${cancelled ? 'cancelled' : ''}" data-act="open-entry" data-kind="${kind}" data-id="${r.id}">
    <div class="row"><h3 class="ell">${title}</h3><span class="amount ${cancelled ? 'strike' : ''}">${amount}</span></div>
    <div class="line2"><span class="left"><span class="ell">${fmtDate(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</span></span>
      ${cancelled ? `<span class="badge b-grey">Cancelled</span>` : kind === 'cashCounts' ? diffBadge(r.difference, peso) : ''}</div>
  </article>`;
}

// ---------- Expense ----------

function openExpenseForm() {
  const f = { category: null, amountText: '', date: today(), note: '', error: '' };
  openSheet({
    title: 'Add Expense',
    render: (sh) => {
      sh.set(`
        <div class="field"><span class="label">What for?</span>
          <div class="chips row2">${EXPENSE_CATEGORIES.map((c) => chipBtn('cat', c, c, f.category === c)).join('')}</div></div>
        <label class="field"><span class="label">Amount (₱)</span>
          <input class="input big" id="x-amt" inputmode="decimal" autocomplete="off" value="${esc(f.amountText)}" placeholder="0.00"></label>
        <label class="field"><span class="label">Date</span>
          <input class="input" type="date" id="x-date" value="${f.date}" max="${today()}"></label>
        <label class="field"><span class="label">Note ${f.category === 'Other' ? '(required)' : '(optional)'}</span>
          <input class="input" id="x-note" autocomplete="off" value="${esc(f.note)}"></label>
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
      `, `<button type="button" class="btn btn-primary btn-big" id="x-save">Save Expense</button>`);
      sh.qa('[data-cat]').forEach((b) => { b.onclick = () => { f.category = b.dataset.cat; f.error = ''; sh.refresh(); }; });
      sh.q('#x-amt').oninput = (e) => { f.amountText = e.target.value; };
      sh.q('#x-date').onchange = (e) => { f.date = e.target.value || today(); };
      sh.q('#x-note').oninput = (e) => { f.note = e.target.value; };
      sh.q('#x-save').onclick = async () => {
        const amt = C.parsePeso(f.amountText);
        if (!f.category) f.error = 'Choose what the expense was for.';
        else if (!amt) f.error = 'Type the amount.';
        else if (f.category === 'Other' && !f.note.trim()) f.error = 'Type what it was for in the note.';
        else f.error = '';
        if (f.error) { sh.refresh(); return; }
        const stamp = DB.nowStamp();
        const value = { id: DB.newId('e'), date: f.date, category: f.category, amount: amt, note: f.note.trim(), status: 'active', createdAt: stamp, updatedAt: stamp };
        const ok = await save([{ store: 'expenses', value }],
          { action: 'create', entity: 'expense', id: value.id, summary: { text: `${f.category} ${peso(amt)}`, after: value } });
        if (!ok) return;
        await closeSheet();
        toast('Expense saved');
      };
    },
  });
}

// ---------- Taken out (Kinuha) ----------

function openTakenForm() {
  const act = activeProducts();
  const f = { type: null, amountText: '', productId: act.length === 1 ? act[0].id : null, qtyText: '', date: today(), note: '', error: '' };
  openSheet({ title: 'Taken out', render: (sh) => renderTakenForm(sh, f) });
}

function renderTakenForm(sh, f) {
  const p = f.type === 'goods' ? productOf(f.productId) : null;
  sh.set(`
    <p class="info">Kinuha: cash or goods taken from the business for yourself or the house. Writing it down keeps the numbers true.</p>
    <div class="field"><span class="label">What was taken?</span>
      <div class="chips row2">${chipBtn('ttype', 'cash', TAKEN_TYPES.cash, f.type === 'cash')}${chipBtn('ttype', 'goods', TAKEN_TYPES.goods, f.type === 'goods')}</div></div>
    ${f.type === 'cash' ? `
      <label class="field"><span class="label">Amount (₱)</span>
        <input class="input big" id="t-amt" inputmode="decimal" autocomplete="off" value="${esc(f.amountText)}" placeholder="0.00"></label>` : ''}
    ${f.type === 'goods' ? `
      <div class="field"><span class="label">Product</span>
        <div class="chips">${activeProducts().map((x) => chipBtn('prod', x.id, x.name, x.id === f.productId)).join('')}</div></div>
      ${p ? `<label class="field"><span class="label">How much? (${p.baseUnit})</span>
        <input class="input big" id="t-qty" inputmode="decimal" autocomplete="off" value="${esc(f.qtyText)}" placeholder="${p.baseUnit === 'kg' ? 'e.g. 2' : 'e.g. 0.35'}">
        <span class="hint" id="t-live"></span></label>` : ''}` : ''}
    ${f.type ? `
      <label class="field"><span class="label">Date</span>
        <input class="input" type="date" id="t-date" value="${f.date}" max="${today()}"></label>
      <label class="field"><span class="label">Note (optional)</span>
        <input class="input" id="t-note" autocomplete="off" value="${esc(f.note)}"></label>` : ''}
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, f.type ? `<button type="button" class="btn btn-primary btn-big" id="t-save">Save</button>` : '');

  sh.qa('[data-ttype]').forEach((b) => { b.onclick = () => { f.type = b.dataset.ttype; f.error = ''; sh.refresh(); }; });
  sh.qa('[data-prod]').forEach((b) => { b.onclick = () => { f.productId = b.dataset.prod; sh.refresh(); }; });
  if (!f.type) return;
  const amt = sh.q('#t-amt'); if (amt) amt.oninput = (e) => { f.amountText = e.target.value; };
  const qty = sh.q('#t-qty');
  const live = () => {
    const box = sh.q('#t-live');
    const q = C.parseQtyMilli(f.qtyText);
    const avg = p && avgNow()[p.id];
    box.textContent = q && avg ? `Worth ${peso(C.lineCost(q, avg.avg))} at the average cost of ${peso(avg.avg)} per ${p.baseUnit}.` : '';
  };
  if (qty) { qty.oninput = (e) => { f.qtyText = e.target.value; live(); }; live(); }
  sh.q('#t-date').onchange = (e) => { f.date = e.target.value || today(); };
  sh.q('#t-note').oninput = (e) => { f.note = e.target.value; };
  sh.q('#t-save').onclick = async () => {
    const stamp = DB.nowStamp();
    let value;
    if (f.type === 'cash') {
      const a = C.parsePeso(f.amountText);
      if (!a) { f.error = 'Type the amount taken.'; sh.refresh(); return; }
      value = { id: DB.newId('w'), date: f.date, type: 'cash', amount: a, note: f.note.trim(), status: 'active', createdAt: stamp, updatedAt: stamp };
    } else {
      const q = C.parseQtyMilli(f.qtyText);
      if (!p) { f.error = 'Choose the product.'; sh.refresh(); return; }
      if (!q) { f.error = `Type how much was taken, in ${p.baseUnit}.`; sh.refresh(); return; }
      const avg = avgNow()[p.id];
      const cpb = avg ? avg.avg : 0;
      value = { id: DB.newId('w'), date: f.date, type: 'goods', productId: p.id, qtyBase: q, costPerBase: cpb, amount: C.lineCost(q, cpb),
        note: f.note.trim(), status: 'active', createdAt: stamp, updatedAt: stamp };
    }
    const text = value.type === 'cash' ? `Cash ${peso(value.amount)}` : `${p.name} ${C.formatBase(value.qtyBase, p.baseUnit)} (${peso(value.amount)})`;
    const ok = await save([{ store: 'withdrawals', value }], { action: 'create', entity: 'withdrawal', id: value.id, summary: { text, after: value } });
    if (!ok) return;
    await closeSheet();
    toast('Saved');
  };
}

// ---------- Count cash (Sunday) ----------

function openCashCountForm() {
  const f = { cashText: '', date: today(), savedId: null, note: '', error: '' };
  openSheet({ title: 'Count Cash', render: (sh) => (f.savedId ? renderCashResult(sh, f) : renderCashCount(sh, f)) });
}

function renderCashCount(sh, f) {
  sh.set(`
    <p class="info">Count all the business money: the cash in the box plus the GCash balance. Type the total. The app shows its own number <strong>after</strong> you save.</p>
    <label class="field"><span class="label">Money counted (₱)</span>
      <input class="input big" id="cc-amt" inputmode="decimal" autocomplete="off" value="${esc(f.cashText)}" placeholder="0.00"></label>
    <label class="field"><span class="label">Date counted</span>
      <input class="input" type="date" id="cc-date" value="${f.date}" max="${today()}"></label>
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
  `, `<button type="button" class="btn btn-primary btn-big" id="cc-save">Save count</button>`);
  sh.q('#cc-amt').oninput = (e) => { f.cashText = e.target.value; };
  sh.q('#cc-date').onchange = (e) => { f.date = e.target.value || today(); };
  sh.q('#cc-save').onclick = async () => {
    const counted = C.parsePeso(f.cashText);
    if (counted == null) { f.error = 'Type the money you counted.'; sh.refresh(); return; }
    const computed = C.computedCash(allData(), f.date);
    const stamp = DB.nowStamp();
    const value = { id: DB.newId('cc'), date: f.date, countedCash: counted, computedCash: computed, difference: counted - computed,
      note: '', status: 'active', createdAt: stamp, updatedAt: stamp };
    const ok = await save([{ store: 'cashCounts', value }],
      { action: 'create', entity: 'cashCount', id: value.id, summary: { text: `Counted ${peso(counted)}, app expected ${peso(computed)}`, after: value } });
    if (!ok) return;
    f.savedId = value.id;
    f.error = '';
    sh.refresh();
  };
}

function renderCashResult(sh, f) {
  const r = byId(S.cashCounts, f.savedId);
  sh.set(`
    <div class="card">
      ${rowHtml('You counted', peso(r.countedCash))}
      ${rowHtml('The app expected', peso(r.computedCash))}
      <div class="row"><strong>Difference</strong>${diffBadge(r.difference, peso)}</div>
    </div>
    <p class="muted small" style="margin-top:8px">The app expects: capital from Coach + all payments received − stock bought − expenses − cash taken out.</p>
    ${r.difference === 0 ? `<p class="info">Exact match. Very good!</p>` : `
      <label class="field"><span class="label">What happened? (optional)</span>
        <input class="input" id="cc-note" autocomplete="off" value="${esc(f.note)}" placeholder="e.g. gave too much change">
        <span class="hint">If you know, write it. If something was not recorded, record it now (payment, expense or Taken out).</span></label>`}
  `, `<button type="button" class="btn btn-primary btn-big" id="cc-done">Done</button>`);
  const n = sh.q('#cc-note'); if (n) n.oninput = (e) => { f.note = e.target.value; };
  sh.q('#cc-done').onclick = async () => {
    if (f.note.trim()) {
      const after = { ...clone(r), note: f.note.trim(), updatedAt: DB.nowStamp() };
      const ok = await save([{ store: 'cashCounts', value: after }],
        { action: 'edit', entity: 'cashCount', id: r.id, summary: { text: `Note: ${after.note}`, before: { note: r.note }, after: { note: after.note } } });
      if (!ok) return;
    }
    await closeSheet();
    toast('Cash count saved');
  };
}

// ---------- One expense / taken out / count: details and cancel ----------

const ENTRY_TITLES = { expenses: 'Expense', withdrawals: 'Taken out', stockCounts: 'Stock count', cashCounts: 'Cash count' };
const ENTRY_ENTITY = { expenses: 'expense', withdrawals: 'withdrawal', stockCounts: 'stockCount', cashCounts: 'cashCount' };

function openEntryDetail(kind, id) {
  openSheet({ title: ENTRY_TITLES[kind], render: (sh) => renderEntryDetail(sh, kind, id) });
}

function renderEntryDetail(sh, kind, id) {
  const r = byId(S[kind], id);
  if (!r) { sh.set('<p>Not found.</p>'); return; }
  const cancelled = r.status === 'cancelled';
  let body = '';
  let extra = '';
  if (kind === 'expenses') {
    body = `<h2>${esc(r.category)}</h2>${rowHtml('Amount', peso(r.amount))}${rowHtml('Date', fmtDate(r.date))}`;
  } else if (kind === 'withdrawals') {
    const p = r.type === 'goods' ? productOf(r.productId) : null;
    body = `<h2>${TAKEN_TYPES[r.type]}</h2>
      ${p ? rowHtml(esc(p.name), C.formatBase(r.qtyBase, p.baseUnit)) : ''}
      ${rowHtml(r.type === 'goods' ? 'Worth (average cost)' : 'Amount', peso(r.amount))}${rowHtml('Date', fmtDate(r.date))}`;
  } else if (kind === 'stockCounts') {
    const p = productOf(r.productId);
    body = `<h2>${esc(p ? p.name : '')} · ${fmtDate(r.date)}</h2>${stockCountFacts(r)}${r.reason ? rowHtml('Reason', esc(r.reason)) : ''}`;
    if (!cancelled && r.difference !== 0 && !r.reason) {
      extra = `<div class="field"><span class="label">Pick the likely reason</span>
        <div class="chips stack">${COUNT_REASONS.map((x) => chipBtn('reason', x, x, false)).join('')}</div></div>`;
    }
  } else {
    body = `<h2>${fmtDate(r.date)}</h2>${rowHtml('Counted', peso(r.countedCash))}${rowHtml('The app expected', peso(r.computedCash))}
      <div class="row"><strong>Difference</strong>${diffBadge(r.difference, peso)}</div>`;
  }
  sh.set(`
    <div class="card">${body}${r.note ? `<p class="muted" style="margin-top:6px">${esc(r.note)}</p>` : ''}</div>
    ${extra}
    ${cancelled ? `<p class="warn">Cancelled on ${fmtDate(r.cancelledDate)}. Reason: ${esc(r.cancelReason)}</p>` : `
      <button type="button" class="btn btn-danger btn-big" id="en-cancel" style="margin-top:16px">Cancel this entry</button>
      <p class="muted small" style="margin-top:6px">Use this only if it was entered by mistake. The record stays, marked Cancelled. Then enter it again correctly.</p>`}`);
  sh.qa('[data-reason]').forEach((b) => { b.onclick = async () => { if (await setCountReason(r, b.dataset.reason)) { toast('Reason saved'); sh.refresh(); } }; });
  const cb = sh.q('#en-cancel');
  if (cb) cb.onclick = async () => {
    const reason = await ask(`Cancel this ${ENTRY_TITLES[kind].toLowerCase()}?`, { yes: 'Cancel it', danger: true, input: reasonInput() });
    if (!reason) return;
    const stamp = DB.nowStamp();
    const after = { ...clone(r), status: 'cancelled', cancelReason: reason, cancelledAt: stamp, cancelledDate: today(), updatedAt: stamp };
    const ok = await save([{ store: kind, value: after }],
      { action: 'cancel', entity: ENTRY_ENTITY[kind], id: r.id, summary: { text: `${ENTRY_TITLES[kind]} cancelled: ${reason}`, before: r, after } }, ['cancels']);
    if (ok) { toast('Cancelled'); sh.refresh(); }
  };
}

// ===================================================================
// REPORT picture for Coach
// ===================================================================

function demoCount() {
  return B.RECORD_STORES.reduce((n, s) => n + S[s].filter((r) => r.demo).length, 0) + capitalList().filter((c) => c.demo).length;
}

function reportModel(from, to, reportNo) {
  const t = today();
  const d = allData();
  const s = C.periodSummary(d, from, to);
  const u = C.unpaidByAge(S.orders, t);
  const cc = C.capitalCheck(d, t);
  const last = C.latestCashCount(S.cashCounts, t);
  const inv = invNow();
  const val = C.stockValue(S.products, S.stockIns, S.orders, S);
  const k = counters();
  const gs = gameNow();
  const { GREEN, RED, ORANGE, INK, MUTED } = COLORS;
  const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date());
  const pName = (id) => { const p = productOf(id); return p ? p.name : 'Product'; };
  const pUnit = (id) => { const p = productOf(id); return p ? p.baseUnit : ''; };
  const none = (text) => [{ label: text, value: '', labelColor: MUTED }];

  const sections = [
    { title: 'Income', rows: [
      { label: 'Sales', value: peso(s.sales) },
      { label: '− Cost of goods sold', value: peso(s.cogs) },
      { label: '− Lost / damaged', value: peso(s.losses) },
      { label: '− Expenses', value: peso(s.expenses) },
      { label: 'Income', value: peso(s.income), big: true, color: s.income < 0 ? RED : GREEN },
      { label: 'Margin', value: C.formatPct(s.marginTenths) },
      { label: 'Orders', value: String(s.orderCount) },
    ] },
    { title: 'Capital check (today)', rows: [
      { label: cc.cashCounted ? `Cash (count ${fmtDate(cc.cashCount.date)} + since)` : 'Cash (not counted yet)', value: peso(cc.cash) },
      { label: 'Stock value', value: peso(cc.stock) },
      { label: 'Unpaid that counts', value: peso(cc.collectible) },
      { label: 'Total the business has', value: peso(cc.total), bold: true },
      { label: 'Capital given by Coach (compared)', value: peso(cc.capital), bold: true, gap: true },
      cc.ok ? { label: 'Capital complete ✓', value: '', bold: true, labelColor: GREEN }
        : { label: 'Capital short by', value: peso(-cc.gap), bold: true, color: RED, labelColor: RED },
    ] },
    { title: 'Money', rows: [
      { label: 'Collected (payments)', value: peso(s.collected) },
      { label: 'Taken out: cash', value: peso(s.takenCash) },
      { label: 'Taken out: goods', value: peso(s.takenGoods) },
    ] },
    { title: 'Unpaid by customers (today)', rows: [
      { label: `0–30 days (${u.n0})`, value: peso(u.b0) },
      { label: `31–60 days (${u.n31})`, value: peso(u.b31), color: u.b31 ? ORANGE : INK },
      { label: `Over 60 days (${u.n61})`, value: peso(u.b61), color: u.b61 ? RED : INK },
      { label: 'Total unpaid', value: peso(u.total), bold: true, note: u.count ? `${u.count} unpaid orders · oldest ${u.oldestDays} days` : null },
    ] },
    { title: 'Last cash count', rows: last ? [
      { label: 'Date', value: fmtDate(last.date) },
      { label: 'Counted', value: peso(last.countedCash) },
      { label: 'App expected', value: peso(last.computedCash) },
      { label: last.difference < 0 ? 'Short' : last.difference > 0 ? 'Over' : 'Difference', value: last.difference ? peso(Math.abs(last.difference)) : 'Exact ✓',
        bold: true, color: last.difference < 0 ? RED : last.difference > 0 ? ORANGE : GREEN, note: last.note || null },
    ] : none('No cash count yet') },
    { title: 'Stock left', rows: activeProducts().map((p) => {
      const left = inv[p.id] || 0;
      const low = left < 0 || (p.lowStockAt != null && left <= p.lowStockAt);
      const col = left < 0 ? RED : low ? ORANGE : INK;
      return { label: p.name + (left < 0 ? ' · BELOW ZERO' : low ? ' · LOW' : ''), value: `${C.formatBase(left, p.baseUnit)} · ${peso(val.byProduct[p.id] || 0)}`, color: col, labelColor: col };
    }) },
    { title: 'Top customers', rows: s.topCustomers.length
      ? s.topCustomers.map((c, i) => ({ label: `${i + 1}. ${(customerOf(c.customerId) || { name: 'Unknown' }).name} (${c.orders})`, value: peso(c.sales) }))
      : none('No sales in this period') },
    { title: 'Top products', rows: s.topProducts.length
      ? s.topProducts.map((p) => ({ label: `${pName(p.productId)} ${C.formatBase(p.qtyBase, pUnit(p.productId))}`, value: peso(p.sales) }))
      : none('No sales in this period') },
    questSection(gs),
    { title: 'Records (lifetime, never go down)', rows: [
      { label: 'Orders made', value: String(k.ordersCreated || 0) },
      { label: 'Edits', value: String(k.edits || 0) },
      { label: 'Cancels', value: String(k.cancels || 0) },
      { label: 'Imports', value: String(k.imports || 0) },
    ] },
  ];
  return {
    businessName: businessName() + (demoCount() ? ' (DEMO DATA)' : ''),
    periodText: C.formatRange(from, to),
    madeText: `${fmtDate(t)}, ${time}`,
    reportNo,
    phoneId: (S.settings.installId || '').slice(-6),
    appVersion: APP_VERSION,
    alert: gs.stop.on ? { ok: false, text: 'STOP restocking: talk to Coach' }
      : cc.capital ? { ok: cc.ok, text: cc.ok ? `Capital complete ✓   Income ${peso(s.income)}` : `Capital short by ${peso(-cc.gap)}` } : null,
    sections: gs.stop.on ? [{ title: 'Stop rule', rows: gs.stop.reasons.map((x) => ({ label: x, value: '', labelColor: RED })) }, ...sections] : sections,
  };
}

// Quest summary for the report: level, stars, streak, the five missions ✓/✗, readiness.
function questSection(gs) {
  const { GREEN, RED, MUTED } = COLORS;
  const cur = gs.current;
  const rows = [
    { label: 'Level', value: `${gs.level} · ${gs.levelInfo.name}`, bold: true },
    { label: `Stars this week (${C.formatRange(cur.ws, cur.we)})`, value: `${stars(cur.done)} ${cur.done}/5` },
    { label: 'Streak', value: `${gs.streak} ${gs.streak === 1 ? 'week' : 'weeks'}` },
    ...cur.missions.map((m) => ({ label: MISSION_NAMES[m.id], value: m.off ? '–' : m.done ? '✓' : '✗', color: m.off ? MUTED : m.done ? GREEN : RED, bold: true })),
    { label: 'This week', value: cur.phase !== 'normal' ? 'trial' : cur.pahinga ? 'rest week' : cur.paused ? 'paused' : cur.counts ? 'counts ✓' : `${cur.done} of 5 (4 needed)`,
      color: cur.counts ? GREEN : undefined },
  ];
  if (gs.inTrial) rows.push({ label: `Trial week ${gs.trialWeek} of ${gameCfg().targets.trialWeeks}`, value: '' });
  else if (!gs.started) rows.push({ label: 'Game not started (no go-live date)', value: '', labelColor: MUTED });
  if (gs.next && !gs.readiness.coachDecides && gs.started && !gs.inTrial) {
    rows.push(gs.readiness.ready
      ? { label: `Ready for Level ${gs.next.n} ✓`, value: '', bold: true, labelColor: GREEN }
      : { label: `Level ${gs.next.n} goals`, value: `${gs.readiness.items.filter((i) => i.ok).length} of ${gs.readiness.items.length}` });
  }
  if (gs.review.due) rows.push({ label: 'Pilot review is due', value: '', bold: true });
  return { title: 'Negosyo Quest', rows };
}

async function openReport() {
  const { from, to } = S.tab === 'income' ? periodRange() : weekRange();
  try {
    await DB.commit({ counters: ['reports'], log: { action: 'create', entity: 'report', id: 'report', summary: { text: `Report ${C.formatRange(from, to)}` } } }, S.settings);
  } catch (err) { console.warn(err); }
  const no = counters().reports || 1;
  const state = { url: null, file: null };
  const sh = openSheet({
    title: 'Report for Coach',
    render: (s2) => {
      s2.set(state.url
        ? `<img class="report-img" src="${state.url}" alt="Report picture for Coach">
           <p class="muted small" style="margin-top:8px">Tap <strong>Send to Coach</strong>, then choose Messenger.</p>`
        : `<p class="loading">Making the picture…</p>`,
      state.file ? `<button type="button" class="btn btn-gold btn-big" id="r-send">Send to Coach</button>` : '');
      const b = s2.q('#r-send');
      if (b) b.onclick = async () => {
        const r = await shareOrDownload(state.file, 'Report for Coach');
        if (r !== 'cancelled') await rememberDate('reportDates');
        if (r === 'downloaded') toast('Picture saved in Downloads. Send it to Coach on Messenger.');
      };
    },
  });
  try {
    const cv = await drawReport(reportModel(from, to, no), './assets/images/report-header.jpg');
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    state.file = new File([blob], `bigas-report-${today()}.png`, { type: 'image/png' });
    state.url = URL.createObjectURL(blob);
    sh.refresh();
  } catch (err) {
    console.warn(err);
    toast('Could not make the report picture.', true);
  }
}

// ===================================================================
// BACKUP and IMPORT
// ===================================================================

async function doBackup() {
  try {
    const changeLog = await DB.getChangeLog();
    const records = {};
    for (const s of B.RECORD_STORES) records[s] = S[s];
    const text = B.makeBackup({ records, settings: S.settings, changeLog, appVersion: APP_VERSION, exportedAt: DB.nowStamp() });
    const file = new File([text], `bigas-backup-${today()}.txt`, { type: 'text/plain' });
    const r = await shareOrDownload(file, 'Bigas at Mantika backup');
    if (r === 'cancelled') return;
    await DB.putSetting('lastBackupDate', today());
    S.settings.lastBackupDate = today();
    await rememberDate('backupDates');
    checkCelebrate();
    renderMain();
    toast(r === 'shared' ? 'Backup sent' : 'Backup saved in Downloads. Send it to Coach.');
  } catch (err) {
    console.warn(err);
    toast('Could not make the backup file.', true);
  }
}

// Dates when a report or a backup was sent (one per day is enough).
async function rememberDate(key) {
  const list = S.settings[key] || [];
  if (list.includes(today())) return;
  S.settings[key] = [...list, today()];
  try { await DB.putSetting(key, S.settings[key]); } catch (err) { console.warn(err); }
}

async function importBackupFile(file) {
  let text;
  try { text = await file.text(); } catch { toast('Could not read the file.', true); return; }
  const r = B.parseBackup(text);
  if (!r.ok) { await ask(r.error, { yes: 'OK', no: null }); return; }
  const sm = r.summary;
  const lines = Object.entries(sm.counts).map(([k, v]) => `${B.LABELS[k]}: ${v}`).join('\n');
  const made = sm.exportedAt ? C.formatDate(C.todayManila(new Date(sm.exportedAt))) : 'unknown date';
  const range = sm.from ? `${fmtDate(sm.from)} to ${fmtDate(sm.to)}` : 'no dated records';
  const go = await ask(`Import this backup?\n\nMade ${made} (app ${sm.appVersion || '?'})\nRecords from ${range}\n${lines}\n\nThis REPLACES every record on this phone.`,
    { yes: 'Import', danger: true });
  if (!go) return;
  const settings = B.mergeSettings(S.settings, r.backup.settings);
  settings.counters.imports = (settings.counters.imports || 0) + 1;
  settings.schemaVersion = DB.SCHEMA_VERSION;
  try {
    await DB.replaceAll({ records: r.backup.data, settings, changeLog: r.backup.changeLog },
      { action: 'import', entity: 'backup', id: sm.exportedAt || '', summary: { text: `Imported backup made ${made}`, counts: sm.counts } });
  } catch (err) {
    console.warn(err);
    toast(DB.isStorageFull(err) ? 'Phone storage is full. Free up some space, then try again.' : 'Import failed. Nothing was changed.', true);
    return;
  }
  const fresh = await DB.loadAll();
  for (const s of B.RECORD_STORES) S[s] = fresh[s];
  S.settings = fresh.settings;
  await checkCelebrate({ silent: true });
  await closeAllSheets();
  setTab('orders');
  toast('Backup imported');
}

// ===================================================================
// COACH (on the Quest tab)
// ===================================================================

async function openCoach() {
  if (!(await ask('This is for Coach only. Continue?', { yes: 'Continue' }))) return;
  const f = { name: businessName(), deal: S.settings.dealNote || '', goLive: S.settings.goLiveDate || '', error: '' };
  openSheet({ title: 'Coach', render: (sh) => renderCoach(sh, f) });
}

function renderCoach(sh, f) {
  const caps = capitalList();
  const k = counters();
  const demo = demoCount();
  const persisted = { yes: 'Yes', no: 'No (Chrome may clear it if the phone is full)', 'not supported': 'Not supported' }[S.settings.storagePersisted] || 'Unknown';
  sh.set(`
    <h3>Business</h3>
    <label class="field"><span class="label">Business name</span>
      <input class="input" id="co-name" autocomplete="off" value="${esc(f.name)}"></label>
    <label class="field"><span class="label">The deal (short note)</span>
      <textarea class="input" id="co-deal" rows="3">${esc(f.deal)}</textarea>
      <span class="hint">e.g. Capital from Coach, not a loan. No fixed weekly pay. Anything taken out is recorded as Taken out.</span></label>
    <label class="field"><span class="label">Go-live date</span>
      <input class="input" type="date" id="co-golive" value="${esc(f.goLive)}"></label>
    ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
    <button type="button" class="btn btn-primary" id="co-save" style="margin-top:12px">Save</button>

    <section class="section">
      <div class="section-head"><h3>Capital given</h3><span class="count">${peso(sum(caps.filter(active), (c) => c.amount))}</span></div>
      ${caps.length ? caps.map((c) => `<button type="button" class="card compact tap row ${c.status === 'cancelled' ? 'cancelled' : ''}" style="width:100%;text-align:left" data-cap="${c.id}">
          <span class="ell">${fmtDate(c.date)}${c.note ? ' · ' + esc(c.note) : ''}</span><span class="amount ${c.status === 'cancelled' ? 'strike' : ''}">${peso(c.amount)}</span></button>`).join('')
        : `<p class="muted">No capital recorded yet. The capital check needs it.</p>`}
      <button type="button" class="btn btn-big" id="co-addcap" style="margin-top:10px">+ Record capital given</button>
    </section>

    ${coachGameHtml()}

    <section class="section"><h3>Import backup</h3>
      <p class="muted small" style="margin:4px 0 8px">Replaces all records on this phone with the ones in a backup file (.txt or .json).</p>
      <button type="button" class="btn btn-big" id="co-import">Import backup</button>
      <input type="file" id="co-file" accept=".txt,.json,text/plain,application/json" hidden>
    </section>

    <section class="section"><h3>Demo data</h3>
      <p style="margin:4px 0 8px">${demo ? `Demo data is <strong>ON</strong> (${demo} records).` : 'Demo data is off.'}</p>
      ${demo ? `<button type="button" class="btn btn-danger btn-big" id="co-demo-off">Remove demo</button>`
        : `<button type="button" class="btn btn-big" id="co-demo-on">Load demo data</button>`}
    </section>

    <section class="section"><h3>Phone storage and records</h3>
      <div class="card">
        ${rowHtml('Kept safe by Chrome', persisted)}
        ${rowHtml('Orders made', k.ordersCreated || 0)}
        ${rowHtml('Edits', k.edits || 0)}
        ${rowHtml('Cancels', k.cancels || 0)}
        ${rowHtml('Imports', k.imports || 0)}
        ${rowHtml('Reports made', k.reports || 0)}
        ${rowHtml('Last backup', S.settings.lastBackupDate ? fmtDate(S.settings.lastBackupDate) : 'never')}
        ${rowHtml('Phone ID', esc((S.settings.installId || '').slice(-6)))}
      </div>
    </section>`);

  sh.q('#co-name').oninput = (e) => { f.name = e.target.value; };
  sh.q('#co-deal').oninput = (e) => { f.deal = e.target.value; };
  sh.q('#co-golive').onchange = (e) => { f.goLive = e.target.value; };
  sh.q('#co-save').onclick = async () => {
    const name = f.name.trim();
    if (!name) { f.error = 'Type the business name.'; sh.refresh(); return; }
    f.error = '';
    const before = { businessName: S.settings.businessName, dealNote: S.settings.dealNote, goLiveDate: S.settings.goLiveDate };
    const after = { businessName: name, dealNote: f.deal.trim(), goLiveDate: f.goLive || '' };
    if (await saveSettings(after, { action: 'edit', entity: 'settings', id: 'business', summary: { text: 'Business details', before, after } })) { toast('Saved'); sh.refresh(); }
  };
  sh.q('#co-addcap').onclick = () => openCapitalForm();
  sh.qa('[data-cap]').forEach((b) => { b.onclick = () => cancelCapital(b.dataset.cap); });
  const file = sh.q('#co-file');
  sh.q('#co-import').onclick = () => { file.value = ''; file.click(); };
  file.onchange = () => { if (file.files && file.files[0]) importBackupFile(file.files[0]); };
  wireCoachGame(sh);
  const on = sh.q('#co-demo-on'); if (on) on.onclick = () => loadDemo(sh);
  const off = sh.q('#co-demo-off'); if (off) off.onclick = () => removeDemo(sh);
}

function openCapitalForm() {
  const f = { amountText: '', date: today(), note: '', error: '' };
  openSheet({
    title: 'Record capital given',
    render: (sh) => {
      sh.set(`
        <label class="field"><span class="label">Amount (₱)</span>
          <input class="input big" id="cp-amt" inputmode="decimal" autocomplete="off" value="${esc(f.amountText)}" placeholder="0.00"></label>
        <label class="field"><span class="label">Date given</span>
          <input class="input" type="date" id="cp-date" value="${f.date}" max="${today()}"></label>
        <label class="field"><span class="label">Note (optional)</span>
          <input class="input" id="cp-note" autocomplete="off" value="${esc(f.note)}" placeholder="e.g. Pilot capital"></label>
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
      `, `<button type="button" class="btn btn-primary btn-big" id="cp-save">Save capital</button>`);
      sh.q('#cp-amt').oninput = (e) => { f.amountText = e.target.value; };
      sh.q('#cp-date').onchange = (e) => { f.date = e.target.value || today(); };
      sh.q('#cp-note').oninput = (e) => { f.note = e.target.value; };
      sh.q('#cp-save').onclick = async () => {
        const amt = C.parsePeso(f.amountText);
        if (!amt) { f.error = 'Type the amount given.'; sh.refresh(); return; }
        const stamp = DB.nowStamp();
        const entry = { id: DB.newId('cap'), date: f.date, amount: amt, note: f.note.trim(), status: 'active', createdAt: stamp, updatedAt: stamp };
        const ok = await saveSettings({ capitalReleased: [...capitalList(), entry] },
          { action: 'create', entity: 'capital', id: entry.id, summary: { text: `Capital ${peso(amt)}`, after: entry } });
        if (!ok) return;
        await closeSheet();
        toast('Capital recorded');
      };
    },
  });
}

async function cancelCapital(id) {
  const c = capitalList().find((x) => x.id === id);
  if (!c || c.status === 'cancelled') return;
  const reason = await ask(`Cancel the capital entry of ${peso(c.amount)} on ${fmtDate(c.date)}?`, { yes: 'Cancel it', danger: true, input: reasonInput() });
  if (!reason) return;
  const stamp = DB.nowStamp();
  const after = { ...c, status: 'cancelled', cancelReason: reason, cancelledAt: stamp, cancelledDate: today(), updatedAt: stamp };
  const ok = await saveSettings({ capitalReleased: capitalList().map((x) => (x.id === id ? after : x)) },
    { action: 'cancel', entity: 'capital', id, summary: { text: `Capital ${peso(c.amount)} cancelled: ${reason}`, before: c, after } }, ['cancels']);
  if (ok) { toast('Cancelled'); const t = topSheet(); if (t) t.refresh(); }
}
// ===================================================================
// DEMO data on and off
// ===================================================================

async function loadDemo(sh) {
  const real = S.orders.length + S.stockIns.length + S.customers.length;
  const msg = real
    ? 'Load demo data? This phone already has real records. The demo records will mix with them until you tap "Remove demo".'
    : 'Load demo data? About 13 weeks of sample customers, stock, orders, expenses and counts, with the game already running. "Remove demo" takes them out again.';
  if (!(await ask(msg, { yes: 'Load demo' }))) return;
  const d = makeDemo({ today: today(), products: S.products, newId: DB.newId });
  if (!d) { toast('Demo needs one product in kg and one in L.', true); return; }
  const puts = [];
  for (const s of B.RECORD_STORES) for (const value of d[s] || []) puts.push({ store: s, value });
  const capital = [...capitalList(), ...d.capital];
  const demo = { goLiveDate: d.goLiveDate, backupDates: d.backupDates, reportDates: d.reportDates };
  try {
    await DB.applyDemo({ puts, settings: { capitalReleased: capital, demo } },
      { action: 'create', entity: 'demo', id: 'demo', summary: { text: `Demo data loaded (${puts.length} records)` } });
  } catch (err) { console.warn(err); toast('Could not load the demo.', true); return; }
  for (const p of puts) S[p.store].push(p.value);
  S.settings.capitalReleased = capital;
  S.settings.demo = demo;
  await checkCelebrate({ silent: true });
  renderMain();
  sh.refresh();
  toast('Demo data loaded');
}

async function removeDemo(sh) {
  if (!(await ask('Remove all demo records? Real records stay.', { yes: 'Remove demo', danger: true }))) return;
  const deletes = [];
  for (const s of B.RECORD_STORES) for (const r of S[s]) if (r.demo) deletes.push({ store: s, id: r.id });
  const capital = capitalList().filter((c) => !c.demo);
  // Game steps taken while the demo was on (level-ups, rest weeks, pauses…) go too.
  const g = clone(S.settings.game || {});
  for (const k of ['levelHistory', 'pahinga', 'pauses', 'stopClears']) if (g[k]) g[k] = g[k].filter((x) => !x.demo);
  if (g.reviewDone && g.reviewDone.demo) g.reviewDone = null;
  try {
    await DB.applyDemo({ deletes, settings: { capitalReleased: capital, demo: null, game: g } },
      { action: 'edit', entity: 'demo', id: 'demo', summary: { text: `Demo data removed (${deletes.length} records)` } });
  } catch (err) { console.warn(err); toast('Could not remove the demo.', true); return; }
  for (const s of B.RECORD_STORES) S[s] = S[s].filter((r) => !r.demo);
  S.settings.capitalReleased = capital;
  S.settings.demo = null;
  S.settings.game = g;
  await checkCelebrate({ silent: true });
  renderMain();
  sh.refresh();
  toast('Demo data removed');
}

// ===================================================================
// NEGOSYO QUEST: shared bits
// ===================================================================

const gameCfg = () => G.gameConfig(S.settings);
const gameNow = () => G.gameState(allData(), gameCfg(), today());
const demoOn = () => demoCount() > 0;
const MISSION_NAMES = Object.fromEntries(G.MISSIONS.map((m) => [m.id, m.name]));
const stars = (n, of = 5) => '★'.repeat(n) + '☆'.repeat(Math.max(0, of - n));

// Change the game settings (levels, rest weeks, pauses…) with a change-log line.
function saveGame(change, log, extra = {}) {
  const g = clone(S.settings.game || {});
  change(g);
  return saveSettings({ game: g, ...extra }, log);
}

// Mascot with a short, kind message. Never shaming.
function mascot(image, html, tone = '') {
  return `<div class="mascot ${tone}">${img(image, 'Mascot', 'mascot-img')}<p class="speech">${html}</p></div>`;
}

// Gentle prompts on the Orders screen: low stock and old unpaid orders.
function lowStockBanner() {
  const inv = invNow();
  const out = [];
  for (const p of activeProducts()) {
    const left = inv[p.id] || 0;
    if (left < 0 || (p.lowStockAt != null && left <= p.lowStockAt)) {
      const oil = p.baseUnit === 'L';
      out.push(mascot(oil ? 'mascot-mantika-isip.jpg' : 'mascot-bigas-isip.jpg',
        `${esc(p.name)} is running low (${C.formatBase(left, p.baseUnit)}). Time to restock?`));
    }
  }
  const old = G.oldUnpaid(S.orders, today()).filter((x) => !x.noted);
  if (old.length) {
    out.push(mascot('mascot-mantika-isip.jpg',
      `${old.length === 1 ? 'One order is' : `${old.length} orders are`} unpaid for over 30 days. A friendly reminder helps: open the order and add a follow-up note.`));
  }
  return out.join('');
}

function stopBanner(gs) {
  if (!gs.stop.on) return '';
  return `<div class="stop-banner"><strong>Stop restocking for now: talk to Coach.</strong>
    <span>${gs.stop.reasons.map(esc).join('<br>')}</span></div>`;
}

// ---------- celebrations: a mission done, a new badge, ready for the next level ----------

async function checkCelebrate({ silent = false } = {}) {
  let gs;
  try { gs = gameNow(); } catch (err) { console.warn(err); return; }
  const now = {
    ws: gs.current.ws,
    missions: gs.current.missions.filter((m) => m.done).map((m) => m.id),
    badges: Object.keys(gs.badges),
    ready: gs.readiness.ready,
  };
  const seen = S.settings.gameSeen;
  const same = seen && JSON.stringify(seen) === JSON.stringify(now);
  if (!same) { S.settings.gameSeen = now; DB.putSetting('gameSeen', now).catch(() => {}); }
  if (silent || !seen || same) return;
  const newMissions = seen.ws === now.ws ? now.missions.filter((x) => !seen.missions.includes(x)) : now.missions;
  const newBadges = now.badges.filter((b) => !seen.badges.includes(b));
  if (now.ready && !seen.ready && gs.next) {
    celebrate({ image: 'mascot-bigas-cheer.jpg', title: `Ready for Level ${gs.next.n}!`, text: `${gs.next.name}. Send the report to Coach. Only Coach can confirm the level up.` });
  } else if (newBadges.length) {
    const b = G.BADGES.find((x) => x.id === newBadges[0]);
    celebrate({ image: b.img, title: `New badge: ${b.name}`, text: newBadges.length > 1 ? `And ${newBadges.length - 1} more. See them on the Quest tab.` : 'See it on the Quest tab.' });
  } else if (newMissions.length) {
    const left = gs.current.counts ? 'This week counts! ✓' : `${gs.current.done} of 5 done. ${Math.max(0, G.WEEK_COUNTS_AT - gs.current.done)} more to make this week count.`;
    celebrate({ image: Math.random() < 0.5 ? 'mascot-bigas-cheer.jpg' : 'mascot-mantika-cheer.jpg',
      title: `★ ${newMissions.map((x) => MISSION_NAMES[x]).join(', ')}`, text: `Mission done. ${left}` });
  }
}

// ---------- follow-up note on an unpaid order ----------

async function addFollowUp(orderId) {
  const o = byId(S.orders, orderId);
  const text = await ask('Follow-up note for this unpaid order. For example: "Reminded her today, she will pay on Saturday."',
    { yes: 'Save note', input: { label: 'Note', required: true, requiredMsg: 'Please type the note.' } });
  if (!text) return;
  const stamp = DB.nowStamp();
  const after = clone(o);
  const note = { id: DB.newId('f'), date: today(), text, createdAt: stamp };
  after.followUps = [...(o.followUps || []), note];
  after.updatedAt = stamp;
  const c = customerOf(o.customerId);
  const ok = await save([{ store: 'orders', value: after }],
    { action: 'create', entity: 'followUp', id: note.id, summary: { text: `${c ? c.name : ''}: ${text}`, after: note } });
  if (ok) { toast('Note saved'); const t = topSheet(); if (t) t.refresh(); }
}

// ===================================================================
// QUEST tab
// ===================================================================

function renderQuest() {
  const cfg = gameCfg();
  const gs = G.gameState(allData(), cfg, today());
  const t = cfg.targets;
  const cur = gs.current;
  const lv = gs.levelInfo;

  // The mascot says one thing: the most useful right now.
  let msg;
  const inv = invNow();
  const low = activeProducts().find((p) => (inv[p.id] || 0) < 0 || (p.lowStockAt != null && (inv[p.id] || 0) <= p.lowStockAt));
  if (gs.stop.on) msg = mascot('mascot-bigas-isip.jpg', 'Let\'s pause restocking and talk to Coach first. We\'ll sort it out together.');
  else if (gs.readiness.ready) msg = mascot('mascot-bigas-cheer.jpg', `<strong>Ready for Level ${gs.next.n}!</strong> Send the report to Coach.`, 'cheer');
  else if (cur.counts) msg = mascot('mascot-mantika-cheer.jpg', '<strong>This week counts!</strong> Great habits. Keep it up.', 'cheer');
  else if (!gs.started) msg = mascot('mascot-bigas-happy.jpg', cfg.goLive ? `The game starts on ${fmtDate(cfg.goLive)}. You can practise the missions now.` : 'The game starts on the go-live date. Coach sets it in Coach mode. You can practise the missions now.');
  else if (gs.inTrial) msg = mascot('mascot-bigas-happy.jpg', `<strong>Trial week ${gs.trialWeek} of ${t.trialWeeks}.</strong> Practise the missions. Nothing is failed in the trial.`);
  else if (low) msg = mascot(low.baseUnit === 'L' ? 'mascot-mantika-isip.jpg' : 'mascot-bigas-isip.jpg', `${esc(low.name)} is running low. Time to restock?`);
  else if (gs.oldUnpaidNoNote.length) msg = mascot('mascot-mantika-isip.jpg', 'Some customers owe for over 30 days. A friendly reminder and a follow-up note help.');
  else msg = mascot('mascot-bigas-happy.jpg', `${cur.done} of 5 missions done this week. ${G.WEEK_COUNTS_AT} make the week count. Kaya mo 'yan!`);

  const missionRow = (m) => {
    const def = G.MISSIONS.find((x) => x.id === m.id);
    return `<div class="mission ${m.done ? 'done' : ''} ${m.off ? 'off' : ''}">
      <span class="tick" aria-hidden="true">${m.done ? '✓' : m.off ? '–' : '○'}</span>
      <div><strong>${esc(def.name)}</strong> <span class="muted small">${m.done ? '· done' : m.off ? '' : '· not yet'}</span>
        <p class="muted small">${esc(m.detail)}${m.done || m.off ? '' : ` · ${esc(def.how(t))}`}</p></div>
    </div>`;
  };

  const weekStatus = (w) => w.phase === 'trial' ? 'Trial' : w.pahinga ? 'Rest week' : w.paused ? 'Paused by Coach'
    : w.counts ? 'Counts ✓' : w.finished ? 'Did not count' : 'This week';
  const recent = gs.weeks.slice(-8).reverse();

  const r = gs.readiness;
  let nextHtml = '';
  if (!gs.next) nextHtml = `<p>You are at the top level. 🎉</p>`;
  else if (r.coachDecides) nextHtml = `<p class="muted">Coach decides when you are ready for Level ${gs.next.n}.</p>`;
  else {
    const why = !gs.started ? 'Level goals start after the trial.' : gs.inTrial ? `Level goals start after the trial (week ${gs.trialWeek} of ${t.trialWeeks}).`
      : r.gatesOff ? 'Paused by Coach (calamity). Nothing is lost.' : '';
    nextHtml = `
      ${why ? `<p class="info">${why}</p>` : ''}
      ${r.items.map((i) => `<div class="goal ${i.ok ? 'done' : ''}"><span class="tick" aria-hidden="true">${i.ok ? '✓' : '○'}</span>
        <div>${esc(i.label)}<p class="muted small">${esc(i.have)} · goal ${esc(i.need)}</p></div></div>`).join('')}
      ${r.ready ? `<p class="result ok">Ready for Level ${gs.next.n}! Send the report to Coach.</p>` : ''}
      <p class="muted small" style="margin-top:8px">Level up is never automatic: Coach checks the reports and confirms it.</p>`;
  }

  main().innerHTML = `
    <div class="btn-row">
      <button type="button" class="btn btn-gold" data-act="send-report">Send Report</button>
      <button type="button" class="btn" data-act="coach">Coach</button>
    </div>
    ${stopBanner(gs)}
    ${gs.review.due ? `<p class="info" style="margin-top:12px"><strong>Time for the pilot review.</strong> It is ${t.reviewWeeks} weeks since go-live: look at the reports together with Coach.</p>` : ''}
    <div style="margin-top:12px">${msg}</div>

    <div class="card level-card">
      ${img(`level-${gs.level}.jpg`, `Level ${gs.level}`, 'level-img')}
      <div><p class="muted small">Level ${gs.level}</p><h2>${esc(lv.name)}</h2>
        ${lv.capital ? `<p class="muted small">Capital at this level: ${peso(lv.capital)}</p>` : ''}</div>
    </div>

    <section class="section">
      <div class="section-head"><h2>This week</h2><span class="stars" aria-label="${cur.done} of 5 stars">${stars(cur.done)}</span></div>
      <p class="muted small">${C.formatRange(cur.ws, cur.we)} · ${cur.phase === 'normal' ? `${G.WEEK_COUNTS_AT} of 5 make the week count` : 'practice'}${cur.pahinga ? ' · rest week' : ''}${cur.paused ? ' · paused by Coach' : ''}</p>
      <div class="card" style="margin-top:8px">${cur.missions.map(missionRow).join('')}</div>
    </section>

    <section class="section">
      <div class="card">
        <div class="row"><span>Streak</span><strong>${gs.streak} ${gs.streak === 1 ? 'week' : 'weeks'} in a row</strong></div>
        ${cur.pahinga ? `<p class="info">This is a rest week (Pahinga). The streak is paused, not broken.</p>`
          : gs.rest.allowed ? `<button type="button" class="btn btn-small" id="q-rest" style="margin-top:10px">Take a rest week (Pahinga)</button>
             <p class="muted small" style="margin-top:4px">Once every ${t.pahingaEvery} weeks. It pauses the streak without breaking it.</p>`
          : gs.rest.nextFrom ? `<p class="muted small" style="margin-top:6px">Next rest week possible from ${fmtDate(gs.rest.nextFrom)}.</p>` : ''}
      </div>
    </section>

    <section class="section">
      <h2>${gs.next ? `Next: Level ${gs.next.n} · ${esc(gs.next.name)}` : 'Level'}</h2>
      <div class="card" style="margin-top:8px">${nextHtml}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Badges</h2><span class="count">${Object.keys(gs.badges).length} of ${G.BADGES.length}</span></div>
      <div class="badge-grid">${G.BADGES.map((b) => {
        const got = gs.badges[b.id];
        return `<div class="badge-tile ${got ? 'got' : ''}">${img(b.img, b.name)}<strong>${esc(b.name)}</strong>
          <span class="muted small">${got ? fmtDate(got) : esc(b.how)}</span></div>`;
      }).join('')}</div>
    </section>

    ${recent.length ? `<section class="section">
      <h2>Recent weeks</h2>
      <div class="card" style="margin-top:8px">${recent.map((w) => `<div class="row week-row">
        <span>${C.formatRange(w.ws, w.we)}<br><span class="muted small">${weekStatus(w)}</span></span>
        <span class="stars small">${stars(w.done)}</span></div>`).join('')}</div>
    </section>` : ''}
    ${footer()}`;

  const rest = document.getElementById('q-rest');
  if (rest) rest.onclick = async () => {
    if (!(await ask(`Take this week (${C.formatRange(cur.ws, cur.we)}) as a rest week? The streak pauses without breaking. The next rest week is possible in ${t.pahingaEvery} weeks.`, { yes: 'Yes, rest week' }))) return;
    if (await saveGame((g) => { g.pahinga = [...(g.pahinga || []), { ws: cur.ws, createdAt: DB.nowStamp(), demo: demoOn() }]; },
      { action: 'create', entity: 'restWeek', id: cur.ws, summary: { text: `Rest week ${C.formatRange(cur.ws, cur.we)}` } })) toast('Rest week saved. Enjoy!');
  };
}

// ===================================================================
// COACH: game controls
// ===================================================================

function coachGameHtml() {
  const cfg = gameCfg();
  const gs = G.gameState(allData(), cfg, today());
  const pause = cfg.pauses.find((p) => !p.to);
  const lastLevel = cfg.levelHistory[cfg.levelHistory.length - 1];
  return `
    <section class="section"><h3>Negosyo Quest</h3>
      <div class="card" style="margin-top:8px">
        ${rowHtml('Level', `${gs.level} · ${esc(gs.levelInfo.name)}`)}
        ${lastLevel ? `<p class="muted small">Since ${fmtDate(lastLevel.date)}</p>` : ''}
        ${rowHtml('Go-live', cfg.goLive ? fmtDate(cfg.goLive) + (S.settings.goLiveDate ? '' : ' (demo)') : 'not set')}
        ${rowHtml('Streak', `${gs.streak} weeks`)}
        ${gs.next ? `<p style="margin-top:8px">${gs.readiness.ready ? `<strong class="green">Ready for Level ${gs.next.n} ✓</strong>`
          : gs.readiness.coachDecides ? `Level ${gs.next.n}: Coach decides.` : `Level ${gs.next.n}: ${gs.readiness.items.filter((i) => i.ok).length} of ${gs.readiness.items.length} goals met.`}</p>
          <button type="button" class="btn btn-primary btn-big" id="co-levelup" style="margin-top:8px">Confirm level up to Level ${gs.next.n}</button>` : ''}
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn" id="co-targets">Targets</button>
        <button type="button" class="btn" id="co-levels">Level capital</button>
      </div>
      <div class="card" style="margin-top:10px">
        <strong>Stop rule</strong>
        ${gs.stop.on ? `<p class="red" style="margin-top:4px">${gs.stop.reasons.map(esc).join('<br>')}</p>
          <button type="button" class="btn btn-small" id="co-clearstop" style="margin-top:8px">Clear the stop rule</button>`
          : `<p class="muted small">Not triggered.</p>`}
      </div>
      <div class="card" style="margin-top:10px">
        <strong>Calamity pause</strong>
        ${pause ? `<p class="muted small">All gates paused since ${fmtDate(pause.from)}${pause.note ? ': ' + esc(pause.note) : ''}.</p>
          <button type="button" class="btn btn-small" id="co-endpause" style="margin-top:8px">End the pause</button>`
          : `<p class="muted small">For a typhoon or other calamity: weeks don't count and don't break the streak.</p>
          <button type="button" class="btn btn-small" id="co-pause" style="margin-top:8px">Pause all gates</button>`}
      </div>
      ${gs.review.due ? `<div class="card" style="margin-top:10px"><strong>Pilot review is due</strong>
        <p class="muted small">${cfg.targets.reviewWeeks} weeks since go-live (${fmtDate(gs.review.date)}).</p>
        <button type="button" class="btn btn-small" id="co-review" style="margin-top:8px">Mark the review done</button></div>` : ''}
      <button type="button" class="btn btn-big" id="co-log" style="margin-top:10px">View the change log</button>
    </section>`;
}

function wireCoachGame(sh) {
  const on = (sel, fn) => { const el = sh.q(sel); if (el) el.onclick = fn; };
  on('#co-levelup', () => openLevelUpForm());
  on('#co-targets', () => openTargetsForm());
  on('#co-levels', () => openLevelCapitalForm());
  on('#co-log', () => openChangeLog());
  on('#co-clearstop', async () => {
    const note = await ask('Clear the stop rule? Write what you agreed.', { yes: 'Clear it', input: { label: 'What was agreed (required)', required: true } });
    if (!note) return;
    if (await saveGame((g) => { g.stopClears = [...(g.stopClears || []), { date: today(), note, demo: demoOn() }]; },
      { action: 'edit', entity: 'stopRule', id: today(), summary: { text: `Stop rule cleared: ${note}` } })) { toast('Stop rule cleared'); sh.refresh(); }
  });
  on('#co-pause', async () => {
    const note = await ask('Pause all gates (typhoon or calamity)? Weeks will not count and will not break the streak until you end the pause.', { yes: 'Pause', input: { label: 'Why? (required)', required: true } });
    if (!note) return;
    if (await saveGame((g) => { g.pauses = [...(g.pauses || []), { id: DB.newId('pz'), from: today(), to: null, note, demo: demoOn() }]; },
      { action: 'create', entity: 'pause', id: today(), summary: { text: `Gates paused: ${note}` } })) { toast('Paused'); sh.refresh(); }
  });
  on('#co-endpause', async () => {
    if (!(await ask('End the pause? This week stays paused; next week counts again.', { yes: 'End pause' }))) return;
    if (await saveGame((g) => { g.pauses = (g.pauses || []).map((p) => (p.to ? p : { ...p, to: today() })); },
      { action: 'edit', entity: 'pause', id: today(), summary: { text: 'Pause ended' } })) { toast('Pause ended'); sh.refresh(); }
  });
  on('#co-review', async () => {
    if (!(await ask('Mark the pilot review as done?', { yes: 'Done' }))) return;
    if (await saveGame((g) => { g.reviewDone = { date: today(), demo: demoOn() }; },
      { action: 'edit', entity: 'review', id: today(), summary: { text: 'Pilot review done' } })) { toast('Review marked done'); sh.refresh(); }
  });
}

// ---------- confirm level up (Coach only) ----------

function openLevelUpForm() {
  const gs = gameNow();
  const next = gs.next;
  const given = sum(capitalList().filter(active), (c) => c.amount);
  const suggest = next.capital != null ? Math.max(0, next.capital - given) : 0;
  const f = { date: today(), amountText: pesoInput(suggest), note: '', error: '' };
  openSheet({
    title: `Level ${next.n}`,
    render: (sh) => {
      const r = gs.readiness;
      sh.set(`
        <div class="card level-card">${img(`level-${next.n}.jpg`, `Level ${next.n}`, 'level-img')}
          <div><p class="muted small">Level ${next.n}</p><h2>${esc(next.name)}</h2>
          ${next.capital ? `<p class="muted small">Total capital at this level: ${peso(next.capital)}</p>` : ''}</div></div>
        ${r.coachDecides ? `<p class="info">This level is your decision as Coach.</p>`
          : r.ready ? `<p class="result ok">All goals are met ✓</p>`
          : `<p class="warn">Not every goal is met yet:<br>${r.items.filter((i) => !i.ok).map((i) => '• ' + esc(i.label)).join('<br>')}<br>You can still confirm, as Coach.</p>`}
        <label class="field"><span class="label">Date</span>
          <input class="input" type="date" id="lu-date" value="${f.date}" max="${today()}"></label>
        <label class="field"><span class="label">Capital to give now (₱)</span>
          <input class="input big" id="lu-amt" inputmode="decimal" autocomplete="off" value="${esc(f.amountText)}">
          <span class="hint">Already given: ${peso(given)}.${next.capital ? ` Level ${next.n} total: ${peso(next.capital)}.` : ''} Type 0 if you give it later.</span></label>
        <label class="field"><span class="label">Note (optional)</span>
          <input class="input" id="lu-note" autocomplete="off" value="${esc(f.note)}"></label>
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
      `, `<button type="button" class="btn btn-primary btn-big" id="lu-save">Confirm Level ${next.n}</button>`);
      sh.q('#lu-date').onchange = (e) => { f.date = e.target.value || today(); };
      sh.q('#lu-amt').oninput = (e) => { f.amountText = e.target.value; };
      sh.q('#lu-note').oninput = (e) => { f.note = e.target.value; };
      sh.q('#lu-save').onclick = async () => {
        const amt = C.parsePeso(f.amountText);
        if (amt == null) { f.error = 'Type the capital to give now (0 is fine).'; sh.refresh(); return; }
        const stamp = DB.nowStamp();
        const demo = demoOn();
        const g = clone(S.settings.game || {});
        g.levelHistory = [...(g.levelHistory || []), { level: next.n, date: f.date, note: f.note.trim(), capitalAdded: amt, readyWhenConfirmed: gs.readiness.ready, demo, createdAt: stamp }];
        const extra = { game: g };
        if (amt > 0) extra.capitalReleased = [...capitalList(), { id: DB.newId('cap'), date: f.date, amount: amt, note: `Level ${next.n} capital`, status: 'active', demo, createdAt: stamp, updatedAt: stamp }];
        const ok = await saveSettings(extra, { action: 'edit', entity: 'level', id: String(next.n),
          summary: { text: `Level ${next.n} (${next.name}) confirmed by Coach${amt ? `, capital ${peso(amt)}` : ''}`, before: { level: gs.level }, after: { level: next.n } } });
        if (!ok) return;
        await closeSheet();
        celebrate({ image: `level-${next.n}.jpg`, title: `Level ${next.n}: ${next.name}!`, text: 'Confirmed by Coach. Congratulations!' });
        const t = topSheet(); if (t) t.refresh();
      };
    },
  });
}

// ---------- targets and level capital ----------

const TARGET_FIELDS = [
  ['weeklyIncome', 'Weekly income target (₱)', 'peso'],
  ['minMarginTenths', 'Minimum margin (%)', 'pct'],
  ['cashDiffLimit', 'Cash count: difference allowed without a note (₱)', 'peso'],
  ['oldUnpaidMaxTenths', 'Unpaid over 30 days: limit (% of weekly sales)', 'pct'],
  ['countMaxOffTenths', 'Stock count: within (%)', 'pct'],
  ['countsInARow', 'Stock counts in a row', 'int'],
  ['countedWeeks', 'Counted weeks needed for each level', 'int'],
  ['incomeWeeksNeeded', 'Income target met in … weeks', 'int'],
  ['incomeWindow', '… of the last (weeks)', 'int'],
  ['capitalCountsNeeded', 'Capital check OK on the last (cash counts)', 'int'],
  ['regularCustomers', 'Level 2: regular customers needed', 'int'],
  ['regularOrders', 'Level 2: orders each to be "regular"', 'int'],
  ['stopGap', 'Stop rule: capital short by more than (₱)', 'peso'],
  ['stopMissedReports', 'Stop rule: Sunday reports missed in a row', 'int'],
  ['trialWeeks', 'Trial (Pagsubok) length (weeks)', 'int'],
  ['reviewWeeks', 'Pilot review after (weeks)', 'int'],
  ['pahingaEvery', 'One rest week every (weeks)', 'int'],
];
const pctInput = (tenths) => `${Math.floor(tenths / 10)}${tenths % 10 ? '.' + (tenths % 10) : ''}`;
const parsePct = (s) => { const m = /^(\d+)(?:\.(\d))?$/.exec(String(s).trim()); return m ? Number(m[1]) * 10 + Number(m[2] || 0) : null; };

function openTargetsForm() {
  const cfg = gameCfg();
  const gs = gameNow();
  const f = { vals: {}, error: '' };
  for (const [k, , type] of TARGET_FIELDS) {
    const v = cfg.targets[k];
    f.vals[k] = type === 'peso' ? pesoInput(v) : type === 'pct' ? pctInput(v) : String(v);
  }
  // Her actual weeks, to help set the targets together.
  const done = gs.weeks.filter((w) => w.finished).slice(-8);
  const sumW = done.length ? C.periodSummary(allData(), done[0].ws, done[done.length - 1].we) : null;
  openSheet({
    title: 'Targets',
    render: (sh) => {
      sh.set(`
        ${sumW ? `<div class="card"><strong>Her actual weeks</strong>
          <p class="muted small">Last ${done.length} finished ${done.length === 1 ? 'week' : 'weeks'}</p>
          ${rowHtml('Average weekly income', peso(Math.round(sumW.income / done.length)))}
          ${rowHtml('Average weekly sales', peso(Math.round(sumW.sales / done.length)))}
          ${rowHtml('Margin', C.formatPct(sumW.marginTenths))}</div>` : ''}
        <p class="muted small" style="margin-top:10px">Set these together after the trial. Starting values come from the plan. A change applies from this week on; past weeks keep their result.</p>
        ${TARGET_FIELDS.map(([k, label, type]) => `<label class="field"><span class="label">${esc(label)}</span>
          <input class="input" data-t="${k}" inputmode="${type === 'int' ? 'numeric' : 'decimal'}" autocomplete="off" value="${esc(f.vals[k])}"></label>`).join('')}
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
      `, `<button type="button" class="btn btn-primary btn-big" id="tg-save">Save targets</button>`);
      sh.qa('[data-t]').forEach((el) => { el.oninput = () => { f.vals[el.dataset.t] = el.value; }; });
      sh.q('#tg-save').onclick = async () => {
        const out = {};
        for (const [k, label, type] of TARGET_FIELDS) {
          const s = f.vals[k];
          const v = type === 'peso' ? C.parsePeso(s) : type === 'pct' ? parsePct(s) : (/^\d+$/.test(String(s).trim()) ? Number(s) : null);
          if (v == null || (type === 'int' && v < 1)) { f.error = `Check: ${label}`; sh.refresh(); return; }
          out[k] = v;
        }
        if (out.incomeWeeksNeeded > out.incomeWindow) { f.error = 'The income weeks needed cannot be more than the weeks looked at.'; sh.refresh(); return; }
        const before = cfg.targets;
        if (!(await saveGame((g) => { g.targetsHistory = [...(g.targetsHistory || []), { from: today(), targets: out, createdAt: DB.nowStamp() }]; },
          { action: 'edit', entity: 'targets', id: 'targets', summary: { text: 'Targets changed (from this week on)', before, after: out } }))) return;
        await closeSheet();
        toast('Targets saved');
      };
    },
  });
}

function openLevelCapitalForm() {
  const cfg = gameCfg();
  const f = { vals: cfg.levels.map((l) => (l.capital == null ? '' : pesoInput(l.capital))), error: '' };
  openSheet({
    title: 'Level capital',
    render: (sh) => {
      sh.set(`
        <p class="muted small">Total capital for each level. Leave empty for "Coach decides".</p>
        ${cfg.levels.map((l, i) => `<label class="field"><span class="label">Level ${l.n} · ${esc(l.name)} (₱)</span>
          <input class="input" data-l="${i}" inputmode="decimal" autocomplete="off" value="${esc(f.vals[i])}" placeholder="Coach decides"></label>`).join('')}
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ''}
      `, `<button type="button" class="btn btn-primary btn-big" id="lc-save">Save</button>`);
      sh.qa('[data-l]').forEach((el) => { el.oninput = () => { f.vals[Number(el.dataset.l)] = el.value; }; });
      sh.q('#lc-save').onclick = async () => {
        const levels = [];
        for (let i = 0; i < f.vals.length; i++) {
          const s = f.vals[i].trim();
          const v = s ? C.parsePeso(s) : null;
          if (s && v == null) { f.error = `Check the amount for Level ${i + 1}.`; sh.refresh(); return; }
          levels.push({ capital: v });
        }
        if (!(await saveGame((g) => { g.levels = levels; }, { action: 'edit', entity: 'levels', id: 'levels', summary: { text: 'Level capital changed', after: levels } }))) return;
        await closeSheet();
        toast('Saved');
      };
    },
  });
}

// ---------- change log ----------

async function openChangeLog() {
  let lines = [];
  try { lines = (await DB.getChangeLog()).reverse(); } catch (err) { console.warn(err); }
  const k = counters();
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${C.formatDate(C.todayManila(d))} ${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(d)}`;
  };
  openSheet({
    title: 'Change log',
    render: (sh) => {
      sh.set(`
        <div class="card">
          ${rowHtml('Orders made', k.ordersCreated || 0)}${rowHtml('Edits', k.edits || 0)}${rowHtml('Cancels', k.cancels || 0)}${rowHtml('Imports', k.imports || 0)}
          <p class="muted small" style="margin-top:6px">These counts only go up. If one drops, or the report number starts again, the data was reset.</p>
        </div>
        <p class="muted small" style="margin-top:10px">${lines.length} lines, newest first${lines.length > 300 ? ' (showing 300)' : ''}.</p>
        ${lines.slice(0, 300).map((l) => `<div class="card compact log-line ${l.action}">
          <div class="row"><strong class="small">${esc(l.action)} · ${esc(l.entity)}</strong><span class="muted small nowrap">${esc(fmtTime(l.timestamp))}</span></div>
          <p class="small">${esc((l.summary && l.summary.text) || '')}</p></div>`).join('')}`);
    },
  });
}

init();
