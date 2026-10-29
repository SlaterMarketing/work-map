// The interactive map: pan, zoom, hover for details, click to highlight a node's connections,
// and a timeline to watch it grow. mountMap(container, graph) fills the container.

import { neighbours } from './graph.js';
import { DEFAULT_FONT, THEMES, clamp, cumAt, drawScene, familyColor } from './scene.js';

const CSS = `
.wm-root{position:relative;width:100%;height:100%;overflow:hidden;font:13px/1.45 var(--wm-font);color:var(--wm-text);background:var(--wm-page);touch-action:none}
.wm-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
.wm-root canvas.wm-drag{cursor:grabbing}
.wm-tip{position:absolute;z-index:3;pointer-events:none;background:var(--wm-surface);border:1px solid var(--wm-border);border-radius:8px;padding:8px 10px;max-width:280px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:none}
.wm-tip b{display:block;font-size:13px}
.wm-tip span{display:block;color:var(--wm-muted);font-size:12px}
.wm-legend{position:absolute;z-index:2;left:12px;top:12px;display:flex;flex-wrap:wrap;gap:4px 12px;max-width:calc(100% - 24px);font-size:12px;color:var(--wm-secondary)}
.wm-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:0}
.wm-bar{position:absolute;z-index:2;left:12px;right:12px;bottom:12px;display:flex;align-items:center;gap:12px;background:var(--wm-surface);border:1px solid var(--wm-border);border-radius:10px;padding:8px 12px}
.wm-bar button{flex:none;width:32px;height:28px;border-radius:6px;border:1px solid var(--wm-border);background:transparent;color:inherit;cursor:pointer;font:inherit}
.wm-bar input{flex:1;min-width:0;accent-color:var(--wm-accent)}
.wm-when{flex:none;min-width:150px;font-variant-numeric:tabular-nums}
.wm-when b{display:block}
.wm-when span{color:var(--wm-muted);font-size:12px}
`;

const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const monthName = (k) => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let styled = false;

/** opts: { theme: 'dark' | 'light', font, timeline: true, legend: true, onSelect(node) } */
export function mountMap(container, graph, opts = {}) {
  if (!styled && typeof document !== 'undefined') {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    styled = true;
  }
  const theme = THEMES[opts.theme] || THEMES.dark;
  const font = opts.font || DEFAULT_FONT;
  const root = document.createElement('div');
  root.className = 'wm-root';
  Object.entries({ page: theme.page, surface: theme.surface, text: theme.text, secondary: theme.secondary, muted: theme.muted, accent: theme.series[0] })
    .forEach(([k, v]) => root.style.setProperty(`--wm-${k}`, v));
  root.style.setProperty('--wm-border', opts.theme === 'light' ? 'rgba(11,11,11,.1)' : 'rgba(255,255,255,.1)');
  root.style.setProperty('--wm-font', font);
  root.innerHTML = `<canvas aria-label="Map of projects and clients and how they connect" role="img"></canvas>
    <div class="wm-legend"></div><div class="wm-tip"></div>
    <div class="wm-bar"><button type="button" aria-label="Play the timeline">▶</button><div class="wm-when"></div><input type="range" min="0" aria-label="Month"></div>`;
  container.appendChild(root);
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const tip = root.querySelector('.wm-tip');
  const legend = root.querySelector('.wm-legend');
  const bar = root.querySelector('.wm-bar');
  const playBtn = bar.querySelector('button');
  const range = bar.querySelector('input');
  const when = bar.querySelector('.wm-when');
  if (opts.timeline === false) bar.style.display = 'none';
  if (opts.legend === false) legend.style.display = 'none';

  let g, color, month, cam = { cx: 0, cy: 0, k: 1 }, hover = -1, selected = -1, focus = null, playing = null, raf = 0, w = 0, h = 0;

  function setGraph(next) {
    g = next;
    color = familyColor(g, theme);
    month = g.months.length - 1;
    range.max = String(g.months.length - 1);
    range.value = String(month);
    selected = hover = -1;
    focus = null;
    drawLegend();
    resize();
    fit();
  }
  const drawLegend = () => {
    legend.innerHTML = g.families.map((f) => `<span><i style="background:${color(f)}"></i>${esc(g.familyLabels[f] || f)}</span>`).join('');
  };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = root.clientWidth; h = root.clientHeight;
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function fit() {
    if (!g.nodes.length || w < 50) return;
    const top = legend.offsetHeight + 24, bottom = opts.timeline === false ? 20 : bar.offsetHeight + 28;
    const x0 = Math.min(...g.nodes.map((n) => n.x - n.r)), x1 = Math.max(...g.nodes.map((n) => n.x + n.r));
    const y0 = Math.min(...g.nodes.map((n) => n.y - n.r)), y1 = Math.max(...g.nodes.map((n) => n.y + n.r));
    const k = Math.min((w - 40) / (x1 - x0 + 60), (h - top - bottom) / (y1 - y0 + 60), 2.5);
    cam = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (top - bottom) / 2 / k, k };
    redraw();
  }

  const X = (x) => w / 2 + (x - cam.cx) * cam.k;
  const Y = (y) => h / 2 + (y - cam.cy) * cam.k;
  const shown = (n) => n.first <= month;
  const now = () => month < g.months.length - 1;
  const radius = (n) => g.radius(cumAt(n.cum, month + 1));

  function draw() {
    raf = 0;
    ctx.fillStyle = theme.page;
    ctx.fillRect(0, 0, w, h);
    const k = month;
    const phase = (performance.now() / 1600) % 1;
    const pulsing = now();
    drawScene(ctx, g, {
      theme, font, color, X, Y, k: cam.k,
      grow: (n) => (shown(n) ? 1 : 0),
      radius,
      pulse: (n) => (pulsing && n.activity[g.months[k]] > 0 ? phase : null),
      linkAlpha: () => 1,
      focus,
      focusIndex: selected >= 0 ? selected : hover,
      labels: { box: { x0: 0, y0: legend.offsetHeight + 8, x1: w, y1: h - (opts.timeline === false ? 0 : bar.offsetHeight + 16) }, max: 60, size: 12, familySize: 12, minRadius: cam.k >= 1.6 ? 0 : 7, always: focus || undefined },
    });
    const vis = g.nodes.filter(shown);
    const active = g.nodes.filter((n) => n.activity[g.months[k]] > 0).length;
    const p = vis.filter((n) => n.kind === 'project').length, c = vis.length - p;
    when.innerHTML = now()
      ? `<b>${monthName(g.months[k])}</b><span>${plural(p, 'project')}${c ? ` · ${plural(c, 'client')}` : ''} · ${active} active</span>`
      : `<b>All time</b><span>${plural(p, 'project')}${c ? ` · ${plural(c, 'client')}` : ''}</span>`;
    if (pulsing) redraw();
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function hit(px, py) {
    let best = -1, bestD = Infinity;
    g.nodes.forEach((n, i) => {
      if (!shown(n)) return;
      const d = Math.hypot(X(n.x) - px, Y(n.y) - py);
      if (d <= Math.max(6, radius(n) * cam.k + 3) && d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  function showTip(i, px, py) {
    if (i < 0) { tip.style.display = 'none'; return; }
    const n = g.nodes[i];
    const last = g.months.length - 1;
    const bits = [];
    if (n.series.commits) bits.push(plural(n.series.commits[last], 'commit'));
    if (n.series.meetings) bits.push(plural(n.series.meetings[last], 'meeting'));
    if (n.series.emails) bits.push(plural(n.series.emails[last], 'email'));
    const links = g.links.filter((l) => l.s === i || l.t === i).length;
    tip.innerHTML = `<b>${esc(n.label)}</b><span>${n.kind === 'client' ? 'Client · ' : ''}${esc(g.familyLabels[n.family] || n.family)}</span>
      <span>${bits.join(' · ')}</span><span>since ${monthName(g.months[n.first])} · ${plural(links, 'connection')}</span>`;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(px + 14, w - r.width - 8) + 'px';
    tip.style.top = Math.min(py + 14, h - r.height - 8) + 'px';
  }

  function setFocus() {
    const i = selected >= 0 ? selected : hover;
    focus = i >= 0 ? neighbours(g, i) : null;
    redraw();
  }

  // pointer: drag to pan, wheel or pinch to zoom, hover and click on nodes
  const pointers = new Map();
  let dragged = false, pinch = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    dragged = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    canvas.classList.add('wm-drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) {
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch);
        pinch = d;
      } else {
        const dx = p[0] - prev[0], dy = p[1] - prev[1];
        if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
        cam.cx -= dx / cam.k; cam.cy -= dy / cam.k;
      }
      tip.style.display = 'none';
      redraw();
      return;
    }
    const i = hit(...p);
    if (i !== hover) { hover = i; if (selected < 0) setFocus(); }
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
    showTip(i, ...p);
  });
  const up = (e) => {
    const wasDrag = dragged || pointers.size > 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    canvas.classList.remove('wm-drag');
    if (e.type === 'pointerup' && !wasDrag) {
      const i = hit(...local(e));
      selected = i === selected ? -1 : i;
      setFocus();
      opts.onSelect?.(selected >= 0 ? g.nodes[selected] : null);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { hover = -1; tip.style.display = 'none'; if (selected < 0) setFocus(); } });
  function zoomAt(px, py, factor) {
    const k = clamp(cam.k * factor, 0.1, 8);
    const wx = cam.cx + (px - w / 2) / cam.k, wy = cam.cy + (py - h / 2) / cam.k;
    cam = { k, cx: wx - (px - w / 2) / k, cy: wy - (py - h / 2) / k };
    redraw();
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(...local(e), Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', () => fit());

  // timeline
  const setMonth = (i) => { month = clamp(i, 0, g.months.length - 1); range.value = String(month); redraw(); };
  const stop = () => { clearInterval(playing); playing = null; playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play the timeline'); };
  range.addEventListener('input', () => { stop(); setMonth(Number(range.value)); });
  playBtn.addEventListener('click', () => {
    if (playing) return stop();
    if (month >= g.months.length - 1) setMonth(0);
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
    playing = setInterval(() => (month >= g.months.length - 1 ? stop() : setMonth(month + 1)), Math.max(120, 14000 / g.months.length));
  });

  const ro = new ResizeObserver(() => { const fresh = root.clientWidth !== w || root.clientHeight !== h; resize(); if (fresh) fit(); });
  ro.observe(root);
  setGraph(graph);

  return {
    update: setGraph,
    /** Redraw after labels change, keeping the view. */
    refresh() { drawLegend(); redraw(); },
    setMonth,
    fit,
    destroy() { stop(); ro.disconnect(); cancelAnimationFrame(raf); root.remove(); },
  };
}
