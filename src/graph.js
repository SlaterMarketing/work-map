// Turns work-map data (projects and clients with monthly activity) into a laid-out graph:
// nodes with positions and sizes, the links between them, families and the month range.
//
// Input format (version 1):
//   {
//     version: 1,
//     name: "Ada Lovelace",                 // shown as the byline
//     generated: "2026-10-28",              // the last month shown
//     items: [{
//       id: "gh:ada/engine",                // unique
//       label: "engine",
//       kind: "project" | "client",
//       series: { commits: { "2024-03": 12, ... }, meetings: {...}, deals: {...}, ... },   (see series.js)
//       group?: "Engine",                   // family; worked out from the links when missing
//       owner?, language?, tags?: [...], public?: true, url?, description?, domain?
//     }],
//     links?: [{ source: id, target: id, kind: "client" | "name" | "mention" | "stack", weight: 0..1 }],
//     series?: { connections: {...} },      // counts that belong to no one node, for the video's counters
//     currency?: "£",                      // for revenue and spend
//     terms?: { project: ["campaign", "campaigns"], client: ["company", "companies"] }
//   }
// Links of kind "name", "client" and "stack" are also inferred from the items unless
// opts.inferLinks is false.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { seriesWeight } from './series.js';

export const MAX_FAMILIES = 7;
export const DEFAULT_TERMS = { project: ['project', 'projects'], client: ['client', 'clients'] };

export const monthOf = (date) => String(date).slice(0, 7);

export function monthRange(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ey, em] = last.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// Words that say nothing about which product a repo belongs to.
const GENERIC = new Set(('app apps web api site www my the a test tests demo new old next server client frontend backend ' +
  'front back mobile ios android ui lib libs core docs doc website landing dashboard admin tools tool bot service services ' +
  'worker workers scripts script config dotfiles project projects repo code hello world example examples sample starter ' +
  'template react vue svelte node python go rust js ts main dev prod staging v1 v2 v3 public private internal infra ' +
  'shared common utils util data db cli sdk plugin extension theme').split(' '));

export const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t));
/** The word a repo or client is most likely known by: "orbit-forms-api" → "orbit". */
export const stemOf = (label) => tokens(label)[0] || null;

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Monthly activity for an item: its series weighted and added up. */
export function activityOf(item) {
  const out = {};
  for (const [name, months] of Object.entries(item.series || {})) {
    const w = seriesWeight(name);
    for (const [k, v] of Object.entries(months || {})) if (v > 0) out[k] = (out[k] || 0) + v * w;
  }
  return out;
}

/**
 * Links from what the items share: a name ("orbit" and "orbit-forms-api"), a client's domain
 * in a project's name or description, or a stack (tags such as dependencies and topics).
 */
export function inferLinks(items) {
  const links = [];
  const projects = items.filter((i) => i.kind !== 'client');
  const clients = items.filter((i) => i.kind === 'client');
  const stems = new Map(projects.map((p) => [p.id, stemOf(p.label)]));

  for (let a = 0; a < projects.length; a++) {
    for (let b = a + 1; b < projects.length; b++) {
      const p = projects[a], q = projects[b];
      const sp = stems.get(p.id), sq = stems.get(q.id);
      if (sp && sp === stems.get(q.id) && sp.length >= 4) {
        links.push({ source: p.id, target: q.id, kind: 'name', weight: 0.85 });
        continue;
      }
      const tp = new Set(p.tags || []), tq = new Set(q.tags || []);
      if (tp.size >= 3 && tq.size >= 3) {
        let shared = 0;
        for (const t of tp) if (tq.has(t)) shared++;
        const jaccard = shared / (tp.size + tq.size - shared);
        if (jaccard >= 0.3 && shared >= 3) links.push({ source: p.id, target: q.id, kind: 'stack', weight: Math.min(0.8, jaccard) });
      }
    }
  }
  // Keep each project's three strongest stack links, or shared frameworks turn the map into a hairball.
  const stack = links.filter((l) => l.kind === 'stack').sort((x, y) => y.weight - x.weight);
  const count = new Map();
  const keep = new Set();
  for (const l of stack) {
    const ca = count.get(l.source) || 0, cb = count.get(l.target) || 0;
    if (ca < 3 && cb < 3) { keep.add(l); count.set(l.source, ca + 1); count.set(l.target, cb + 1); }
  }

  // A client's name or domain in a project's name or description: "acme-shopify-theme" for Acme Studio.
  for (const c of clients) {
    const stems = [stemOf(c.domain), stemOf(c.label)].filter((s) => s && s.length >= 4);
    if (!stems.length) continue;
    for (const p of projects) {
      const words = new Set([...tokens(p.label), ...tokens(p.description)]);
      if (stems.some((s) => words.has(s))) links.push({ source: c.id, target: p.id, kind: 'client', weight: 0.7 });
    }
  }
  return links.filter((l) => l.kind !== 'stack' || keep.has(l));
}

/** Links from one project naming another in its README or manifest. texts: Map of id → text. */
export function mentionLinks(items, texts) {
  const links = [];
  const projects = items.filter((i) => i.kind !== 'client' && i.label.length >= 4);
  for (const p of projects) {
    const text = texts.get(p.id);
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const q of projects) {
      if (q === p || stemOf(q.label) === stemOf(p.label)) continue;
      const name = q.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hits = lower.match(new RegExp(`(^|[^a-z0-9-])${name}($|[^a-z0-9-])`, 'g'));
      if (hits) links.push({ source: p.id, target: q.id, kind: 'mention', weight: Math.min(0.8, 0.35 + hits.length * 0.1) });
    }
  }
  return links;
}

function familiesOf(items, links, terms) {
  // Families: groups of items joined by a shared name or by client work, named after their best-known
  // member. Whatever is left is grouped by owner (an organisation) or language, then the smallest
  // families are merged into "Other" so each one keeps a distinct colour.
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const l of links) if (l.kind === 'name' || l.kind === 'client') parent.set(find(l.source), find(l.target));

  const comps = new Map();
  for (const i of items) {
    if (i.group) continue;
    const r = find(i.id);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  }
  const fam = new Map(items.filter((i) => i.group).map((i) => [i.id, i.group]));
  const owners = new Set(items.map((i) => i.owner).filter(Boolean));
  // Lots of unconnected companies (a sales pipeline, say) are grouped by the year they first
  // appear, so the map shows each year's intake; a few just sit together.
  // Companies you only know through LinkedIn are your network, not clients.
  const networkOnly = (i) => Object.keys(i.series || {}).every((k) => k === 'connections');
  const loose = [...comps.values()].filter((m) => m.length === 1 && m[0].kind === 'client' && !networkOnly(m[0])).map((m) => m[0]);
  const firstYear = (i) => Object.keys(i.activity).sort()[0]?.slice(0, 4) || '';
  const byYear = loose.length > 8 && new Set(loose.map(firstYear)).size > 1;
  const Clients = terms.client[1].charAt(0).toUpperCase() + terms.client[1].slice(1);
  for (const members of comps.values()) {
    if (members.length >= 2) {
      const client = members.find((m) => m.kind === 'client');
      const stems = members.map((m) => stemOf(m.label)).filter(Boolean);
      const common = stems.sort((a, b) => stems.filter((s) => s === b).length - stems.filter((s) => s === a).length)[0];
      const name = client ? client.label : titleCase(common || members[0].label);
      for (const m of members) fam.set(m.id, name);
    } else {
      const m = members[0];
      fam.set(m.id, m.kind === 'client' ? networkOnly(m) ? 'Network' : (byYear ? `${Clients} from ${firstYear(m)}` : Clients) : owners.size > 1 && m.owner ? m.owner : m.language ? `${m.language} projects` : 'Projects');
    }
  }
  return fam;
}

/**
 * opts.labels: { [itemId]: label, ["family:" + name]: label } overrides, for anonymising and editing.
 * opts.hidden: Set of item ids to leave out.
 */
export function buildGraph(data, opts = {}) {
  const labels = opts.labels || {};
  const hidden = opts.hidden || new Set();
  const items = (data.items || [])
    .filter((i) => !hidden.has(i.id))
    .map((i) => ({ ...i, activity: activityOf(i) }))
    .filter((i) => sum(i.activity) > 0);

  const ids = new Set(items.map((i) => i.id));
  const rawLinks = [...(data.links || []), ...(opts.inferLinks === false ? [] : inferLinks(items))]
    .filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target);
  // One link per pair, keeping the strongest.
  const pairs = new Map();
  for (const l of rawLinks) {
    const key = [l.source, l.target].sort().join('|');
    if (!pairs.has(key) || pairs.get(key).weight < l.weight) pairs.set(key, l);
  }

  const terms = { ...DEFAULT_TERMS, ...(data.terms || {}) };
  const fam = familiesOf(items, [...pairs.values()], terms);
  const famTotals = new Map();
  for (const i of items) famTotals.set(fam.get(i.id), (famTotals.get(fam.get(i.id)) || 0) + sum(i.activity));
  let families = [...famTotals.keys()].sort((a, b) => famTotals.get(b) - famTotals.get(a));
  if (families.length > MAX_FAMILIES) {
    const keep = new Set(families.filter((f) => f !== 'Other').slice(0, MAX_FAMILIES - 1));
    for (const i of items) if (!keep.has(fam.get(i.id))) fam.set(i.id, 'Other');
    families = [...keep, 'Other'];
  }

  const allKeys = [...items.flatMap((i) => Object.keys(i.activity)), ...Object.values(data.series || {}).flatMap((m) => Object.keys(m))].sort();
  const last = monthOf(data.generated || new Date().toISOString());
  const first = opts.start || data.start || allKeys[0] || last;
  const months = monthRange(first < last ? first : last, last);
  const index = new Map(months.map((k, i) => [k, i]));

  const cumulative = (series) => {
    const out = new Float64Array(months.length);
    let run = 0;
    for (const [k, v] of Object.entries(series || {})) if (k < months[0]) run += v;
    months.forEach((k, i) => { run += (series || {})[k] || 0; out[i] = run; });
    return out;
  };

  const nodes = items.map((i) => {
    const keys = Object.keys(i.activity).sort();
    const cum = cumulative(i.activity);
    return {
      id: i.id,
      label: labels[i.id] ?? i.label,
      realLabel: i.label,
      kind: i.kind === 'client' ? 'client' : 'project',
      family: fam.get(i.id),
      first: Math.max(0, index.get(keys[0]) ?? 0),
      activity: i.activity,
      cum,
      total: cum[cum.length - 1],
      series: Object.fromEntries(Object.keys(i.series || {}).map((k) => [k, cumulative(i.series[k])])),
      public: Boolean(i.public),
      grouped: Boolean(i.group),
      language: i.language || null,
      url: i.url || null,
      description: i.description || '',
    };
  });
  const byId = new Map(nodes.map((n, idx) => [n.id, idx]));
  const links = [...pairs.values()].map((l) => ({ s: byId.get(l.source), t: byId.get(l.target), kind: l.kind, w: l.weight }));

  const maxTotal = Math.max(1, ...nodes.map((n) => n.total));
  const radius = (cum) => 4 + 34 * Math.sqrt(cum / maxTotal);
  for (const n of nodes) n.r = radius(n.total);
  layout(nodes, links, families);

  const familyLabels = Object.fromEntries(families.map((f) => [f, labels['family:' + f] ?? f]));
  // Counts that belong to no node (all your LinkedIn connections, say), month by month.
  const extra = Object.fromEntries(Object.entries(data.series || {}).map(([k, v]) => [k, cumulative(v)]));
  const seriesNames = [...new Set([...items.flatMap((i) => Object.keys(i.series || {})), ...Object.keys(extra)])];
  const totals = Object.fromEntries(seriesNames.map((s) => [s, extra[s]
    ? extra[s][months.length - 1]
    : nodes.reduce((a, n) => a + (n.series[s]?.[months.length - 1] || 0), 0)]));
  totals.projects = nodes.filter((n) => n.kind === 'project').length;
  totals.clients = nodes.filter((n) => n.kind === 'client').length;

  return { name: data.name || '', generated: last, months, nodes, links, families, familyLabels, totals, extra, terms, currency: data.currency || '', radius, maxTotal };
}

// The biggest family sits in the middle and the rest ring around it, so the map grows outward.
// d3-force is deterministic for the same input, so the same data always gives the same map.
function layout(nodes, links, families) {
  const centers = {};
  const ring = families.slice(1);
  centers[families[0]] = { x: 0, y: 0 };
  // Far enough out that families don't overlap, scaled to how much there is to fit in.
  const area = nodes.reduce((a, n) => a + (n.r + 10) ** 2, 0);
  const radius = Math.max(220, Math.sqrt(area) * 1.25 + ring.length * 18);
  ring.forEach((f, i) => {
    const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    centers[f] = { x: Math.cos(a) * radius, y: Math.sin(a) * radius * 0.92 };
  });
  const simLinks = links.map((l) => ({ source: l.s, target: l.t, l }));
  forceSimulation(nodes)
    .force('link', forceLink(simLinks)
      .distance((x) => 24 + (1 - x.l.w) * 80 + x.source.r + x.target.r)
      .strength((x) => (x.source.family === x.target.family ? 0.08 + x.l.w * 0.4 : 0.004 + x.l.w * 0.03)))
    .force('charge', forceManyBody().strength((d) => -40 - d.r * 5).distanceMax(400))
    .force('collide', forceCollide((d) => d.r + 5).iterations(2))
    .force('x', forceX((d) => centers[d.family].x).strength(0.16))
    .force('y', forceY((d) => centers[d.family].y).strength(0.16))
    .stop()
    .tick(400);
  for (const n of nodes) { delete n.vx; delete n.vy; delete n.index; }
}

/** Which nodes link to node i, including i. */
export function neighbours(g, i) {
  const s = new Set([i]);
  for (const l of g.links) {
    if (l.s === i) s.add(l.t);
    if (l.t === i) s.add(l.s);
  }
  return s;
}
