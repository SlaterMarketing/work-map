// Draws the map on a 2D canvas. Shared by the interactive map (map.js) and the video (video.js),
// which differ only in the camera, which nodes are visible, and how they animate in.

import { polygonHull } from 'd3-polygon';
import { curveCatmullRomClosed, line } from 'd3-shape';

export const THEMES = {
  dark: {
    page: '#0d0d0d', surface: '#1a1a19', text: '#f0efec', secondary: '#c3c2b7', muted: '#898781', track: '#232321',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'],
  },
  light: {
    page: '#f9f9f7', surface: '#fcfcfb', text: '#0b0b0b', secondary: '#52514e', muted: '#898781', track: '#e1e0d9',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#e34948'],
  },
};

export const DEFAULT_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const familyColor = (g, theme) => {
  const colors = Object.fromEntries(g.families.map((f, i) => [f, f === 'Other' ? theme.muted : theme.series[i % theme.series.length]]));
  return (fam) => colors[fam] || theme.muted;
};

export function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** Activity up to fractional month f: month i accrues while f goes from i to i + 1. */
export function cumAt(arr, f) {
  if (f < 0) return 0;
  const i = Math.min(arr.length - 1, Math.floor(f));
  const prev = i > 0 ? arr[i - 1] : 0;
  return prev + (arr[i] - prev) * Math.min(1, f - i);
}

const hullLine = line().curve(curveCatmullRomClosed.alpha(0.8));

/**
 * s: {
 *   theme, font, color(family),
 *   X(x), Y(y), k (zoom),
 *   grow(n) 0..1.2 (0 hides the node), radius(n) in world units,
 *   pulse(n) 0..1 phase or null, linkAlpha(l) 0..1,
 *   focus: Set of node indexes to keep bright, or null; focusIndex: the node they're around,
 *   labels: { box: {x0, y0, x1, y1}, max, size, familySize, minRadius, always: Set }
 * }
 */
export function drawScene(ctx, g, s) {
  const { theme, X, Y, k } = s;
  const vis = [];
  g.nodes.forEach((n, i) => { const gr = s.grow(n, i); if (gr > 0) vis.push({ n, i, gr, r: s.radius(n, i) * Math.min(gr, 1.2) * k }); });
  const dimmed = (i) => s.focus && !s.focus.has(i);
  const byIndex = new Map(vis.map((v) => [v.i, v]));

  // family hulls
  for (const fam of g.families) {
    const ns = vis.filter((v) => v.n.family === fam && v.gr > 0.3);
    if (ns.length < 2) continue;
    const pts = [];
    for (const v of ns) for (let a = 0; a < 10; a++) {
      const th = (a / 10) * Math.PI * 2, p = v.r + 16 * k;
      pts.push([X(v.n.x) + Math.cos(th) * p, Y(v.n.y) + Math.sin(th) * p]);
    }
    const h = polygonHull(pts);
    if (!h) continue;
    ctx.beginPath();
    hullLine.context(ctx)(h);
    ctx.fillStyle = rgba(s.color(fam), s.focus ? 0.03 : 0.07);
    ctx.fill();
    ctx.strokeStyle = rgba(s.color(fam), s.focus ? 0.12 : 0.3);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // links, curved slightly so parallel ones don't overlap
  ctx.lineCap = 'round';
  for (const l of g.links) {
    const a = byIndex.get(l.s), b = byIndex.get(l.t);
    if (!a || !b) continue;
    const touches = s.focus && (s.focus.has(l.s) && s.focus.has(l.t)) && (l.s === s.focusIndex || l.t === s.focusIndex);
    let alpha = s.linkAlpha(l) * (0.14 + l.w * 0.5);
    if (s.focus) alpha = touches ? 0.35 + l.w * 0.6 : alpha * 0.25;
    if (alpha <= 0.002) continue;
    const same = a.n.family === b.n.family || l.kind === 'client';
    ctx.strokeStyle = rgba(same ? s.color((a.n.kind === 'client' ? a : b).n.family) : theme.muted, alpha);
    ctx.lineWidth = Math.max(0.8, (0.6 + l.w * 3.2) * Math.sqrt(k));
    ctx.setLineDash(l.kind === 'stack' ? [5, 7] : []);
    const x1 = X(a.n.x), y1 = Y(a.n.y), x2 = X(b.n.x), y2 = Y(b.n.y);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2 + (y2 - y1) * 0.12, (y1 + y2) / 2 - (x2 - x1) * 0.12, x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // nodes, small first so big ones sit on top
  for (const v of vis.slice().sort((a, b) => a.n.total - b.n.total)) {
    const { n, i, r } = v;
    if (r <= 0.2) continue;
    const col = s.color(n.family), x = X(n.x), y = Y(n.y);
    ctx.globalAlpha = dimmed(i) ? 0.12 : 1;
    const ph = s.pulse(n, i);
    if (ph != null) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4 + ph * 14 * Math.sqrt(k), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(col, 0.7 * (1 - ph));
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.shadowColor = rgba(col, 0.55);
    ctx.shadowBlur = ph != null ? 18 : 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (n.kind === 'client') {
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.lineWidth = Math.max(2, Math.min(5, r * 0.22));
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, r * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      ctx.fillStyle = col;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // labels: family names first, then the biggest nodes, skipping any that would collide
  const L = s.labels;
  const placed = [];
  const fits = (b) => b.x0 > L.box.x0 && b.x1 < L.box.x1 && b.y0 > L.box.y0 && b.y1 < L.box.y1
    && !placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const label = (text, cx, cy, font, size, color, alpha = 1) => {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    cx = clamp(cx, L.box.x0 + 6 + w / 2, L.box.x1 - 6 - w / 2);
    const b = { x0: cx - w / 2 - 6, x1: cx + w / 2 + 6, y0: cy - size, y1: cy + size * 0.25 };
    if (!fits(b)) return false;
    placed.push(b);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.page;
    ctx.lineWidth = Math.max(3, size * 0.27);
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
    ctx.globalAlpha = 1;
    return true;
  };

  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(L.familySize * 0.08)}px`;
  for (const fam of g.families) {
    const ns = vis.filter((v) => v.n.family === fam && v.gr > 0.5);
    if (ns.length < 2 || s.focus) continue;
    const top = Math.min(...ns.map((v) => Y(v.n.y) - v.r)) - L.familySize;
    const cx = ns.reduce((a, v) => a + X(v.n.x), 0) / ns.length;
    label((g.familyLabels[fam] || fam).toUpperCase(), cx, top, `700 ${L.familySize}px ${s.font}`, L.familySize, theme.secondary);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  const candidates = vis
    .filter((v) => (L.always && L.always.has(v.i)) || (!dimmed(v.i) && v.r >= L.minRadius))
    .sort((a, b) => (L.always?.has(b.i) ? 1 : 0) - (L.always?.has(a.i) ? 1 : 0) || b.r - a.r);
  let shown = 0;
  for (const v of candidates) {
    if (shown >= L.max) break;
    const size = v.r > 30 ? L.size * 1.2 : L.size;
    const alpha = clamp((v.gr - 0.5) * 2);
    if (label(v.n.label, X(v.n.x), Y(v.n.y) + v.r + size * 1.15, `${v.n.kind === 'client' ? 'italic ' : ''}600 ${size}px ${s.font}`, size, theme.text, alpha)) shown++;
  }
}
