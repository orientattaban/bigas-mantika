// ui.js: small screen helpers (safe text, full-screen sheets, dialogs, messages, images).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- images, with a coloured placeholder when a file is missing ----------
export function img(file, alt, cls = '') {
  return `<img src="./assets/images/${file}" alt="${esc(alt)}" class="${cls}">`;
}
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement) {
    const d = document.createElement('div');
    d.className = 'ph ' + t.className;
    d.textContent = t.alt || 'Picture';
    t.replaceWith(d);
  }
}, true);

// ---------- short message at the bottom ----------
let toastTimer;
export function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 2500);
}

// ---------- yes/no dialog (optionally with one text box) ----------
let openDialog = null;
export function ask(message, { yes = 'OK', no = 'Go back', danger = false, input = null } = {}) {
  closeDialog(null);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <p>${esc(message)}</p>
        ${input ? `<label class="field"><span class="label">${esc(input.label)}</span>
          <input class="input" id="dlg-input" autocomplete="off"></label>` : ''}
        <p class="error" id="dlg-error" hidden></p>
        <div class="btn-row">
          ${no ? `<button type="button" class="btn" data-r="no">${esc(no)}</button>` : ''}
          <button type="button" class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-r="yes">${esc(yes)}</button>
        </div>
      </div>`;
    document.getElementById('dialog-root').append(wrap);
    const field = wrap.querySelector('#dlg-input');
    openDialog = { wrap, resolve, input };
    wrap.querySelector('[data-r="yes"]').onclick = () => {
      if (input) {
        const v = field.value.trim();
        if (input.required && !v) {
          const er = wrap.querySelector('#dlg-error');
          er.textContent = input.requiredMsg || 'Please fill this in.';
          er.hidden = false;
          return;
        }
        closeDialog(v);
      } else closeDialog(true);
    };
    const noBtn = wrap.querySelector('[data-r="no"]');
    if (noBtn) noBtn.onclick = () => closeDialog(input ? null : false);
    (field || wrap.querySelector('[data-r="yes"]')).focus();
  });
}
function closeDialog(value) {
  if (!openDialog) return;
  const { wrap, resolve, input } = openDialog;
  openDialog = null;
  wrap.remove();
  resolve(value === null && !input ? false : value);
}

// ---------- full-screen sheets, closed with "Back" or the phone's back button ----------
const stack = [];
const popWaiters = [];
let afterClose = () => {};
export const setAfterClose = (fn) => { afterClose = fn; };

export function openSheet({ title, render }) {
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <header class="sheet-head">
      <button type="button" class="back" aria-label="Back">← Back</button>
      <h2>${esc(title)}</h2>
    </header>
    <div class="sheet-body"><div class="inner"></div></div>
    <div class="sheet-foot" hidden><div class="inner"></div></div>`;
  document.getElementById('sheets').append(el);
  const sh = {
    el,
    body: el.querySelector('.sheet-body > .inner'),
    foot: el.querySelector('.sheet-foot > .inner'),
    q: (sel) => el.querySelector(sel),
    qa: (sel) => el.querySelectorAll(sel),
    set(bodyHtml, footHtml = '') {
      sh.body.innerHTML = bodyHtml;
      sh.foot.innerHTML = footHtml;
      sh.foot.parentElement.hidden = !footHtml;
    },
    refresh: () => render(sh),
  };
  stack.push(sh);
  document.body.classList.add('has-sheet');
  history.pushState({ sheet: stack.length }, '');
  el.querySelector('.back').onclick = () => history.back();
  render(sh);
  return sh;
}

export function closeSheet() {
  return new Promise((resolve) => { popWaiters.push(resolve); history.back(); });
}

export const topSheet = () => stack[stack.length - 1];

// Close every open sheet (used when a bottom tab is tapped).
export function closeAllSheets() {
  if (!stack.length) return Promise.resolve();
  return new Promise((resolve) => { popWaiters.push(resolve); history.go(-stack.length); });
}

// After a page reload no sheet is open, so forget any sheet left in the history entry.
if (history.state && history.state.sheet) history.replaceState(null, '');

window.addEventListener('popstate', () => {
  closeDialog(null);
  // Close every sheet above the history entry we went back to (usually one).
  const keep = (history.state && history.state.sheet) || 0;
  while (stack.length > keep) stack.pop().el.remove();
  document.body.classList.toggle('has-sheet', stack.length > 0);
  afterClose();
  const w = popWaiters.shift();
  if (w) w();
});
