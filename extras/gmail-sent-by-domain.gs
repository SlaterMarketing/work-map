// Work map: counts the emails you've sent each month to each outside company.
// Only counts are saved: month, the company's domain, and how many emails. No subjects or contents.
// Run countSentEmails. Google stops scripts after six minutes, so it saves its progress: if the log
// says "Run it again", run it again until it says "Done". Then open the sheet it made and use
// File > Download > Comma-separated values, and add that file to your work map.

const YEARS = 4;  // how far back to look
const PERSONAL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|fastmail|hey|btinternet|sky|virginmedia)\./;

function countSentEmails() {
  const props = PropertiesService.getUserProperties();
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const own = me.split('@')[1];
  let sheet;
  const id = props.getProperty('workmap_sheet');
  if (id) sheet = SpreadsheetApp.openById(id).getSheets()[0];
  else {
    const file = SpreadsheetApp.create('Work map: emails sent');
    sheet = file.getSheets()[0];
    sheet.appendRow(['month', 'domain', 'emails']);
    props.setProperty('workmap_sheet', file.getId());
    props.setProperty('workmap_start', '0');
  }

  const counts = {};
  const rows = sheet.getDataRange().getValues().slice(1);
  rows.forEach(function (r) { if (r[0]) counts[r[0] + '|' + r[1]] = Number(r[2]) || 0; });

  let start = Number(props.getProperty('workmap_start') || 0);
  const began = Date.now();
  let done = false;
  while (Date.now() - began < 4.5 * 60 * 1000) {
    const threads = GmailApp.search('in:sent newer_than:' + YEARS + 'y', start, 100);
    if (!threads.length) { done = true; break; }
    GmailApp.getMessagesForThreads(threads).forEach(function (messages) {
      messages.forEach(function (m) {
        if (m.getFrom().toLowerCase().indexOf(me) < 0) return;
        const month = Utilities.formatDate(m.getDate(), 'UTC', 'yyyy-MM');
        const domains = {};
        (m.getTo() + ',' + m.getCc()).split(',').forEach(function (a) {
          const at = /@([a-z0-9.-]+)/i.exec(a);
          if (!at) return;
          const d = at[1].toLowerCase().replace(/^www\./, '');
          if (d === own || d.endsWith('.' + own) || PERSONAL.test(d)) return;
          domains[d] = true;
        });
        Object.keys(domains).forEach(function (d) { counts[month + '|' + d] = (counts[month + '|' + d] || 0) + 1; });
      });
    });
    start += threads.length;
  }

  const out = Object.keys(counts).sort().map(function (k) { const p = k.split('|'); return [p[0], p[1], counts[k]]; });
  sheet.clearContents();
  sheet.appendRow(['month', 'domain', 'emails']);
  if (out.length) sheet.getRange(2, 1, out.length, 3).setValues(out);
  props.setProperty('workmap_start', String(start));
  if (done) {
    props.deleteProperty('workmap_sheet');
    props.deleteProperty('workmap_start');
    Logger.log('Done. Open ' + sheet.getParent().getUrl() + ' and use File > Download > Comma-separated values.');
  } else {
    Logger.log('Read ' + start + ' conversations so far. Run it again to carry on.');
  }
}
