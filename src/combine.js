// Puts the sources together into one work-map data set. The same company from different sources
// (Acme Ltd in the CRM, acme.com in the calendar, Acme on LinkedIn) becomes one node with all of
// its activity, named the way the CRM or LinkedIn names it rather than after its domain.

import { companyKey } from './tables.js';

// Whose name for a company wins: a CRM's or LinkedIn's over one guessed from a domain.
const NAME_RANK = { crm: 0, linkedin: 1, activity: 2, calendar: 3, emails: 4 };

function mergeSeries(into, from) {
  for (const [name, months] of Object.entries(from || {})) {
    into[name] ??= {};
    for (const [k, v] of Object.entries(months)) into[name][k] = (into[name][k] || 0) + v;
  }
}

/**
 * sources: [{ type: 'github' | 'local' | 'calendar' | 'crm' | 'linkedin' | 'emails' | 'campaigns' | 'ads' | 'activity',
 *             items, links?, series?, currency?, name? }]
 * opts: { name, generated }
 */
export function combineSources(sources, opts = {}) {
  const projects = [];
  const companies = new Map();
  const series = {};
  const links = [];
  let currency = '';
  const ranked = [...sources].sort((a, b) => (NAME_RANK[a.type] ?? 9) - (NAME_RANK[b.type] ?? 9));
  for (const src of ranked) {
    if (src.currency && !currency) currency = src.currency;
    mergeSeries(series, src.series);
    links.push(...(src.links || []));
    for (const item of src.items || []) {
      if (item.kind !== 'client') { projects.push(item); continue; }
      const key = companyKey(item.domain || item.label) || item.id;
      const known = companies.get(key);
      if (!known) {
        companies.set(key, { ...item, id: 'co:' + key, series: structuredClone(item.series || {}), sources: [src.type], alias: [item.id] });
        continue;
      }
      mergeSeries(known.series, item.series);
      known.domain ??= item.domain;
      known.group ??= item.group;
      known.sources.push(src.type);
      known.alias.push(item.id);
    }
  }
  // Links made against a source's own ids now point at the merged company.
  const alias = new Map([...companies.values()].flatMap((c) => c.alias.map((a) => [a, c.id])));
  const items = [...projects, ...[...companies.values()].map(({ alias: _a, sources: _s, ...c }) => c)];
  const types = new Set(sources.map((s) => s.type));
  const code = types.has('github') || types.has('local');
  const sales = types.has('crm') || types.has('linkedin') || types.has('emails');
  const onlyCampaigns = !code && !types.has('activity') && (types.has('campaigns') || types.has('ads'));
  return {
    version: 1,
    name: opts.name || sources.find((s) => s.name)?.name || '',
    generated: opts.generated || new Date().toISOString().slice(0, 10),
    items,
    links: links.map((l) => ({ ...l, source: alias.get(l.source) || l.source, target: alias.get(l.target) || l.target })),
    series,
    currency,
    terms: {
      // campaign exports are grouped by list or name: "Newsletter", "Search". Those are channels.
      project: onlyCampaigns ? ['channel', 'channels'] : ['project', 'projects'],
      client: sales ? ['company', 'companies'] : ['client', 'clients'],
    },
  };
}
