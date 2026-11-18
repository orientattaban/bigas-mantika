// game.js: Negosyo Quest rules. Pure functions only (no screen, no storage), so the
// tests can run them in Node. The game rewards good habits and honest records:
// every mission is a yes/no for the week, so more entries never earn more.
import * as C from './calc.js';

// ---------- settings with defaults (all editable by Coach) ----------

// Values from the brief (CLAUDE.md §7). Money in centavos, percentages in tenths (50 = 5%).
export const DEFAULT_TARGETS = {
  weeklyIncome: 50000,        // ₱500 weekly income target
  minMarginTenths: 50,        // margin at least 5%
  cashDiffLimit: 10000,       // cash count difference under ₱100 (or explained)
  oldUnpaidMaxTenths: 50,     // unpaid older than 30 days under 5% of weekly sales
  countMaxOffTenths: 50,      // stock count within 5% (or with a reason)
  countsInARow: 3,            // 3 stock counts in a row
  countedWeeks: 8,            // counted weeks needed per level
  incomeWeeksNeeded: 6,       // income target met in 6 ...
  incomeWindow: 8,            // ... of the last 8 weeks
  capitalCountsNeeded: 4,     // capital check OK on the last 4 Sunday cash counts
  regularCustomers: 5,        // 5+ regular customers ...
  regularOrders: 3,           // ... with 3+ orders each
  stopGap: 150000,            // stop rule: capital short by more than ₱1,500 on a Sunday
  stopMissedReports: 2,       // stop rule: 2 Sunday reports missed in a row
  trialWeeks: 4,              // Pagsubok: the first 4 weeks
  reviewWeeks: 12,            // review the pilot 12 weeks after go-live
  pahingaEvery: 8,            // one rest week every 8 weeks
};

export const DEFAULT_LEVELS = [
  { n: 1, name: 'Tindera', capital: 1500000 },
  { n: 2, name: 'Suki Builder', capital: 3000000 },
  { n: 3, name: 'Supplier ng Barangay', capital: null },
  { n: 4, name: 'Distributor', capital: null },
  { n: 5, name: 'Negosyante', capital: null },
];

export const MISSIONS = [
  { id: 'cash', name: 'Week closed', how: (t) => `Count the cash (Sunday). Difference under ${C.formatPeso(t.cashDiffLimit)}, or write what happened.` },
  { id: 'count', name: 'Honest count', how: () => 'Do a blind stock count. Any difference is fine when you pick a reason.' },
  { id: 'unpaid', name: 'No old unpaid', how: () => 'Every unpaid order older than 30 days has a follow-up note.' },
  { id: 'income', name: 'Income target', how: (t) => `This week's income reaches ${C.formatPeso(t.weeklyIncome)}.` },
  { id: 'backup', name: 'Backup sent', how: () => 'Make a backup file and send it to Coach.' },
];
export const WEEK_COUNTS_AT = 4; // a week counts when 4 of the 5 missions are done

export const BADGES = [
  { id: 'first-sale', name: 'First Sale', img: 'badge-unang-benta.jpg', how: 'Record your first sale.' },
  { id: 'ten-customers', name: 'First 10 Customers', img: 'badge-10-suki.jpg', how: '10 different customers have ordered.' },
  { id: 'sales-10k', name: 'First ₱10,000 Sales', img: 'badge-10k-benta.jpg', how: 'Total sales reach ₱10,000.' },
  { id: 'honest-count', name: 'Honest Count', img: 'badge-stock-count.jpg', how: 'Do your first blind stock count.' },
  { id: 'zero-old-unpaid', name: 'Zero Old Unpaid Week', img: 'badge-zero-utang.jpg', how: 'A week after the trial ends with no unpaid order older than 30 days.' },
  { id: 'streak-4', name: '4-Week Streak', img: 'badge-streak.jpg', how: '4 counted weeks in a row.' },
  { id: 'level-2', name: 'Level 2', img: 'badge-level-2.jpg', how: 'Reach Level 2.' },
  { id: 'level-3', name: 'Level 3', img: 'badge-level-3.jpg', how: 'Reach Level 3.' },
];

// The game settings, with defaults filled in. Demo data brings its own go-live date,
// backup dates and report dates, so it never changes Coach's real settings.
export function gameConfig(settings = {}) {
  const g = settings.game || {};
  const demo = settings.demo || null;
  const levels = DEFAULT_LEVELS.map((l, i) => ({ ...l, ...((g.levels || [])[i] || {}), n: l.n, name: l.name }));
  const history = g.levelHistory || [];
  const level = history.length ? history[history.length - 1].level : 1;
  // Targets keep their history: a change applies from the week it was made, so past weeks
  // keep the result they had (changing a target never rewrites history).
  const changes = (g.targetsHistory || []).slice().sort((a, b) => a.from.localeCompare(b.from));
  const targetsFor = (ws) => {
    let t = { ...DEFAULT_TARGETS };
    for (const c of changes) if (C.weekStart(c.from) <= ws) t = { ...DEFAULT_TARGETS, ...c.targets };
    return t;
  };
  return {
    goLive: settings.goLiveDate || (demo && demo.goLiveDate) || null,
    targets: changes.length ? { ...DEFAULT_TARGETS, ...changes[changes.length - 1].targets } : { ...DEFAULT_TARGETS },
    targetsFor,
    levels,
    level,
    levelSince: history.length ? history[history.length - 1].date : null,
    levelHistory: history,
    pahinga: (g.pahinga || []).map((p) => p.ws),
    pauses: g.pauses || [],
    stopClears: g.stopClears || [],
    reviewDone: g.reviewDone || null,
    backupDates: [...(settings.backupDates || []), ...((demo && demo.backupDates) || [])],
    reportDates: [...(settings.reportDates || []), ...((demo && demo.reportDates) || [])],
  };
}

// ---------- records as they were on a date ----------

export function dataAsOf(d, date) {
  const upto = (x) => x.date <= date;
  return {
    ...d,
    capital: (d.capital || []).filter(upto),
    stockIns: (d.stockIns || []).filter(upto),
    orders: (d.orders || []).filter((o) => o.dateOrdered <= date).map((o) => ({
      ...o,
      status: o.status === 'cancelled' && (o.cancelledDate || '') > date ? 'active' : o.status,
      payments: (o.payments || []).filter((p) => p.date <= date),
    })),
    expenses: (d.expenses || []).filter(upto),
    withdrawals: (d.withdrawals || []).filter(upto),
    stockCounts: (d.stockCounts || []).filter(upto),
    cashCounts: (d.cashCounts || []).filter(upto),
  };
}

const active = (r) => r.status !== 'cancelled';
const inWeek = (date, ws, we) => date >= ws && date <= we;

// Unpaid orders older than 30 days on a date, and which of them have no follow-up note
// written after they turned 30 days old.
export function oldUnpaid(orders, date) {
  const list = [];
  for (const o of orders) {
    if (o.dateOrdered > date || !active(o)) continue;
    const paid = (o.payments || []).filter((p) => p.date <= date).reduce((s, p) => s + p.amount, 0);
    const bal = o.total - paid;
    if (bal <= 0) continue;
    const age = C.daysBetween(o.dateOrdered, date);
    if (age <= 30) continue;
    const since = C.addDays(o.dateOrdered, 31);
    const noted = (o.followUps || []).some((f) => f.date >= since && f.date <= date);
    list.push({ order: o, balance: bal, age, noted });
  }
  return list;
}

// ---------- one week ----------

export function weekIndex(cfg, ws) {
  if (!cfg.goLive) return null;
  return Math.round(C.daysBetween(C.weekStart(cfg.goLive), ws) / 7);
}

export function isPaused(cfg, ws) {
  return cfg.pauses.some((p) => ws >= C.weekStart(p.from) && (!p.to || ws <= C.weekStart(p.to)));
}

/**
 * The five missions for the week starting on Monday `ws`, checked up to `today`.
 * Returns { ws, we, phase: 'before' | 'trial' | 'normal', finished, missions: [{id, done, detail}],
 *           done, available, counts, pahinga, paused }
 */
export function weekMissions(d, cfg, ws, today) {
  const t = cfg.targetsFor ? cfg.targetsFor(ws) : cfg.targets;
  const we = C.addDays(ws, 6);
  const end = we < today ? we : today;
  const idx = weekIndex(cfg, ws);
  const phase = idx == null || idx < 0 ? 'before' : idx < t.trialWeeks ? 'trial' : 'normal';
  const m = {};

  // Week closed: the first cash count saved this week (cancelled ones left out).
  const cc = (d.cashCounts || []).filter((c) => active(c) && inWeek(c.date, ws, we))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  m.cash = cc
    ? { done: Math.abs(cc.difference) < t.cashDiffLimit || !!(cc.note && cc.note.trim()),
        detail: cc.difference === 0 ? 'Exact' : `${cc.difference < 0 ? 'Short' : 'Over'} ${C.formatPeso(Math.abs(cc.difference))}${cc.note ? ', explained' : ''}` }
    : { done: false, detail: 'No cash count yet' };

  // Honest count: a blind stock count this week, every difference has a reason.
  const counts = (d.stockCounts || []).filter((k) => active(k) && inWeek(k.date, ws, we));
  const missing = counts.filter((k) => k.difference !== 0 && !k.reason).length;
  m.count = counts.length
    ? { done: missing === 0, detail: missing ? 'Pick a reason for the difference' : `${counts.length} ${counts.length === 1 ? 'count' : 'counts'}` }
    : { done: false, detail: 'No stock count yet' };

  // No old unpaid: checked on the last day of the week (or today).
  const old = oldUnpaid(d.orders || [], end).filter((x) => !x.noted);
  m.unpaid = { done: old.length === 0, detail: old.length ? `${old.length} need a follow-up note` : 'All good' };

  // Income target (only after the trial).
  const inc = C.periodSummary(d, ws, we).income;
  m.income = phase === 'normal'
    ? { done: inc >= t.weeklyIncome, detail: `${C.formatPeso(inc)} of ${C.formatPeso(t.weeklyIncome)}` }
    : { done: false, detail: phase === 'trial' ? 'Starts after the trial' : 'Starts at go-live', off: true, income: inc };
  m.income.income = inc;

  // Backup sent this week.
  m.backup = cfg.backupDates.some((x) => inWeek(x, ws, we))
    ? { done: true, detail: 'Sent' } : { done: false, detail: 'Not yet this week' };

  const missions = MISSIONS.map((x) => ({ id: x.id, ...m[x.id] }));
  const done = missions.filter((x) => x.done).length;
  const available = missions.filter((x) => !x.off).length;
  const pahinga = cfg.pahinga.includes(ws);
  const paused = isPaused(cfg, ws);
  return {
    ws, we, phase, finished: we < today, missions, done, available,
    counts: phase === 'normal' && !pahinga && !paused && done >= WEEK_COUNTS_AT,
    pahinga, paused, income: inc, incomeTarget: t.weeklyIncome,
  };
}

// ---------- the whole game ----------

export function gameState(d, cfg, today) {
  const t = cfg.targets;
  const cur = C.weekStart(today);
  const weeks = [];
  if (cfg.goLive && cfg.goLive <= today) {
    for (let ws = C.weekStart(cfg.goLive); ws <= cur; ws = C.addDays(ws, 7)) weeks.push(weekMissions(d, cfg, ws, today));
  }
  const current = weeks.length ? weeks[weeks.length - 1] : weekMissions(d, cfg, cur, today);
  const started = weeks.length > 0;
  const idx = weekIndex(cfg, cur);
  const inTrial = started && idx < t.trialWeeks;

  // Weeks that take part in the game: after the trial, not a rest week, not paused by Coach,
  // and finished (or this week, once it already counts).
  const eligible = weeks.filter((w) => w.phase === 'normal' && !w.pahinga && !w.paused && (w.finished || w.counts));

  // Streak: counted weeks in a row. Rest and paused weeks are skipped, not broken.
  let streak = 0, best = 0, streak4Date = null;
  for (const w of eligible) {
    streak = w.counts ? streak + 1 : 0;
    if (streak > best) best = streak;
    if (streak >= 4 && !streak4Date) streak4Date = w.we < today ? w.we : today;
  }

  // ----- readiness for the next level -----
  const next = cfg.levels.find((l) => l.n === cfg.level + 1) || null;
  // Weeks count toward the next level only if they start on or after the day Coach confirmed this level
  // (the week that earned a level is not counted again for the next one).
  const countedSince = eligible.filter((w) => w.counts && (!cfg.levelSince || w.ws >= cfg.levelSince)).length;
  const window = eligible.slice(-t.incomeWindow);
  const incomeMet = window.filter((w) => w.income >= w.incomeTarget).length;
  const winFrom = window.length ? window[0].ws : null;
  const winTo = window.length ? window[window.length - 1].we : null;
  const winSum = window.length ? C.periodSummary(d, winFrom, winTo < today ? winTo : today) : null;
  const margin = winSum && winSum.sales > 0 ? Math.round((winSum.income * 1000) / winSum.sales) : null;
  const avgWeeklySales = window.length ? Math.round(winSum.sales / window.length) : 0;
  const unpaidNow = C.unpaidByAge(d.orders || [], today);
  const oldNow = unpaidNow.b31 + unpaidNow.b61;

  // Capital check on the last Sunday cash counts (the first count of each week).
  const weekCounts = [];
  for (const w of weeks) {
    const c = (d.cashCounts || []).filter((x) => active(x) && inWeek(x.date, w.ws, w.we)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (c) weekCounts.push(c);
  }
  const lastCounts = weekCounts.slice(-t.capitalCountsNeeded);
  const capOk = lastCounts.filter((c) => C.capitalCheck(dataAsOf(d, c.date), c.date).ok).length;

  const sc = (d.stockCounts || []).filter(active).sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt)).slice(-t.countsInARow);
  const scOk = sc.filter((k) => k.difference === 0 || k.reason || (C.stockAccuracy(k) ?? 0) <= t.countMaxOffTenths).length;

  const ordersBy = {};
  for (const o of d.orders || []) if (active(o)) ordersBy[o.customerId] = (ordersBy[o.customerId] || 0) + 1;
  const regulars = Object.values(ordersBy).filter((n) => n >= t.regularOrders).length;

  const pct = (tenths) => C.formatPct(tenths);
  const items = [];
  const add = (label, have, need, ok) => items.push({ label, have, need, ok });
  let coachDecides = false;
  if (!next) { /* top level */ } else if (cfg.level === 1) {
    add('Counted weeks after the trial', String(countedSince), String(t.countedWeeks), countedSince >= t.countedWeeks);
    add(`Capital check OK on the last ${t.capitalCountsNeeded} cash counts`, `${capOk} of ${lastCounts.length}`, String(t.capitalCountsNeeded), lastCounts.length >= t.capitalCountsNeeded && capOk === lastCounts.length);
    add(`Income target in ${t.incomeWeeksNeeded} of the last ${t.incomeWindow} weeks`, `${incomeMet} of ${window.length}`, String(t.incomeWeeksNeeded), window.length >= t.incomeWindow && incomeMet >= t.incomeWeeksNeeded);
    add(`Margin at least ${pct(t.minMarginTenths)} (last ${t.incomeWindow} weeks)`, pct(margin), pct(t.minMarginTenths), window.length >= t.incomeWindow && margin != null && margin >= t.minMarginTenths);
    add(`Unpaid over 30 days under ${pct(t.oldUnpaidMaxTenths)} of weekly sales`, C.formatPeso(oldNow), `under ${C.formatPeso(Math.round((avgWeeklySales * t.oldUnpaidMaxTenths) / 1000))}`,
      window.length > 0 && oldNow * 1000 < avgWeeklySales * t.oldUnpaidMaxTenths || (window.length > 0 && oldNow === 0));
    add(`${t.countsInARow} stock counts in a row within ${pct(t.countMaxOffTenths)} or with a reason`, `${scOk} of ${sc.length}`, String(t.countsInARow), sc.length >= t.countsInARow && scOk === sc.length);
  } else if (cfg.level === 2) {
    add('Counted weeks at Level 2', String(countedSince), String(t.countedWeeks), countedSince >= t.countedWeeks);
    add(`Capital check OK on the last ${t.capitalCountsNeeded} cash counts`, `${capOk} of ${lastCounts.length}`, String(t.capitalCountsNeeded), lastCounts.length >= t.capitalCountsNeeded && capOk === lastCounts.length);
    add(`Regular customers (${t.regularOrders}+ orders each)`, String(regulars), String(t.regularCustomers), regulars >= t.regularCustomers);
    add(`Income target in ${t.incomeWeeksNeeded} of the last ${t.incomeWindow} weeks`, `${incomeMet} of ${window.length}`, String(t.incomeWeeksNeeded), window.length >= t.incomeWindow && incomeMet >= t.incomeWeeksNeeded);
  } else {
    coachDecides = true;
  }
  const gatesOff = !started || inTrial || isPaused(cfg, cur);
  const ready = !!next && !coachDecides && !gatesOff && items.length > 0 && items.every((x) => x.ok);

  // ----- stop rule -----
  const lastClear = cfg.stopClears.length ? cfg.stopClears[cfg.stopClears.length - 1].date : '';
  const reasons = [];
  let missedRun = [];
  for (const w of weeks) {
    if (w.we <= lastClear || w.paused || w.we > today) continue;
    const cc = C.capitalCheck(dataAsOf(d, w.we), w.we);
    if (cc.capital > 0 && -cc.gap > t.stopGap) reasons.push(`Capital short by ${C.formatPeso(-cc.gap)} on ${C.formatDate(w.we)}`);
    if (!w.finished) continue;
    const sent = cfg.reportDates.some((x) => inWeek(x, w.ws, w.we));
    missedRun = sent ? [] : [...missedRun, w];
    if (missedRun.length === t.stopMissedReports) {
      reasons.push(`${t.stopMissedReports} Sunday reports missed (weeks of ${missedRun.map((x) => C.formatDate(x.ws)).join(' and ')})`);
    }
  }

  // ----- review reminder -----
  const reviewDue = !!cfg.goLive && today >= C.addDays(cfg.goLive, 7 * t.reviewWeeks) && !cfg.reviewDone;

  // ----- rest week (Pahinga) -----
  const lastRest = cfg.pahinga.filter((x) => x < cur).sort().pop();
  const restAllowed = started && !inTrial && !current.pahinga && !current.paused
    && (!lastRest || C.daysBetween(lastRest, cur) >= 7 * t.pahingaEvery);
  const nextRestFrom = lastRest ? C.addDays(lastRest, 7 * t.pahingaEvery) : null;

  // ----- badges (worked out from the records, so they always match them) -----
  const badges = {};
  const orders = (d.orders || []).filter(active).sort((a, b) => (a.dateOrdered + a.createdAt).localeCompare(b.dateOrdered + b.createdAt));
  if (orders.length) badges['first-sale'] = orders[0].dateOrdered;
  const firstBy = {};
  for (const o of orders) if (!firstBy[o.customerId]) firstBy[o.customerId] = o.dateOrdered;
  const firsts = Object.values(firstBy).sort();
  if (firsts.length >= 10) badges['ten-customers'] = firsts[9];
  let run = 0;
  for (const o of orders) { run += o.total; if (run >= 1000000) { badges['sales-10k'] = o.dateOrdered; break; } }
  const firstCount = (d.stockCounts || []).filter(active).map((k) => k.date).sort()[0];
  if (firstCount) badges['honest-count'] = firstCount;
  const zeroWeek = weeks.find((w) => w.phase === 'normal' && w.finished && oldUnpaid(d.orders || [], w.we).length === 0);
  if (zeroWeek) badges['zero-old-unpaid'] = zeroWeek.we;
  if (streak4Date) badges['streak-4'] = streak4Date;
  for (const h of cfg.levelHistory) {
    if (h.level >= 2 && !badges['level-2']) badges['level-2'] = h.date;
    if (h.level >= 3 && !badges['level-3']) badges['level-3'] = h.date;
  }

  return {
    started, inTrial, trialWeek: inTrial ? idx + 1 : null, weeks, current,
    stars: current.done, streak, bestStreak: best,
    level: cfg.level, levelInfo: cfg.levels[cfg.level - 1], next,
    readiness: { items, ready, coachDecides, gatesOff, countedSince, incomeMet, window: window.length, margin, regulars },
    stop: { on: reasons.length > 0, reasons },
    review: { due: reviewDue, date: cfg.goLive ? C.addDays(cfg.goLive, 7 * t.reviewWeeks) : null },
    rest: { allowed: restAllowed, nextFrom: nextRestFrom },
    oldUnpaidNoNote: oldUnpaid(d.orders || [], today).filter((x) => !x.noted),
    badges,
  };
}
