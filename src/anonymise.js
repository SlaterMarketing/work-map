// Labels that keep clients and private work private, so the video can be posted. Public repos keep
// their names; private ones become "TypeScript project", clients become "Client A", "Client B", and
// families named after something private become "Product A". Returns overrides for
// buildGraph(data, { labels }), which anyone can then edit.

const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);

/** g: a graph built without overrides, so its labels are the real ones. */
export function anonymousLabels(g) {
  const labels = {};
  const byFirst = (a, b) => a.first - b.first || b.total - a.total;
  const Client = g.terms.client[0].replace(/^./, (c) => c.toUpperCase());
  g.nodes.filter((n) => n.kind === 'client').sort(byFirst).forEach((n, i) => { labels[n.id] = `${Client} ${letter(i)}`; });

  const used = new Map();
  for (const n of g.nodes.filter((x) => x.kind === 'project' && !x.public).sort(byFirst)) {
    // campaigns and other non-code work have no language: they keep a generic name of their kind
    const base = n.language ? `${n.language} project` : g.terms.project[0].replace(/^./, (c) => c.toUpperCase());
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    labels[n.id] = count === 1 ? base : `${base} ${count}`;
  }

  let product = 0;
  for (const f of g.families) {
    const members = g.nodes.filter((n) => n.family === f);
    const generic = /^(Other|Clients|Companies|Network|Projects|Ads|Email marketing)$/.test(f) || / projects$/.test(f) || / from \d{4}$/.test(f);
    const allPublic = members.every((n) => n.kind === 'project' && n.public);
    // groups that came with the export (an industry or pipeline) describe, rather than name, anyone
    const described = members.every((n) => n.grouped);
    const word = members.some((n) => n.language) ? 'Product' : 'Group';
    if (!generic && !allPublic && !described) labels['family:' + f] = `${word} ${letter(product++)}`;
  }
  return labels;
}
