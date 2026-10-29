// The whole tool in one component: the map, the video preview, label editing (with anonymous
// labels on by default) and the video download. Used by the CLI's HTML file and by the website.
//
// mountStudio(container, data, opts) — data is work-map data (see graph.js).
// opts: { theme, font, displayFont, byline, credit, anonymise (default true), filename,
//         beforeDownload({ graph, video, format }) → Promise<boolean>   (false cancels, e.g. an email gate)
//         onDownloaded({ graph, format, type }) }

import { anonymousLabels } from './anonymise.js';
import { exportVideo, download, canExportVideo } from './export.js';
import { buildGraph } from './graph.js';
import { mountMap } from './map.js';
import { DEFAULT_FONT, THEMES } from './scene.js';
import { createVideo, FORMATS } from './video.js';

const CSS = `
.wms{display:grid;grid-template-rows:auto 1fr;height:100%;min-height:520px;font:14px/1.45 var(--wms-font);color:var(--wms-text);background:var(--wms-page);border-radius:inherit;overflow:hidden}
.wms-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--wms-border)}
.wms-tabs{display:inline-flex;border:1px solid var(--wms-border);border-radius:8px;overflow:hidden}
.wms-tabs button,.wms-btn{font:inherit;color:inherit;background:transparent;border:0;padding:6px 12px;cursor:pointer}
.wms-tabs button[aria-pressed=true]{background:var(--wms-surface);font-weight:600}
.wms-btn{border:1px solid var(--wms-border);border-radius:8px}
.wms-btn:hover,.wms-tabs button:hover{background:var(--wms-surface)}
.wms-primary{background:var(--wms-accent);color:var(--wms-on-accent);border-color:transparent;font-weight:600}
.wms-primary:hover{background:var(--wms-accent);filter:brightness(1.08)}
.wms-primary:disabled{opacity:.6;cursor:progress}
.wms-check{display:inline-flex;align-items:center;gap:6px;color:var(--wms-secondary);cursor:pointer}
.wms-check input{accent-color:var(--wms-accent)}
.wms select{font:inherit;color:inherit;background:var(--wms-page);border:1px solid var(--wms-border);border-radius:8px;padding:5px 8px}
.wms-spacer{flex:1}
.wms-body{position:relative;min-height:0}
.wms-pane{position:absolute;inset:0}
.wms-pane[hidden]{display:none}
.wms-video{display:flex;align-items:center;justify-content:center;padding:16px;gap:16px;flex-direction:column}
.wms-video canvas{max-width:100%;max-height:calc(100% - 48px);box-shadow:0 10px 40px rgba(0,0,0,.35);border-radius:6px;background:#000}
.wms-vctl{display:flex;align-items:center;gap:10px;width:min(100%,560px)}
.wms-vctl input{flex:1;accent-color:var(--wms-accent)}
.wms-vctl span{font-variant-numeric:tabular-nums;color:var(--wms-muted);min-width:84px;text-align:right}
.wms-labels{position:absolute;top:0;right:0;bottom:0;width:min(380px,100%);z-index:5;background:var(--wms-page);border-left:1px solid var(--wms-border);overflow:auto;padding:14px 14px 24px;transform:translateX(105%);transition:transform .2s}
.wms-labels.open{transform:none}
.wms-labels h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--wms-muted);margin:16px 0 6px}
.wms-labels h3:first-of-type{margin-top:4px}
.wms-labels p{margin:0 0 8px;color:var(--wms-secondary);font-size:13px}
.wms-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:3px 0}
.wms-row input[type=text]{font:inherit;color:inherit;background:var(--wms-surface);border:1px solid var(--wms-border);border-radius:6px;padding:4px 8px;min-width:0}
.wms-row small{color:var(--wms-muted);grid-column:2;margin-top:-4px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wms-dot{width:10px;height:10px;border-radius:50%}
.wms-ring{width:10px;height:10px;border-radius:50%;border:2.5px solid;box-sizing:border-box}
.wms-hide{font-size:12px;color:var(--wms-muted);display:flex;gap:4px;align-items:center}
.wms-note{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:6;background:var(--wms-surface);border:1px solid var(--wms-border);border-radius:8px;padding:8px 14px;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90%}
.wms-progress{display:block;height:4px;border-radius:2px;background:var(--wms-border);margin-top:6px;overflow:hidden}
.wms-progress i{display:block;height:100%;background:var(--wms-accent);width:0}
`;

let styled = false;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function mountStudio(container, data, opts = {}) {
  if (!styled) { document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS })); styled = true; }
  const themeName = opts.theme === 'light' ? 'light' : 'dark';
  const theme = THEMES[themeName];
  const font = opts.font || DEFAULT_FONT;
  const root = document.createElement('div');
  root.className = 'wms';
  const vars = { page: theme.page, surface: theme.surface, text: theme.text, secondary: theme.secondary, muted: theme.muted, accent: theme.series[0], 'on-accent': '#fff', border: themeName === 'light' ? 'rgba(11,11,11,.12)' : 'rgba(255,255,255,.12)', font };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--wms-${k}`, v);
  root.innerHTML = `
    <div class="wms-bar">
      <span class="wms-tabs"><button type="button" data-tab="map" aria-pressed="true">Map</button><button type="button" data-tab="video" aria-pressed="false">Video</button></span>
      <label class="wms-check"><input type="checkbox" data-anon ${opts.anonymise === false ? '' : 'checked'}> Anonymous labels</label>
      <button type="button" class="wms-btn" data-edit>Edit labels</button>
      <span class="wms-spacer"></span>
      <select data-format aria-label="Video format">
        <option value="vertical">Vertical 9:16</option><option value="square">Square 1:1</option><option value="landscape">Landscape 16:9</option>
      </select>
      <button type="button" class="wms-btn wms-primary" data-download>Download video</button>
    </div>
    <div class="wms-body">
      <div class="wms-pane" data-pane="map"></div>
      <div class="wms-pane wms-video" data-pane="video" hidden>
        <canvas></canvas>
        <div class="wms-vctl"><button type="button" class="wms-btn" data-play aria-label="Pause">❚❚</button><input type="range" min="0" step="1" aria-label="Video position"><span></span></div>
      </div>
      <aside class="wms-labels" aria-label="Labels"></aside>
    </div>`;
  container.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const mapPane = $('[data-pane=map]'), videoPane = $('[data-pane=video]'), labelsPane = $('.wms-labels');
  const anon = $('[data-anon]'), formatSel = $('[data-format]'), dlBtn = $('[data-download]');
  const vCanvas = videoPane.querySelector('canvas'), vRange = videoPane.querySelector('input'), vTime = videoPane.querySelector('.wms-vctl span'), vPlay = $('[data-play]');
  if (opts.format && FORMATS[opts.format]) formatSel.value = opts.format;

  let hidden = new Set();
  let base = buildGraph(data, { hidden });           // real labels, for the anonymiser and the editor
  let edits = {};                                     // labels the person typed, by id
  let graph, video, map, tab = 'map', frame = 0, playing = true, raf = 0, last = 0;

  const labelsNow = () => ({ ...(anon.checked ? anonymousLabels(base) : {}), ...edits });
  function rebuild(relayout) {
    if (relayout) base = buildGraph(data, { hidden });
    graph = buildGraph(data, { hidden, labels: labelsNow() });
    if (map) map.update(graph); else map = mountMap(mapPane, graph, { theme: themeName, font });
    makeVideo();
    renderLabels();
  }
  // Label edits only change text, so they skip the layout.
  function relabel() {
    const labels = labelsNow();
    for (const n of graph.nodes) n.label = labels[n.id] ?? n.realLabel;
    for (const f of graph.families) graph.familyLabels[f] = labels['family:' + f] ?? f;
    map.refresh();
    makeVideo();
  }

  function makeVideo() {
    video = createVideo(graph, { format: formatSel.value, theme: themeName, font, displayFont: opts.displayFont, byline: opts.byline ?? graph.name, credit: opts.credit, title: opts.title });
    vCanvas.width = video.width; vCanvas.height = video.height;
    vRange.max = String(video.frames - 1);
    frame = Math.min(frame, video.frames - 1);
    paint();
  }
  function paint() {
    video.draw(vCanvas.getContext('2d'), frame);
    vRange.value = String(frame);
    vTime.textContent = `${clock(frame / video.fps)} / ${clock(video.duration)}`;
  }
  function loop(ts) {
    raf = 0;
    if (tab !== 'video' || !playing) return;
    if (ts - last >= 1000 / video.fps - 2) { last = ts; frame = (frame + 1) % video.frames; paint(); }
    raf = requestAnimationFrame(loop);
  }
  const startLoop = () => { if (!raf && playing && tab === 'video') raf = requestAnimationFrame(loop); };

  function renderLabels() {
    const fams = graph.families;
    const real = new Map(base.nodes.map((n) => [n.id, n.label]));
    const rows = [...base.nodes, ...data.items.filter((i) => hidden.has(i.id)).map((i) => ({ id: i.id, label: i.label, kind: i.kind, family: null, total: 0 }))]
      .sort((a, b) => b.total - a.total);
    const colorOf = (fam) => (fam && fams.includes(fam) ? (fam === 'Other' ? theme.muted : theme.series[fams.indexOf(fam) % theme.series.length]) : theme.muted);
    const current = new Map(graph.nodes.map((n) => [n.id, n.label]));
    labelsPane.innerHTML = `
      <button type="button" class="wms-btn" data-close style="float:right">Done</button>
      <h3>Labels</h3><p>What the map and video show. Real names stay on your device.</p>
      <h3>Families</h3>
      ${fams.map((f) => `<div class="wms-row"><span class="wms-dot" style="background:${colorOf(f)}"></span>
        <input type="text" data-fam="${esc(f)}" value="${esc(graph.familyLabels[f])}" aria-label="Label for ${esc(f)}"><span></span>
        ${graph.familyLabels[f] !== f ? `<small>${esc(f)}</small>` : ''}</div>`).join('')}
      <h3>Projects and clients</h3>
      ${rows.map((n) => {
        const off = hidden.has(n.id);
        const realLabel = real.get(n.id) ?? n.label;
        const shown = current.get(n.id) ?? realLabel;
        return `<div class="wms-row"><span class="${n.kind === 'client' ? 'wms-ring' : 'wms-dot'}" style="${n.kind === 'client' ? 'border-color' : 'background'}:${colorOf(n.family)}"></span>
        <input type="text" data-id="${esc(n.id)}" value="${esc(shown)}" ${off ? 'disabled' : ''} aria-label="Label for ${esc(realLabel)}">
        <label class="wms-hide"><input type="checkbox" data-hide="${esc(n.id)}" ${off ? 'checked' : ''}>hide</label>
        ${shown !== realLabel ? `<small>${esc(realLabel)}</small>` : ''}</div>`;
      }).join('')}`;
  }

  labelsPane.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.id) edits[el.dataset.id] = el.value;
    else if (el.dataset.fam) edits['family:' + el.dataset.fam] = el.value;
    else return;
    relabel();
  });
  labelsPane.addEventListener('change', (e) => {
    const id = e.target.dataset.hide;
    if (!id) return;
    if (e.target.checked) hidden.add(id); else hidden.delete(id);
    if (hidden.size >= data.items.length) { hidden.delete(id); e.target.checked = false; return; }
    rebuild(true);
  });
  labelsPane.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) labelsPane.classList.remove('open'); });
  $('[data-edit]').addEventListener('click', () => labelsPane.classList.toggle('open'));
  anon.addEventListener('change', () => { edits = {}; relabel(); renderLabels(); });
  formatSel.addEventListener('change', () => { frame = 0; makeVideo(); });

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    mapPane.hidden = tab !== 'map';
    videoPane.hidden = tab !== 'video';
    if (tab === 'video') { paint(); startLoop(); } else map.fit();
  }));
  vPlay.addEventListener('click', () => {
    playing = !playing;
    vPlay.textContent = playing ? '❚❚' : '▶';
    vPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    startLoop();
  });
  vRange.addEventListener('input', () => { frame = Number(vRange.value); paint(); });

  function note(html, ms) {
    root.querySelector('.wms-note')?.remove();
    const el = Object.assign(document.createElement('div'), { className: 'wms-note', innerHTML: html });
    $('.wms-body').appendChild(el);
    if (ms) setTimeout(() => el.remove(), ms);
    return el;
  }

  dlBtn.addEventListener('click', async () => {
    if (!canExportVideo()) return note("This browser can't make videos. Try Chrome, Edge or Safari.", 6000);
    const format = formatSel.value;
    if (opts.beforeDownload && !(await opts.beforeDownload({ graph, video, format }))) return;
    dlBtn.disabled = true;
    const was = dlBtn.textContent;
    const el = note('Making your video… <span class="wms-progress"><i></i></span>');
    const bar = el.querySelector('i');
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const out = await exportVideo(video, { onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; dlBtn.textContent = `${Math.round(p * 100)}%`; } });
      download(out.blob, `${opts.filename || 'work-map'}-${format}.${out.extension}`);
      note('Saved. Add a music track in the app you post from.', 6000);
      opts.onDownloaded?.({ graph, format, type: out.type });
    } catch (err) {
      note(esc(err.message || 'The video could not be made.'), 8000);
    } finally {
      dlBtn.disabled = false;
      dlBtn.textContent = was;
    }
  });

  rebuild(false);
  return {
    get graph() { return graph; },
    get video() { return video; },
    setData(next) { data = next; hidden = new Set(); edits = {}; rebuild(true); },
    destroy() { cancelAnimationFrame(raf); map.destroy(); root.remove(); },
  };
}
