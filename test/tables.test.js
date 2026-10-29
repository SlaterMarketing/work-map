import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { anonymousLabels } from '../src/anonymise.js';
import { combineSources } from '../src/combine.js';
import { buildGraph } from '../src/graph.js';
import { clientsFromCalendar } from '../src/ics.js';
import { companyKey, importTable, parseCsv } from '../src/tables.js';
import { statsFor } from '../src/video.js';

const example = (f) => readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8');

test('csv: quotes, commas and newlines inside quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n'), [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  assert.deepEqual(parseCsv('﻿a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('company keys match across sources', () => {
  assert.equal(companyKey('The Acme Studio Ltd'), companyKey('acmestudio.co.uk'));
  assert.equal(companyKey('Northwind Traders Ltd'), companyKey('Northwind Traders'));
});

test('recognises each export', () => {
  assert.equal(importTable(example('hubspot-deals.csv')).type, 'crm');
  assert.equal(importTable(example('linkedin-Connections.csv')).type, 'linkedin');
  assert.equal(importTable(example('mailchimp-campaigns.csv')).type, 'campaigns');
  assert.equal(importTable(example('google-ads.csv')).type, 'ads');
  assert.equal(importTable('month,domain,emails\n2025-01,acme.com,4\n2025-02,acme.com,2\n').type, 'emails');
  assert.equal(importTable('Date,Client,Hours\n03/02/2025,Acme,3\n').type, 'activity');
  assert.throws(() => importTable('a,b\n1,2\n'), /date column/);
});

test('deals: won deals and revenue by close month, in the currency used', () => {
  const r = importTable([
    'Deal - Title,Deal - Organization,Deal - Value,Deal - Status,Deal - Won time,Deal - Deal created',
    'Retainer,Acme Ltd,"€12,000",won,2025-03-14 10:00:00,2025-01-02 09:00:00',
    'Audit,Acme Ltd,"€3,000",lost,,2025-02-01 09:00:00',
    'Launch,Bolt Inc,"€5,500.50",won,2025-04-01 10:00:00,2025-03-01 09:00:00',
  ].join('\n'));
  assert.equal(r.currency, '€');
  const acme = r.items.find((i) => i.label === 'Acme');
  assert.deepEqual(acme.series.deals, { '2025-03': 1 });
  assert.deepEqual(acme.series.revenue, { '2025-03': 12000 });
  assert.deepEqual(acme.series.opportunities, { '2025-01': 1, '2025-02': 1 });
});

test('US dates are read month-first when the column shows it', () => {
  const r = importTable('Date,Client\n03/15/2025,Acme\n04/02/2025,Acme\n');
  assert.deepEqual(r.items[0].series.activities, { '2025-03': 1, '2025-04': 1 });
});

test('one company from four sources becomes one node, with counters for sales work', () => {
  const sources = ['hubspot-deals.csv', 'linkedin-Connections.csv', 'mailchimp-campaigns.csv', 'google-ads.csv'].map((f) => importTable(example(f)));
  sources.push({ type: 'calendar', items: clientsFromCalendar(example('sales-calendar.ics'), { now: new Date('2026-10-28') }).items });
  const data = combineSources(sources, { name: 'Sam', generated: '2026-10-28' });
  const north = data.items.filter((i) => /northwind/i.test(i.label));
  assert.equal(north.length, 1);
  assert.equal(north[0].label, 'Northwind Traders');
  assert.ok(north[0].series.deals && north[0].series.meetings && north[0].series.connections);

  const g = buildGraph(data);
  assert.deepEqual(g.terms.client, ['company', 'companies']);
  assert.equal(g.totals.connections, Object.values(data.series.connections).reduce((a, b) => a + b, 0));
  const stats = statsFor(g).map(([k]) => k);
  assert.ok(stats.includes('deals') && stats.includes('revenue'));
  assert.ok(g.families.includes('Network'), 'LinkedIn-only companies are the network');

  const labels = Object.values(anonymousLabels(g));
  assert.ok(labels.includes('Company A'));
  assert.ok(!labels.some((l) => /northwind|acme/i.test(l)));
});
