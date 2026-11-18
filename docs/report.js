// report.js: draws the report for Coach as a PNG picture, 1080 px wide, on a <canvas>.
// Text is at least 32 px, because Messenger shrinks pictures. No outside library.

const W = 1080;
const PAD = 48;
const INK = '#1b1b18', MUTED = '#55554d', GREEN = '#2e6b30', RED = '#b3261e', ORANGE = '#9a4b00', CREAM = '#fbf6ea';
const FONT = 'Roboto, "Segoe UI", system-ui, sans-serif';
const ROW = 54;
const GAP = 36; // space before a row marked gap: true

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// Shorten text with "…" so it fits the width.
function fit(ctx, text, maxW) {
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * m = report model prepared by app.js:
 *   { businessName, periodText, madeText, reportNo, phoneId, appVersion, alert?,
 *     sections: [{ title, rows: [{ label, value, color?, bold?, big?, note? }] }] }
 * Returns a canvas.
 */
export async function drawReport(m, headerSrc) {
  const header = headerSrc ? await loadImage(headerSrc) : null;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = 6000;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, cv.height);
  ctx.textBaseline = 'alphabetic';

  let y = 0;
  if (header) {
    const h = Math.round((header.height * W) / header.width);
    ctx.drawImage(header, 0, 0, W, h);
    y = h;
  }
  // Title band
  const bandH = 214;
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, y, W, bandH);
  ctx.fillStyle = '#fff';
  ctx.font = `700 56px ${FONT}`;
  ctx.fillText(fit(ctx, m.businessName, W - 2 * PAD), PAD, y + 74);
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(fit(ctx, 'Report: ' + m.periodText, W - 2 * PAD), PAD, y + 128);
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText(fit(ctx, `No. ${m.reportNo} · made ${m.madeText}`, W - 2 * PAD), PAD, y + 176);
  y += bandH + 28;

  if (m.alert) {
    ctx.font = `700 36px ${FONT}`;
    const h = 92;
    ctx.fillStyle = m.alert.ok ? '#e3f1e0' : '#fde4e1';
    roundRect(ctx, PAD, y, W - 2 * PAD, h, 20); ctx.fill();
    ctx.fillStyle = m.alert.ok ? GREEN : RED;
    ctx.fillText(fit(ctx, m.alert.text, W - 4 * PAD), PAD + 30, y + 58);
    y += h + 24;
  }

  for (const s of m.sections) {
    const rowsH = s.rows.reduce((t, r) => t + (r.big ? 72 : ROW) + (r.note ? 44 : 0) + (r.gap ? GAP : 0), 0);
    const h = 84 + rowsH + 20;
    ctx.fillStyle = '#fff';
    roundRect(ctx, PAD - 12, y, W - 2 * PAD + 24, h, 22); ctx.fill();
    ctx.strokeStyle = '#e6dfcc'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = GREEN;
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(fit(ctx, s.title, W - 3 * PAD), PAD + 12, y + 58);
    let ry = y + 84;
    for (const r of s.rows) {
      if (r.gap) {
        // A dashed line and some space: what follows is compared, not added.
        ctx.strokeStyle = '#b9b2a0'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
        ctx.beginPath(); ctx.moveTo(PAD + 12, ry + GAP / 2); ctx.lineTo(W - PAD - 12, ry + GAP / 2); ctx.stroke();
        ctx.setLineDash([]);
        ry += GAP;
      }
      const rh = r.big ? 72 : ROW;
      const size = r.big ? 44 : 34;
      ctx.font = `${r.bold || r.big ? 700 : 400} ${size}px ${FONT}`;
      const valueW = r.value ? Math.min(ctx.measureText(r.value).width, 520) : 0;
      ctx.fillStyle = r.labelColor || INK;
      ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, r.label, W - 2 * PAD - 24 - valueW - 24), PAD + 12, ry + rh - 18);
      if (r.value) {
        ctx.textAlign = 'right';
        ctx.fillStyle = r.color || INK;
        ctx.fillText(fit(ctx, r.value, 520), W - PAD - 12, ry + rh - 18);
        ctx.textAlign = 'left';
      }
      ry += rh;
      if (r.note) {
        ctx.font = `400 32px ${FONT}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(fit(ctx, r.note, W - 2 * PAD - 24), PAD + 12, ry + 30);
        ry += 44;
      }
    }
    y += h + 22;
  }

  ctx.font = `400 32px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(fit(ctx, `Phone ${m.phoneId} · app ${m.appVersion}`, W - 2 * PAD), PAD, y + 40);
  y += 70;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = y;
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}

export const COLORS = { GREEN, RED, ORANGE, MUTED, INK };
