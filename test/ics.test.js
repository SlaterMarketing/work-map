import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { clientsFromCalendar, icsFromZip, nameFromDomain } from '../src/ics.js';

const event = (start, people, extra = '') => `BEGIN:VEVENT\r\nDTSTART:${start}\r\n${people.map((p) => `ATTENDEE;CN=x;PARTSTAT=ACCEPTED:mailto:${p}`).join('\r\n')}\r\n${extra}END:VEVENT\r\n`;
const cal = (...events) => `BEGIN:VCALENDAR\r\n${events.join('')}END:VCALENDAR\r\n`;
const now = new Date('2026-10-28T00:00:00Z');

test('clients are external domains you met twice, by month', () => {
  const text = cal(
    event('20250102T100000Z', ['me@studio.dev', 'ana@acme.co.uk']),
    event('20250115T100000Z', ['me@studio.dev', 'bo@acme.co.uk']),
    event('20250203T100000Z', ['me@studio.dev', 'ana@acme.co.uk', 'x@gmail.com']),
    event('20250210T100000Z', ['me@studio.dev', 'once@oneoff.io']),
    event('20250301T100000Z', ['me@studio.dev', 'ana@acme.co.uk'], 'STATUS:CANCELLED\r\n'),
  );
  const { items, ownDomains } = clientsFromCalendar(text, { now });
  assert.deepEqual(ownDomains, ['studio.dev']);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Acme');
  assert.deepEqual(items[0].series.meetings, { '2025-01': 2, '2025-02': 1 });
});

test('weekly meetings expand until UNTIL or today', () => {
  const text = cal(event('20260901T090000Z', ['me@studio.dev', 'a@weekly.com'], 'RRULE:FREQ=WEEKLY;UNTIL=20260929T090000Z\r\n'));
  const { items } = clientsFromCalendar(text, { now, ownDomains: ['studio.dev'] });
  assert.equal(items[0].series.meetings['2026-09'], 5);
});

test('names from domains', () => {
  assert.equal(nameFromDomain('brightside-dental.com'), 'Brightside Dental');
});

test('reads .ics files out of a zip', async () => {
  const body = Buffer.from(cal(event('20250102T100000Z', ['me@a.com', 'b@b.com'])));
  const data = deflateRawSync(body);
  const name = Buffer.from('cal.ics');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  const [text] = await icsFromZip(zip);
  assert.equal(text, body.toString());
});
