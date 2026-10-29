import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { anonymousLabels } from '../src/anonymise.js';
import { buildGraph, inferLinks, mentionLinks, stemOf } from '../src/graph.js';

const sample = JSON.parse(readFileSync(new URL('../examples/sample.json', import.meta.url), 'utf8'));

test('stems skip generic words', () => {
  assert.equal(stemOf('orbit-forms-api'), 'orbit');
  assert.equal(stemOf('my-new-app'), null);
  assert.equal(stemOf('web-orbit'), 'orbit');
});

test('links: shared names, clients and stacks', () => {
  const links = inferLinks(sample.items);
  const has = (a, b, kind) => links.some((l) => l.kind === kind && ((l.source === a && l.target === b) || (l.source === b && l.target === a)));
  assert.ok(has('p2', 'p3', 'name'), 'orbit-api and orbit-web share a name');
  assert.ok(has('c1', 'p5', 'client'), 'Northwind links to northwind-portal');
  assert.ok(has('c2', 'p12', 'client'), 'Acme Studio links to acme-shopify-theme by its name');
});

test('mentions need the whole name', () => {
  const items = [{ id: 'a', label: 'orbit-web', kind: 'project' }, { id: 'b', label: 'tinyfeed', kind: 'project' }, { id: 'c', label: 'feed', kind: 'project' }];
  const links = mentionLinks(items, new Map([['a', 'Uses tinyfeed for the news panel']]));
  assert.deepEqual(links.map((l) => l.target), ['b']);
});

test('graph: every item placed, families capped, totals add up', () => {
  const g = buildGraph(sample);
  assert.equal(g.nodes.length, sample.items.length);
  assert.ok(g.families.length <= 7);
  assert.ok(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.r > 0));
  const commits = sample.items.reduce((a, i) => a + Object.values(i.series.commits || {}).reduce((x, y) => x + y, 0), 0);
  assert.equal(g.totals.commits, commits);
  assert.equal(g.months[0], '2023-03');
  assert.equal(g.months.at(-1), '2026-10');
});

test('layout is the same every time', () => {
  const a = buildGraph(sample), b = buildGraph(sample);
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]));
});

test('anonymous labels hide clients and private repos, keep public ones', () => {
  const g = buildGraph(sample);
  const labels = anonymousLabels(g);
  const shown = buildGraph(sample, { labels });
  const text = JSON.stringify([shown.nodes.map((n) => n.label), Object.values(shown.familyLabels)]);
  for (const secret of ['Northwind', 'Acme', 'Ledgerly', 'Brightside', 'Harbour', 'orbit', 'ledgerly']) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes('tinyfeed') && text.includes('portfolio-site'));
});
