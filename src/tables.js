// Work-map items from spreadsheet exports (CSV), so people whose work isn't in GitHub can map it too.
// It recognises the export from its columns:
//
//   LinkedIn connections   Connections.csv from LinkedIn's "Get a copy of your data"
//   CRM deals              HubSpot, Pipedrive, Salesforce, Close, Zoho… (a company and an amount or stage)
//   Email counts           the sheet the Gmail script makes (month, domain, emails)
//   Campaigns              Mailchimp, Klaviyo, HubSpot emails… (a campaign or title and a send date)
//   Ads                    Google Ads, Meta, LinkedIn Ads… (a campaign, a date and a cost)
//   Anything else          any sheet with a date and a client, company or project column
//
// Everything is read where it's called (in the browser on the website); nothing is uploaded.

import { stemOf } from './graph.js';

/** Rows from CSV text: handles quotes, commas and newlines inside quotes, and a byte-order mark. */
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const norm = (h) => h.toLowerCase().replace(/^(deal|organization|organisation|opportunity|person|campaign)\s*-\s*/, (m) => m.split('-')[0].trim() + ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Columns by what they hold, best match first.
const COLS = {
  company: ['associated company', 'company name', 'company', 'account name', 'account', 'organization name', 'organisation name', 'organization', 'organisation', 'deal organization', 'deal organisation', 'client', 'customer', 'domain'],
  dealName: ['deal name', 'opportunity name', 'deal title', 'title', 'name'],
  amount: ['amount', 'deal value', 'value', 'opportunity amount', 'deal amount', 'revenue', 'amount in company currency', 'total'],
  stage: ['deal stage', 'stage', 'status', 'deal status', 'is won', 'won'],
  closeDate: ['close date', 'closed date', 'won time', 'deal won time', 'won date', 'date won', 'close time', 'deal close date'],
  createDate: ['create date', 'created date', 'deal created', 'deal add time', 'add time', 'created', 'created at', 'date created'],
  group: ['industry', 'pipeline', 'deal pipeline', 'segment', 'type', 'category', 'source', 'lead source'],
  campaign: ['campaign name', 'campaign', 'campaign title', 'email name', 'title', 'name', 'subject'],
  sendDate: ['send date', 'sent date', 'send time', 'sent at', 'date sent', 'scheduled date', 'publish date', 'published', 'date'],
  recipients: ['emails sent', 'total recipients', 'recipients', 'sent', 'delivered', 'sends', 'total sent', 'successful deliveries'],
  cost: ['cost', 'amount spent', 'amount spent gbp', 'amount spent usd', 'amount spent eur', 'spend', 'total spent'],
  day: ['day', 'date', 'month', 'week', 'reporting starts', 'start date'],
  list: ['list', 'audience', 'list name', 'audience name', 'segment'],
  date: ['date', 'day', 'month', 'when', 'start', 'start date', 'created', 'created at'],
  name: ['client', 'company', 'account', 'customer', 'project', 'campaign', 'name', 'title'],
  kind: ['type', 'kind', 'category'],
  count: ['count', 'hours', 'number', 'quantity', 'total', 'amount'],
  currency: ['currency code', 'currency', 'deal currency code', 'account currency'],
};

function columns(header) {
  const h = header.map(norm);
  const find = (key, exclude = []) => {
    for (const want of COLS[key]) {
      const i = h.findIndex((x, j) => !exclude.includes(j) && (x === want || x === want.replace(/ /g, '')));
      if (i >= 0) return i;
    }
    for (const want of COLS[key]) {
      if (want.length < 5) continue;
      const i = h.findIndex((x, j) => !exclude.includes(j) && x.includes(want));
      if (i >= 0) return i;
    }
    return -1;
  };
  return { h, find };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * A month ("2024-03") from the dates in one column. Slashed dates are read day-first unless the
 * column shows they're month-first (a second number over 12), as US exports are.
 */
function monthReader(values) {
  let dayFirst = true;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v || '');
    if (m && +m[2] > 12) { dayFirst = false; break; }
  }
  return (v) => {
    v = String(v || '').trim();
    if (!v) return null;
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(v);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const mo = dayFirst ? +m[2] : +m[1];
      return mo >= 1 && mo <= 12 ? `${y}-${String(mo).padStart(2, '0')}` : null;
    }
    m = /(\d{1,2})?\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})?,?\s+(\d{4})/.exec(v);
    if (m && MONTHS[m[2].toLowerCase()] !== undefined) return `${m[4]}-${String(MONTHS[m[2].toLowerCase()] + 1).padStart(2, '0')}`;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 7);
  };
}

/** A number from a cell like "£12,500.00" or "1.234,50 €"; also the currency symbol it used. */
function money(v) {
  const s = String(v || '').trim();
  const symbol = (/[£$€¥₹]/.exec(s) || [''])[0] || (/\b(GBP|USD|EUR|AUD|CAD)\b/i.exec(s)?.[1]?.toUpperCase() ?? '');
  let n = s.replace(/[^\d.,-]/g, '');
  if (/,\d{2}$/.test(n) && n.includes('.')) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(/,/g, '');
  return { n: Number(n) || 0, symbol };
}
const SYMBOLS = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$' };
// The currency used most: from the amounts themselves, or a currency column.
function currencyOf(symbols, rows, col) {
  if (col >= 0) for (const r of rows.slice(1)) { const c = String(r[col] || '').trim().toUpperCase(); if (SYMBOLS[c]) add(symbols, SYMBOLS[c]); }
  const top = Object.entries(symbols).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return SYMBOLS[top] || top;
}

const LEGAL = /\b(ltd|limited|inc|incorporated|llc|llp|plc|gmbh|ag|sa|sas|bv|pty|co|corp|corporation|company|group|holdings|the)\b\.?/gi;
/** The name a company goes by: "The Acme Group Ltd" → "Acme". */
export const cleanCompany = (s) => String(s || '').replace(LEGAL, ' ').replace(/[,.]+$/g, '').replace(/\s+/g, ' ').trim();
/** A key that matches the same company across sources: "Acme Studio Ltd", "acmestudio.co" → "acmestudio". */
export const companyKey = (s) => {
  const v = String(s || '').toLowerCase().trim();
  const domain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v.replace(/^www\./, '').split('.')[0] : null;
  return (domain ?? cleanCompany(v).toLowerCase()).replace(/[^a-z0-9]/g, '');
};

const add = (o, k, v = 1) => { if (k) o[k] = (o[k] || 0) + v; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// The header is the first row that looks like one: LinkedIn puts notes above it.
function findHeader(rows, want) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(norm);
    if (want.some((w) => h.includes(w))) return i;
  }
  return 0;
}

function linkedin(rows) {
  const at = findHeader(rows, ['connected on']);
  const { find } = columns(rows[at]);
  const company = find('company'), on = rows[at].map(norm).indexOf('connected on');
  const body = rows.slice(at + 1);
  const month = monthReader(body.map((r) => r[on]));
  const all = {};
  const byCompany = new Map();
  for (const r of body) {
    const k = month(r[on]);
    if (!k) continue;
    add(all, k);
    const name = cleanCompany(r[company]);
    if (!name || name.length < 2 || /^(self|self-employed|freelance|freelancer|stealth|independent|retired|student|n\/a|none|-)$/i.test(name)) continue;
    const key = companyKey(name);
    if (!byCompany.has(key)) byCompany.set(key, { name, months: {} });
    add(byCompany.get(key).months, k);
  }
  // Companies where you know three or more people; everyone counts towards the total.
  const items = [...byCompany.entries()]
    .map(([key, c]) => ({ key, ...c, total: Object.values(c.months).reduce((a, b) => a + b, 0) }))
    .filter((c) => c.total >= 3)
    .sort((a, b) => b.total - a.total)
    .slice(0, 40)
    .map((c) => ({ id: 'co:' + c.key, label: c.name, kind: 'client', series: { connections: c.months } }));
  const total = Object.values(all).reduce((a, b) => a + b, 0);
  return { type: 'linkedin', items, series: { connections: all }, summary: `${total.toLocaleString('en-GB')} LinkedIn connections, ${items.length} companies where you know three or more people` };
}

function emailCounts(rows) {
  const { h } = columns(rows[0]);
  const m = h.indexOf('month'), d = h.indexOf('domain'), n = h.findIndex((x) => x === 'emails' || x === 'sent' || x === 'emails sent' || x === 'count');
  const month = monthReader(rows.slice(1).map((r) => r[m]));
  const byDomain = new Map();
  for (const r of rows.slice(1)) {
    const k = month(r[m]), dom = String(r[d] || '').toLowerCase().trim();
    if (!k || !dom) continue;
    if (!byDomain.has(dom)) byDomain.set(dom, {});
    add(byDomain.get(dom), k, Number(r[n]) || 1);
  }
  const items = [...byDomain.entries()]
    .filter(([, months]) => Object.values(months).reduce((a, b) => a + b, 0) >= 3)
    .map(([dom, months]) => ({ id: 'co:' + companyKey(dom), label: nameFromDomain(dom), kind: 'client', domain: dom, series: { emails: months } }));
  const total = items.reduce((a, i) => a + Object.values(i.series.emails).reduce((x, y) => x + y, 0), 0);
  return { type: 'emails', items, summary: `${total.toLocaleString('en-GB')} emails to ${items.length} companies` };
}

const nameFromDomain = (d) => d.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function deals(rows, cols) {
  const { company, amount, stage, closeDate, createDate, group, dealName } = cols;
  const body = rows.slice(1);
  const close = monthReader(body.map((r) => r[closeDate]));
  const create = monthReader(body.map((r) => r[createDate]));
  const won = (r) => stage < 0 || /won|closed ?won|^true$|^yes$|^1$/i.test(r[stage] || '') && !/lost/i.test(r[stage] || '');
  const symbols = {};
  const byCompany = new Map();
  let nWon = 0, revenue = 0;
  for (const r of body) {
    const name = cleanCompany(r[company]) || (company < 0 ? cleanCompany(r[dealName]) : '');
    if (!name) continue;
    const key = companyKey(name);
    if (!byCompany.has(key)) byCompany.set(key, { name, series: { opportunities: {}, deals: {}, revenue: {} }, group: group >= 0 ? String(r[group] || '').trim() : '' });
    const c = byCompany.get(key).series;
    const opened = create(r[createDate]) || close(r[closeDate]);
    add(c.opportunities, opened);
    if (won(r)) {
      const k = close(r[closeDate]) || opened;
      if (!k) continue;
      const { n, symbol } = money(r[amount]);
      add(c.deals, k);
      if (n) add(c.revenue, k, n);
      if (symbol) add(symbols, symbol);
      nWon++; revenue += n;
    }
  }
  const groups = new Set([...byCompany.values()].map((c) => c.group).filter(Boolean));
  const items = [...byCompany.entries()].map(([key, c]) => ({
    id: 'co:' + key, label: c.name, kind: 'client',
    ...(c.group && groups.size >= 2 && groups.size <= 12 ? { group: c.group } : {}),
    series: Object.fromEntries(Object.entries(c.series).filter(([, v]) => Object.keys(v).length)),
  }));
  const currency = currencyOf(symbols, rows, cols.currency);
  return {
    type: 'crm', items, currency,
    summary: `${body.length.toLocaleString('en-GB')} deals with ${items.length} companies${nWon ? `, ${nWon} won${revenue ? ` (${currency}${Math.round(revenue).toLocaleString('en-GB')})` : ''}` : ''}`,
  };
}

// Campaigns and ads: grouped by their audience or list where the export has one, otherwise by the
// first distinctive word of their name ("Spring sale – email 2" and "Spring sale – SMS" together).
function campaigns(rows, cols, ads) {
  const { campaign, sendDate, recipients, cost, day, list } = cols;
  const body = rows.slice(1);
  const when = monthReader(body.map((r) => r[ads ? day : sendDate]));
  const symbols = {};
  const groups = new Map();
  const seen = new Set();
  for (const r of body) {
    const title = String(r[campaign] || '').trim();
    const k = when(r[ads ? day : sendDate]);
    if (!title || !k) continue;
    const group = (list >= 0 && String(r[list] || '').trim()) || stemOf(title) || title;
    const key = slug(group);
    if (!groups.has(key)) groups.set(key, { label: list >= 0 && r[list] ? String(r[list]).trim() : titleWords(title), series: {} });
    const s = groups.get(key).series;
    if (ads) {
      const { n, symbol } = money(r[cost]);
      if (n) { s.spend ??= {}; add(s.spend, k, n); }
      if (symbol) add(symbols, symbol);
      // an ads report has a row per campaign per day: count each campaign once
      if (!seen.has(title)) { seen.add(title); s.campaigns ??= {}; add(s.campaigns, k); }
    } else {
      s.campaigns ??= {};
      add(s.campaigns, k);
      const n = money(r[recipients]).n;
      if (n) { s.sends ??= {}; add(s.sends, k, n); }
    }
  }
  const items = [...groups.entries()].map(([key, g]) => ({ id: `${ads ? 'ads' : 'cmp'}:${key}`, label: g.label, kind: 'project', group: ads ? 'Ads' : 'Email marketing', series: g.series }));
  const n = items.reduce((a, i) => a + Object.values(i.series.campaigns || {}).reduce((x, y) => x + y, 0), 0);
  return { type: ads ? 'ads' : 'campaigns', items, currency: currencyOf(symbols, rows, cols.currency), summary: `${n} ${ads ? 'ad campaigns' : 'campaigns'} in ${items.length} groups` };
}
const titleWords = (t) => t.split(/\s+[-–|:]\s+/)[0].slice(0, 40);

// Any sheet with a date and a name: each row counts as one activity (or its count / hours).
function activity(rows, cols) {
  const { date, name, kind, count } = cols;
  const body = rows.slice(1);
  const month = monthReader(body.map((r) => r[date]));
  const items = new Map();
  for (const r of body) {
    const label = String(r[name] || '').trim(), k = month(r[date]);
    if (!label || !k) continue;
    const t = String(kind >= 0 ? r[kind] : '').toLowerCase();
    const isProject = /project|campaign|product|content|post|event|internal/.test(t);
    const key = (isProject ? 'act:' : 'co:') + (isProject ? slug(label) : companyKey(label));
    if (!items.has(key)) items.set(key, { id: key, label: isProject ? label : cleanCompany(label) || label, kind: isProject ? 'project' : 'client', series: { activities: {} } });
    add(items.get(key).series.activities, k, count >= 0 ? Number(String(r[count]).replace(/[^\d.]/g, '')) || 1 : 1);
  }
  return { type: 'activity', items: [...items.values()], summary: `${body.length.toLocaleString('en-GB')} rows, ${items.size} clients and projects` };
}

/**
 * Items from one CSV export. Resolves to { type, items, series?, currency?, summary }, or throws
 * an Error explaining what columns it needs.
 */
export function importTable(text, filename = '') {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${filename || 'That file'} has no rows.`);
  if (rows.slice(0, 15).some((r) => r.map(norm).includes('connected on'))) return linkedin(rows);

  // Ads reports often start with a title and a date range above the header.
  const filled = (r) => r.filter((c) => c.trim()).length;
  while (rows.length > 2 && filled(rows[0]) < 3 && rows.slice(1, 6).some((r) => filled(r) > filled(rows[0]))) rows.shift();
  const { h, find } = columns(rows[0]);
  if (h.includes('month') && h.includes('domain')) return emailCounts(rows);

  const company = find('company');
  const amount = find('amount'), stage = find('stage'), closeDate = find('closeDate'), createDate = find('createDate');
  if (company >= 0 && (amount >= 0 || stage >= 0) && (closeDate >= 0 || createDate >= 0)) {
    return deals(rows, { company, amount, stage, closeDate, createDate, group: find('group', [company, stage]), dealName: find('dealName'), currency: find('currency') });
  }
  const dealName = find('dealName');
  if (company < 0 && /deal|opportunit/.test(h.join(' ')) && dealName >= 0 && (closeDate >= 0 || createDate >= 0)) {
    return deals(rows, { company: -1, amount, stage, closeDate, createDate, group: find('group', [stage]), dealName, currency: find('currency') });
  }

  const campaign = find('campaign');
  const cost = find('cost'), day = find('day', [campaign]);
  if (campaign >= 0 && cost >= 0 && day >= 0) return campaigns(rows, { campaign, cost, day, list: -1, currency: find('currency') }, true);
  const sendDate = find('sendDate', [campaign]), recipients = find('recipients');
  if (campaign >= 0 && sendDate >= 0 && (recipients >= 0 || /campaign|subject|send/.test(h.join(' ')))) {
    return campaigns(rows, { campaign, sendDate, recipients, list: find('list', [campaign]), currency: -1 }, false);
  }

  const date = find('date'), name = find('name', [date]);
  if (date >= 0 && name >= 0) return activity(rows, { date, name, kind: find('kind', [date, name]), count: find('count', [date, name]) });

  throw new Error(`${filename || 'That file'} doesn't look like an export I know. It needs a date column and a client, company, project or campaign column.`);
}
