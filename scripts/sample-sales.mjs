// Writes examples/: made-up exports for a salesperson and a marketer (a HubSpot deals export,
// LinkedIn connections, a Mailchimp campaigns export, a Google Ads report and a calendar), for
// the tests and to try the importers.
import { writeFileSync } from 'node:fs';
import { monthRange } from '../src/graph.js';

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];
const months = monthRange('2023-01', '2026-10');
const day = (m) => `${m}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`;
const csv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

const companies = ['Northwind Traders Ltd', 'Acme Studio', 'Brightside Dental Group', 'Harbour & Co', 'Lumen Health Inc', 'Paperboat', 'Kestrel Logistics', 'Fieldnote Ltd', 'Bluefin Capital', 'Ivy Schools Trust', 'Orbit Labs', 'Cobalt Energy plc', 'Mosaic Retail', 'Quill Legal LLP', 'Tandem Bikes'];
const industries = { 'Lumen Health Inc': 'Healthcare', 'Brightside Dental Group': 'Healthcare', 'Ivy Schools Trust': 'Education', 'Bluefin Capital': 'Finance', 'Quill Legal LLP': 'Professional services', 'Fieldnote Ltd': 'Professional services' };

const deals = [['Record ID', 'Deal Name', 'Deal Stage', 'Close Date', 'Amount', 'Create Date', 'Associated Company', 'Industry']];
let id = 1000;
for (const c of companies) {
  const start = Math.floor(rand() * 30);
  for (let n = 0; n < 1 + Math.floor(rand() * 5); n++) {
    const created = months[Math.min(months.length - 2, start + n * 3 + Math.floor(rand() * 3))];
    const closed = months[Math.min(months.length - 1, months.indexOf(created) + 1 + Math.floor(rand() * 3))];
    const stage = rand() < 0.55 ? 'Closed Won' : rand() < 0.6 ? 'Closed Lost' : 'Proposal';
    deals.push([id++, `${c} – ${pick(['Retainer', 'Launch', 'Audit', 'Renewal'])}`, stage, `${day(closed)} 10:00`, `£${(2 + Math.floor(rand() * 40)) * 500}`, `${day(created)} 09:00`, c, industries[c] || 'Retail']);
  }
}
writeFileSync(new URL('../examples/hubspot-deals.csv', import.meta.url), csv(deals));

const first = ['Alex', 'Sam', 'Jo', 'Priya', 'Tom', 'Mia', 'Ben', 'Zoe'];
const conn = [['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On']];
for (const m of months) for (let n = 0; n < 3 + Math.floor(rand() * 9); n++) {
  const d = new Date(day(m) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  conn.push([pick(first), pick(['Smith', 'Khan', 'Jones', 'Lee']), 'https://www.linkedin.com/in/x', '', rand() < 0.5 ? pick(companies) : pick(['Self-employed', 'Google', 'Stripe', 'Monzo', 'Canva']), pick(['Head of Marketing', 'CEO', 'Ops Lead']), d]);
}
writeFileSync(new URL('../examples/linkedin-Connections.csv', import.meta.url), 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\n' + csv(conn));

const camp = [['Title', 'Subject', 'List', 'Send Date', 'Send Weekday', 'Total Recipients', 'Unique Opens']];
for (const m of months.slice(6)) for (const list of ['Newsletter', 'Customers']) {
  if (rand() < 0.3) continue;
  camp.push([`${list} ${m}`, pick(['Our autumn update', 'New: the 2025 report', 'Last chance']), list, `${pick(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].slice(+m.slice(5) - 1, +m.slice(5)))} ${10 + Math.floor(rand() * 15)}, ${m.slice(0, 4)} 09:00 am`, list === 'Newsletter' ? 4000 + Math.floor(rand() * 3000) : 900 + Math.floor(rand() * 300), 1000]);
}
writeFileSync(new URL('../examples/mailchimp-campaigns.csv', import.meta.url), csv(camp));

const ads = [['Campaign report'], ['1 January 2024 - 31 October 2026'], ['Campaign', 'Day', 'Currency code', 'Cost', 'Impr.', 'Clicks']];
for (const m of months.slice(12)) for (const c of ['Search | Brand', 'Search | Competitors', 'PMax | Spring sale']) {
  if (c.includes('Spring') && !/-0[3-5]$/.test(m)) continue;
  ads.push([c, day(m), 'GBP', (200 + rand() * 900).toFixed(2), 10000, 300]);
}
writeFileSync(new URL('../examples/google-ads.csv', import.meta.url), csv(ads));
console.log(`Wrote examples: ${deals.length - 1} deals, ${conn.length - 1} connections, ${camp.length - 1} campaigns, ${ads.length - 3} ad rows`);

// ...and all of them combined, as the website would.
const { importTable } = await import('../src/tables.js');
const { combineSources } = await import('../src/combine.js');
const { clientsFromCalendar } = await import('../src/ics.js');
const { readFileSync } = await import('node:fs');
const read = (f) => readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8');
const sources = ['hubspot-deals.csv', 'linkedin-Connections.csv', 'mailchimp-campaigns.csv', 'google-ads.csv'].map((f) => importTable(read(f), f));
sources.push({ type: 'calendar', items: clientsFromCalendar(read('sales-calendar.ics'), { now: new Date('2026-10-28') }).items });
writeFileSync(new URL('../examples/sales-sample.json', import.meta.url), JSON.stringify(combineSources(sources, { name: 'Sam Rivera', generated: '2026-10-28' }), null, 1) + '\n');
console.log('Wrote examples/sales-sample.json');
