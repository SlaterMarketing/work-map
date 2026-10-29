// Clients from a calendar export (.ics, or the .zip Google Calendar gives you). Every external
// domain you met with at least twice becomes a client, with its meetings counted by month. Your own
// domain is the one on most events. Personal email providers and big webinars are skipped.

const PERSONAL = new Set(('gmail.com googlemail.com yahoo.com yahoo.co.uk hotmail.com hotmail.co.uk outlook.com live.com ' +
  'live.co.uk msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me mail.com gmx.com gmx.de gmx.co.uk ' +
  'yandex.com fastmail.com hey.com btinternet.com sky.com virginmedia.com qq.com 163.com').split(' '));
const IGNORED = /(^|\.)(calendar\.google\.com|resource\.calendar\.google\.com|group\.calendar\.google\.com|zoom\.us|calendly\.com|teams\.microsoft\.com|noreply)/;
const MAX_ATTENDEES = 25;
const MAX_OCCURRENCES = 400;

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh = '12', mm = '00', ss = '00'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
}

const domainOf = (addr) => {
  const m = /mailto:([^;:\s]+@([^;:\s>]+))/i.exec(addr) || /([^;:\s]+@([^;:\s>]+))/.exec(addr);
  return m ? m[2].toLowerCase().replace(/^www\./, '') : null;
};

// Dates of a recurring event, from its RRULE: daily, weekly or monthly, with INTERVAL, COUNT and UNTIL.
function occurrences(start, rrule, exdates, until) {
  if (!rrule) return [start];
  const r = Object.fromEntries(rrule.split(';').map((p) => p.split('=')));
  const step = Math.max(1, Number(r.INTERVAL) || 1);
  const count = Number(r.COUNT) || Infinity;
  const end = r.UNTIL ? parseDate(r.UNTIL) : until;
  const days = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2))) : null;
  const out = [];
  const add = (d) => { if (d >= start && d <= end && d <= until && !exdates.has(d.toISOString().slice(0, 10))) out.push(d); };
  let cur = new Date(start);
  for (let n = 0; n < MAX_OCCURRENCES * 7 && out.length < Math.min(count, MAX_OCCURRENCES) && cur <= end && cur <= until; n++) {
    if (r.FREQ === 'DAILY') { add(new Date(cur)); cur.setUTCDate(cur.getUTCDate() + step); }
    else if (r.FREQ === 'WEEKLY') {
      if (days) {
        const weekStart = new Date(cur); weekStart.setUTCDate(cur.getUTCDate() - cur.getUTCDay());
        for (const wd of days) { const d = new Date(weekStart); d.setUTCDate(weekStart.getUTCDate() + wd); if (out.length < count) add(d); }
      } else add(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 7 * step);
    } else if (r.FREQ === 'MONTHLY') { add(new Date(cur)); cur.setUTCMonth(cur.getUTCMonth() + step); }
    else if (r.FREQ === 'YEARLY') { add(new Date(cur)); cur.setUTCFullYear(cur.getUTCFullYear() + step); }
    else { add(start); break; }
  }
  return out;
}

/** Events from .ics text: [{ date, domains: [...] }]. */
export function parseEvents(text, now = new Date()) {
  const events = [];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const lines = body.split('\n');
    const get = (name) => lines.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
    const value = (l) => (l ? l.slice(l.indexOf(':') + 1).trim() : '');
    if (/^CANCELLED$/i.test(value(get('STATUS')))) continue;
    const start = parseDate(value(get('DTSTART')));
    if (!start || start > now) continue;
    const people = lines.filter((l) => l.startsWith('ATTENDEE') || l.startsWith('ORGANIZER'));
    if (people.length > MAX_ATTENDEES || people.length < 2) continue;
    const domains = [...new Set(people.map(domainOf).filter(Boolean))];
    const exdates = new Set(lines.filter((l) => l.startsWith('EXDATE')).flatMap((l) => value(l).split(',')).map((v) => parseDate(v)?.toISOString().slice(0, 10)).filter(Boolean));
    for (const date of occurrences(start, value(get('RRULE')), exdates, now)) events.push({ date, domains });
  }
  return events;
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "acme-studio.co.uk" → "Acme Studio". */
export const nameFromDomain = (d) => titleCase(d.split('.')[0].replace(/[-_]+/g, ' ')).replace(/ \w/g, (c) => c.toUpperCase());

/**
 * Work-map client items from one or more .ics texts.
 * opts.ownDomains: your own domains (worked out when missing), opts.minMeetings (default 2).
 */
export function clientsFromCalendar(texts, opts = {}) {
  const events = [].concat(texts).flatMap((t) => parseEvents(t, opts.now));
  // The same meeting in two exported calendars counts once.
  const seen = new Set();
  const unique = events.filter((e) => { const key = e.date.toISOString() + e.domains.join(); if (seen.has(key)) return false; seen.add(key); return true; });

  // Domains given as yours only count if they're in this calendar; otherwise it works them out.
  let own = new Set((opts.ownDomains || []).filter((d) => unique.some((e) => e.domains.includes(d))));
  if (!own.size) {
    const counts = new Map();
    for (const e of unique) for (const d of e.domains) counts.set(d, (counts.get(d) || 0) + 1);
    const top = [...counts.entries()].filter(([d]) => !PERSONAL.has(d) && !IGNORED.test(d)).sort((a, b) => b[1] - a[1])[0];
    if (top) own = new Set([top[0]]);
  }

  const clients = new Map();
  for (const e of unique) {
    const month = e.date.toISOString().slice(0, 7);
    for (const d of e.domains) {
      if (own.has(d) || PERSONAL.has(d) || IGNORED.test(d)) continue;
      if (!clients.has(d)) clients.set(d, {});
      const m = clients.get(d);
      m[month] = (m[month] || 0) + 1;
    }
  }
  const min = opts.minMeetings ?? 2;
  const items = [...clients.entries()]
    .filter(([, m]) => Object.values(m).reduce((a, b) => a + b, 0) >= min)
    .map(([domain, meetings]) => ({ id: 'cal:' + domain, label: nameFromDomain(domain), kind: 'client', domain, series: { meetings } }));
  return { items, ownDomains: [...own], events: unique.length };
}

/** The .ics files inside a .zip (Google Calendar's export), as text. Uses the browser's or Node's DecompressionStream. */
export async function icsFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That file isn't a zip.");
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = [];
  for (let e = 0; e < entries; e++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.ics$/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.push(new TextDecoder().decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.push(await new Response(stream).text());
    }
  }
  return out;
}
