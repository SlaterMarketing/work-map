#!/usr/bin/env node
// work-map: map your work from the git repos on this computer, and from exports of your calendar,
// CRM, LinkedIn and campaigns, with no sign-in and nothing uploaded.
//
//   npx github:SlaterMarketing/work-map ~/code ~/clients --ics calendar.zip
//   npx github:SlaterMarketing/work-map --csv deals.csv --csv Connections.csv --ics calendar.zip
//
// Finds every git repo under the folders you give (the current folder by default), counts your
// commits by month, reads READMEs and manifests for the links, and writes work-map.html: the map,
// the video preview and the download button, all in one file that works offline.

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { combineSources } from '../src/combine.js';
import { mentionLinks } from '../src/graph.js';
import { clientsFromCalendar, icsFromZip } from '../src/ics.js';
import { importTable } from '../src/tables.js';
import { viewerHtml } from './html.js';

const run = promisify(execFile);

const HELP = `work-map: map your work from the git repos on this computer, and from exports.

Usage: work-map [folders...] [options]

  --author <email>   your commit email; repeat for more (default: git config user.email)
  --ics <file>       calendar export (.ics, or Google Calendar's .zip) to add clients; repeatable
  --csv <file>       a CSV export to add; repeatable. Recognised: CRM deals (HubSpot, Pipedrive,
                     Salesforce…), LinkedIn Connections.csv, campaigns (Mailchimp…), ads reports
                     (Google, Meta…), the Gmail script's sheet, or any sheet with a date and a
                     client, company, project or campaign column
  --name <name>      the name on the video (default: git config user.name)
  --out <file>       where to write the map (default: work-map.html)
  --json <file>      also write the data as JSON
  --depth <n>        how many folders deep to look for repos (default: 3)
  --since <YYYY-MM>  start the timeline here
  --real-names       start with real labels instead of anonymous ones
  -h, --help         show this

Everything runs on this computer. Nothing is uploaded.`;

function parseArgs(argv) {
  const o = { folders: [], authors: [], ics: [], csv: [], depth: 3, out: 'work-map.html' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--author') o.authors.push(next().toLowerCase());
    else if (a === '--ics') o.ics.push(next());
    else if (a === '--csv') o.csv.push(next());
    else if (a === '--name') o.name = next();
    else if (a === '--out') o.out = next();
    else if (a === '--json') o.json = next();
    else if (a === '--depth') o.depth = Number(next());
    else if (a === '--since') o.since = next();
    else if (a === '--real-names') o.realNames = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Try --help.`);
    else o.folders.push(a);
  }
  // With only exports given, there are no repos to look for.
  if (!o.folders.length && !o.ics.length && !o.csv.length) o.folders.push('.');
  return o;
}

const SKIP = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.cache', 'Library', 'AppData']);

function findRepos(folder, depth, out = []) {
  let entries;
  try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return out; }
  if (entries.some((e) => e.name === '.git')) { out.push(folder); return out; }
  if (depth <= 0) return out;
  for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) findRepos(join(folder, e.name), depth - 1, out);
  return out;
}

const git = async (repo, ...args) => {
  try { return (await run('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024 })).stdout; } catch { return ''; }
};

const LANGS = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.py': 'Python',
  '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.cs': 'C#',
  '.cpp': 'C++', '.c': 'C', '.dart': 'Dart', '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro', '.ex': 'Elixir', '.scala': 'Scala',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS', '.liquid': 'Liquid', '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'PowerShell', '.lua': 'Lua',
};

function readSafe(p, max = 200000) {
  try { return statSync(p).size > 5e6 ? '' : readFileSync(p, 'utf8').slice(0, max); } catch { return ''; }
}

// Dependencies from the usual manifests, as tags for the shared-stack links.
function deps(repo) {
  const out = [];
  const pkg = readSafe(join(repo, 'package.json'));
  if (pkg) try { const p = JSON.parse(pkg); out.push(...Object.keys({ ...p.dependencies, ...p.devDependencies })); } catch {}
  for (const line of readSafe(join(repo, 'requirements.txt')).split('\n')) { const m = /^([A-Za-z0-9_.-]+)/.exec(line.trim()); if (m) out.push(m[1].toLowerCase()); }
  for (const m of readSafe(join(repo, 'go.mod')).matchAll(/^\s+([\w./-]+)\s+v/gm)) out.push(m[1]);
  const cargo = readSafe(join(repo, 'Cargo.toml')).split(/\[dependencies\]/)[1];
  if (cargo) for (const m of cargo.split(/\n\[/)[0].matchAll(/^([\w-]+)\s*=/gm)) out.push(m[1]);
  return out.filter((d) => !/^(@types\/|eslint|prettier|typescript$|vite$|tsx$|ts-node$|nodemon$|rimraf$|husky$|lint-staged$)/.test(d));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  if (!o.authors.length) {
    const email = (await git('.', 'config', '--global', 'user.email')).trim().toLowerCase();
    if (email) o.authors.push(email);
  }
  if (o.folders.length && !o.authors.length) throw new Error('Tell me your commit email with --author you@example.com');
  const name = o.name || (await git('.', 'config', '--global', 'user.name')).trim();

  const repos = [...new Set(o.folders.flatMap((f) => findRepos(resolve(f), o.depth)))];
  if (o.folders.length) console.log(`Found ${repos.length} git repo${repos.length === 1 ? '' : 's'}. Reading history for ${o.authors.join(', ')}…`);

  const scanned = [];
  for (const repo of repos) {
    const log = await git(repo, 'log', '--all', '--no-merges', '--format=%H%x09%aI%x09%ae');
    const mine = log.split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([, , e]) => o.authors.includes((e || '').toLowerCase()));
    if (!mine.length) continue;
    scanned.push({ repo, mine, total: log.split('\n').filter(Boolean).length });
  }
  // A repo copied from another repeats its history: each commit counts once, in the smaller repo
  // (usually the original).
  scanned.sort((a, b) => a.total - b.total);
  const seen = new Set();
  const items = [];
  const texts = new Map();
  for (const { repo, mine } of scanned) {
    const months = {};
    for (const [hash, date] of mine) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      const k = date.slice(0, 7);
      months[k] = (months[k] || 0) + 1;
    }
    if (!Object.keys(months).length) continue;
    const files = (await git(repo, 'ls-files')).split('\n');
    const langCount = {};
    for (const f of files) { const l = LANGS[extname(f).toLowerCase()]; if (l) langCount[l] = (langCount[l] || 0) + 1; }
    const language = Object.entries(langCount).filter(([l]) => l !== 'HTML' && l !== 'CSS').sort((a, b) => b[1] - a[1])[0]?.[0]
      || Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const remote = (await git(repo, 'remote', 'get-url', 'origin')).trim().replace(/\/\/[^@/]+@/, '//');
    const owner = /[:/]([^/:]+)\/[^/]+?(\.git)?$/.exec(remote)?.[1] || null;
    const readme = readdirSync(repo).find((f) => /^readme(\.|$)/i.test(f));
    const pkg = readSafe(join(repo, 'package.json'));
    let description = '';
    try { description = JSON.parse(pkg).description || ''; } catch {}
    const id = 'local:' + repo;
    items.push({ id, label: basename(repo), kind: 'project', owner, language, tags: deps(repo), description, series: { commits: months } });
    const text = (readme ? readSafe(join(repo, readme), 60000) : '') + '\n' + pkg;
    if (text.trim()) texts.set(id, text);
    process.stdout.write('.');
  }
  if (o.folders.length) process.stdout.write('\n');
  // Local paths stay out of the file: ids only need to be unique.
  const ids = new Map(items.map((it, i) => [it.id, `repo-${i}`]));
  const sources = [{
    type: 'local',
    items: items.map((it) => ({ ...it, id: ids.get(it.id) })),
    links: mentionLinks(items, texts).map((l) => ({ ...l, source: ids.get(l.source), target: ids.get(l.target) })),
  }];

  for (const f of o.csv) {
    const r = importTable(readFileSync(f, 'utf8'), basename(f));
    console.log(`${basename(f)}: ${r.summary}.`);
    sources.push(r);
  }

  if (o.ics.length) {
    const calendars = [];
    for (const f of o.ics) {
      const buf = readFileSync(f);
      if (/\.zip$/i.test(f)) calendars.push(...(await icsFromZip(buf))); else calendars.push(buf.toString('utf8'));
    }
    const own = o.authors.map((a) => a.split('@')[1]).filter((d) => d && !/gmail|outlook|hotmail|icloud|users\.noreply/.test(d));
    const cal = clientsFromCalendar(calendars, { ownDomains: own.length ? own : undefined });
    console.log(`Calendar: ${cal.events} meetings, ${cal.items.length} clients (your domain: ${cal.ownDomains.join(', ') || 'unknown'}).`);
    sources.push({ type: 'calendar', items: cal.items });
  }
  if (!sources.some((src) => src.items.length)) {
    throw new Error(o.folders.length ? `No commits by ${o.authors.join(', ')} in those folders. Check the email with --author.` : 'Nothing to map in those files.');
  }

  const data = combineSources(sources.filter((src) => src.items.length || src.series), { name });
  if (o.since) data.start = o.since;

  if (o.json) writeFileSync(o.json, JSON.stringify(data, null, 1));
  writeFileSync(o.out, viewerHtml(data, { anonymise: !o.realNames }));
  const projects = data.items.filter((i) => i.kind === 'project').length;
  const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
  console.log(`Wrote ${o.out}: ${count(projects, data.terms.project)}, ${count(data.items.length - projects, data.terms.client)}${seen.size ? `, ${seen.size} commits` : ''}. Open it in Chrome, Edge or Safari.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
