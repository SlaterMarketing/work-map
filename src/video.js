// The timeline video: the map growing month by month, with counters, captions, an intro and an
// outro. Every frame is drawn from its index alone (the camera path is worked out up front), so
// any frame can be drawn in any order, and an export is identical every time.

import { DEFAULT_FONT, THEMES, clamp, cumAt, drawScene, familyColor, rgba } from './scene.js';

export const FORMATS = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

// Where everything goes, per format. Sizes in pixels.
const LAYOUTS = {
  vertical: {
    pad: 72, byline: { y: 126, size: 30 }, month: { y: 270, size: 132 },
    map: { x: 40, y: 330, w: 1000, h: 1110 },
    cap: { x: 72, y: 1515, w: 936, size: 50, sub: 34 },
    stats: { x: 72, y: 1620, w: 936, cols: 3, size: 52, key: 24, row: 104 },
    bar: { x: 72, y: 1858, w: 936, tick: 22 },
    intro: { size: 108, sub: 44, by: 30, w: 904 }, outro: { size: 84, value: 92, key: 30, cols: 2 },
    labels: { size: 23, family: 26 },
  },
  square: {
    pad: 56, byline: { y: 80, size: 22 }, month: { y: 168, size: 80 },
    map: { x: 40, y: 190, w: 1000, h: 610 },
    cap: { x: 56, y: 852, w: 968, size: 36, sub: 25 },
    stats: { x: 56, y: 930, w: 968, cols: 5, size: 38, key: 17, row: 70 },
    bar: { x: 56, y: 1040, w: 968, tick: 15 },
    intro: { size: 84, sub: 34, by: 24, w: 940 }, outro: { size: 64, value: 66, key: 24, cols: 3 },
    labels: { size: 19, family: 20 },
  },
  landscape: {
    pad: 80, byline: { y: 130, size: 26 }, month: { y: 240, size: 104 },
    map: { x: 700, y: 40, w: 1180, h: 940 },
    cap: { x: 80, y: 380, w: 580, size: 44, sub: 30 },
    stats: { x: 80, y: 560, w: 580, cols: 2, size: 52, key: 22, row: 106 },
    bar: { x: 80, y: 1020, w: 1760, tick: 18 },
    intro: { size: 108, sub: 40, by: 28, w: 1400 }, outro: { size: 84, value: 80, key: 28, cols: 3 },
    labels: { size: 21, family: 23 },
  },
};

const STAT_NAMES = [
  ['projects', 'projects'], ['clients', 'clients'], ['commits', 'commits'],
  ['meetings', 'meetings'], ['emails', 'emails sent'],
];

const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const short = (n) => (n >= 1e5 ? Math.round(n / 1e3) + 'k' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n));
const monthName = (k, style = 'short') => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' });

function wrap(ctx, text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Captions from the data itself: the first client, each new year, and the busiest month. */
export function autoMilestones(g) {
  const out = [];
  const firstClient = g.nodes.filter((n) => n.kind === 'client').sort((a, b) => a.first - b.first)[0];
  if (firstClient && firstClient.first > 0) out.push([g.months[firstClient.first], 'First client', firstClient.label]);
  for (const [i, k] of g.months.entries()) {
    if (i === 0 || !k.endsWith('-01')) continue;
    const year = k.slice(0, 4);
    const born = g.nodes.filter((n) => g.months[n.first].startsWith(year));
    const p = born.filter((n) => n.kind === 'project').length, c = born.length - p;
    const active = g.nodes.filter((n) => Object.keys(n.activity).some((m) => m.startsWith(year))).length;
    const sub = born.length
      ? [p && `${p} new project${p === 1 ? '' : 's'}`, c && `${c} new client${c === 1 ? '' : 's'}`].filter(Boolean).join(', ')
      : `${active} project${active === 1 ? '' : 's'} and clients on the go`;
    if (born.length || active) out.push([k, year, sub]);
  }
  const perMonth = g.months.map((_, i) => g.nodes.reduce((a, n) => a + (n.series.commits ? n.series.commits[i] - (i ? n.series.commits[i - 1] : 0) : 0), 0));
  const best = perMonth.indexOf(Math.max(...perMonth));
  if (perMonth[best] > 0 && !out.some(([k]) => k === g.months[best])) out.push([g.months[best], 'Busiest month', `${fmt(perMonth[best])} commits`]);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * opts: { format: 'vertical' | 'square' | 'landscape', fps, theme: 'dark' | 'light', font, displayFont,
 *         title, subtitle, byline, credit, milestones: [[month, title, subtitle]], seconds (main part) }
 * Returns { width, height, fps, duration, frames, draw(ctx, frameIndex) }.
 */
export function createVideo(g, opts = {}) {
  const format = FORMATS[opts.format] ? opts.format : 'vertical';
  const { width: W, height: H } = FORMATS[format];
  const Lay = LAYOUTS[format];
  const fps = opts.fps || 30;
  const theme = THEMES[opts.theme] || THEMES.dark;
  const font = opts.font || DEFAULT_FONT;
  const display = opts.displayFont || font;
  const color = familyColor(g, theme);
  const months = g.months;

  // schedule
  const INTRO = 2.8, HOLD = 1.2, OUTRO = 5.5;
  const md = clamp((opts.seconds || clamp(months.length * 0.6, 10, 26)) / months.length, 0.3, 0.9);
  const mStart = months.map((_, i) => INTRO + i * md);
  const MAIN_END = INTRO + months.length * md;
  const duration = MAIN_END + HOLD + OUTRO;
  const frames = Math.ceil(duration * fps);
  const fracMonth = (t) => (t < INTRO ? -1 : Math.min(months.length, (t - INTRO) / md));
  const appear = g.nodes.map((n) => (n.first === 0 ? INTRO - 0.3 : mStart[n.first]));

  // text
  const span = months.length;
  const years = Math.floor(span / 12);
  const title = opts.title || (years >= 2 ? `${years} years of work, mapped` : `${span} months of work, mapped`);
  const t = g.totals;
  const subtitle = opts.subtitle || [`${t.projects} project${t.projects === 1 ? '' : 's'}`, t.clients ? `${t.clients} client${t.clients === 1 ? '' : 's'}` : null]
    .filter(Boolean).join(' · ') + ` since ${monthName(months[0], 'long')}`;
  const byline = opts.byline ?? g.name;
  const milestones = (opts.milestones || autoMilestones(g)).filter(([k]) => months.includes(k));
  const stats = STAT_NAMES.filter(([k]) => (t[k] || 0) > 0).slice(0, Lay.stats.cols * 2);
  const statValue = (key, f, vis) => {
    if (key === 'projects') return vis.filter((i) => g.nodes[i].kind === 'project').length;
    if (key === 'clients') return vis.filter((i) => g.nodes[i].kind === 'client').length;
    return g.nodes.reduce((a, n) => a + (n.series[key] ? cumAt(n.series[key], f) : 0), 0);
  };

  // camera, worked out frame by frame: eases toward everything on screen and only ever pulls back
  const M = Lay.map;
  const kMax = 3.2 * (Math.min(W, H) / 1080);
  const cams = new Array(frames);
  {
    let cam = null, minK = Infinity;
    for (let i = 0; i < frames; i++) {
      const tt = i / fps;
      const f = Math.max(0, fracMonth(tt));
      const on = g.nodes.map((n, j) => [n, j]).filter(([, j]) => tt - appear[j] > 0.15);
      const tgt = { cx: 0, cy: 0, k: kMax };
      if (on.length) {
        const pad = 70;
        const rs = on.map(([n]) => g.radius(cumAt(n.cum, f)));
        const x0 = Math.min(...on.map(([n], q) => n.x - rs[q])) - pad, x1 = Math.max(...on.map(([n], q) => n.x + rs[q])) + pad;
        const y0 = Math.min(...on.map(([n], q) => n.y - rs[q])) - pad, y1 = Math.max(...on.map(([n], q) => n.y + rs[q])) + pad;
        Object.assign(tgt, { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.min(M.w / Math.max(240, x1 - x0), M.h / Math.max(240, y1 - y0), kMax) });
      } else if (g.nodes.length) {
        const first = g.nodes.reduce((a, n) => (n.first < a.first ? n : a));
        Object.assign(tgt, { cx: first.x, cy: first.y });
      }
      minK = Math.min(minK, tgt.k);
      tgt.k = minK;
      if (!cam) cam = { ...tgt };
      const s = 1 - Math.pow(0.28, 1 / fps);
      cam = { cx: cam.cx + (tgt.cx - cam.cx) * s, cy: cam.cy + (tgt.cy - cam.cy) * s, k: cam.k + (tgt.k - cam.k) * s };
      cams[i] = cam;
    }
  }

  function text(ctx, str, x, y, size, { weight = 600, color: c = theme.text, align = 'left', family = font, spacing = 0, alpha = 1 } = {}) {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.textAlign = align;
    ctx.fillStyle = alpha < 1 ? rgba(c, alpha) : c;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(str, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function draw(ctx, frame) {
    const tt = frame / fps;
    const f = fracMonth(tt);
    const mi = f < 0 ? -1 : Math.min(months.length - 1, Math.floor(f + 1e-9));
    const cam = cams[Math.min(frames - 1, frame)];
    let k = cam.k;
    if (tt > MAIN_END) k *= 1 + 0.05 * easeInOut(clamp((tt - MAIN_END) / (HOLD + OUTRO)));
    const X = (x) => M.x + M.w / 2 + (x - cam.cx) * k, Y = (y) => M.y + M.h / 2 + (y - cam.cy) * k;
    const ff = Math.max(0, f);

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.page;
    ctx.fillRect(0, 0, W, H);

    const grow = (n, j) => (tt < appear[j] ? 0 : Math.max(0.0001, easeOutBack(clamp((tt - appear[j]) / 0.55))));
    drawScene(ctx, g, {
      theme, font, color, X, Y, k,
      grow,
      radius: (n) => g.radius(cumAt(n.cum, ff)),
      pulse: (n) => {
        if (mi < 0 || tt > MAIN_END || !(n.activity[months[mi]] > 0)) return null;
        return ((tt - mStart[mi]) / md) % 1;
      },
      linkAlpha: (l) => clamp((tt - Math.max(appear[l.s], appear[l.t]) - 0.25) / 0.6),
      focus: null,
      labels: { box: { x0: 24, y0: M.y - 20, x1: W - 24, y1: M.y + M.h + 10 }, max: 10, size: Lay.labels.size, familySize: Lay.labels.family, minRadius: 9 },
    });

    // the running overlay: month, caption, counters, progress bar
    const ui = clamp((tt - (INTRO - 0.4)) / 0.6) * (1 - clamp((tt - MAIN_END - HOLD) / 0.6));
    if (ui > 0) {
      ctx.globalAlpha = ui;
      if (byline) text(ctx, byline.toUpperCase(), Lay.pad, Lay.byline.y, Lay.byline.size, { color: theme.muted, spacing: Lay.byline.size * 0.14 });
      text(ctx, monthName(months[Math.max(0, mi)]).toUpperCase(), Lay.pad - 4, Lay.month.y, Lay.month.size, { weight: 800, family: display, spacing: -Lay.month.size * 0.03 });

      const ms = mi >= 0 ? milestones.filter(([m]) => months[mi] >= m).at(-1) : null;
      // a caption stays up for eight months, or until the next one
      const since = ms ? tt - mStart[months.indexOf(ms[0])] : 0;
      if (ms && since < 8 * md + 0.4) {
        const a = clamp(since / 0.4) * (1 - clamp((since - 8 * md) / 0.4));
        const dy = (1 - a) * 16;
        ctx.globalAlpha = ui * a;
        const C = Lay.cap;
        ctx.font = `750 ${C.size}px ${display}`;
        text(ctx, ms[1], C.x, C.y + dy, C.size, { weight: 750, family: display });
        if (ms[2]) {
          ctx.font = `400 ${C.sub}px ${font}`;
          wrap(ctx, ms[2], C.w).slice(0, 2).forEach((ln, q) => text(ctx, ln, C.x, C.y + dy + C.sub * 1.35 * (q + 1), C.sub, { weight: 400, color: theme.secondary }));
        }
        ctx.globalAlpha = ui;
      }

      const S = Lay.stats;
      const visIdx = g.nodes.map((_, j) => j).filter((j) => tt >= appear[j]);
      const colW = S.w / S.cols;
      stats.forEach(([key, name], q) => {
        const x = S.x + (q % S.cols) * colW, y = S.y + Math.floor(q / S.cols) * S.row;
        text(ctx, short(statValue(key, ff, visIdx)), x, y + S.size, S.size, { weight: 750, family: display, spacing: -S.size * 0.02 });
        text(ctx, name, x, y + S.size + S.key * 1.25, S.key, { weight: 400, color: theme.muted });
      });

      const B = Lay.bar;
      ctx.fillStyle = theme.track;
      ctx.beginPath(); ctx.roundRect(B.x, B.y, B.w, 6, 3); ctx.fill();
      ctx.fillStyle = theme.secondary;
      ctx.beginPath(); ctx.roundRect(B.x, B.y, B.w * clamp((tt - INTRO) / (MAIN_END - INTRO)), 6, 3); ctx.fill();
      months.forEach((m, q) => {
        if (q === 0 || !m.endsWith('-01')) return;
        text(ctx, m.slice(0, 4), B.x + (q / months.length) * B.w, B.y - 12, B.tick, { weight: 400, color: theme.muted, align: 'center' });
      });
      ctx.globalAlpha = 1;
    }

    // intro
    const introA = 1 - clamp((tt - (INTRO - 0.7)) / 0.6);
    if (introA > 0) {
      const I = Lay.intro;
      ctx.globalAlpha = introA;
      const dy = (1 - clamp(tt / 0.8)) * 30;
      ctx.font = `800 ${I.size}px ${display}`;
      const lines = wrap(ctx, title, I.w);
      const lh = I.size * 1.04;
      const block = lines.length * lh + I.sub * 1.6 + I.by * 2.6;
      let y = (H - block) / 2 + I.size * 0.8 + dy;
      for (const ln of lines) { text(ctx, ln, Lay.pad + 16, y, I.size, { weight: 800, family: display, spacing: -I.size * 0.035 }); y += lh; }
      y += I.sub * 0.6;
      ctx.font = `400 ${I.sub}px ${font}`;
      text(ctx, subtitle, Lay.pad + 16, y, I.sub, { weight: 400, color: theme.secondary });
      if (byline) text(ctx, byline.toUpperCase(), Lay.pad + 16, y + I.by * 2.6, I.by, { color: theme.muted, spacing: I.by * 0.14 });
      ctx.globalAlpha = 1;
    }

    // outro: the totals
    const oa = clamp((tt - MAIN_END - HOLD) / 0.8);
    if (oa > 0) {
      const O = Lay.outro;
      ctx.fillStyle = rgba(theme.page, 0.9 * oa);
      ctx.fillRect(0, 0, W, H);
      const rows = Math.ceil(stats.length / O.cols);
      const rowH = O.value * 1.55;
      const block = O.size * 1.6 + rows * rowH + (byline ? O.key * 3 : 0) + (opts.credit ? O.key * 2.2 : 0);
      let y = (H - block) / 2 + O.size * 0.8;
      const x0 = Lay.pad + 16;
      ctx.globalAlpha = oa;
      text(ctx, opts.outroTitle || 'The whole map', x0, y, O.size, { weight: 800, family: display, spacing: -O.size * 0.03 });
      y += O.size * 0.9;
      const colW = (W - x0 * 2) / O.cols;
      stats.forEach(([key, name], q) => {
        const a = clamp((tt - MAIN_END - HOLD - 0.4 - q * 0.18) / 0.5);
        ctx.globalAlpha = a;
        const x = x0 + (q % O.cols) * colW, yy = y + Math.floor(q / O.cols) * rowH + (1 - a) * 20;
        text(ctx, short(key === 'projects' || key === 'clients' ? t[key] : t[key] || 0), x, yy + O.value, O.value, { weight: 800, family: display, spacing: -O.value * 0.03 });
        text(ctx, name, x, yy + O.value + O.key * 1.3, O.key, { weight: 400, color: theme.secondary });
      });
      ctx.globalAlpha = oa;
      y += rows * rowH + O.key * 2.4;
      if (byline) { text(ctx, byline.toUpperCase(), x0, y, O.key, { color: theme.muted, spacing: O.key * 0.14 }); y += O.key * 2.2; }
      if (opts.credit) text(ctx, opts.credit, x0, y, O.key * 0.85, { weight: 400, color: theme.muted });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return { width: W, height: H, fps, duration, frames, draw, format };
}
