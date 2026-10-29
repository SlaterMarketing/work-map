// Work-map data from GitHub, fetched straight from the browser (or Node 18+).
//
// With a token (a GitHub App user token, or any token that can read the repos), it reads every
// repo the token can see: your commits per month, topics, dependencies and README, which give the
// links. Without one it reads a user's public repos, within GitHub's limit of 60 requests an hour,
// so it only reads the most recently active ones and skips READMEs.

import { mentionLinks } from './graph.js';

const API = 'https://api.github.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimited extends Error {}

function client(token, signal) {
  return async function gh(path, { raw = false, allow404 = false } = {}) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      signal,
      headers: {
        accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new RateLimited('GitHub rate limit reached');
    }
    if (allow404 && (res.status === 404 || res.status === 403)) return null;
    if (res.status === 202 || res.status === 204) return { status: res.status };
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return raw ? res.text() : { status: res.status, body: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '')?.[1] };
  };
}

async function all(gh, path, max = 1000) {
  const out = [];
  let url = path;
  while (url && out.length < max) {
    const r = await gh(url);
    out.push(...(Array.isArray(r.body) ? r.body : r.body.repositories || []));
    url = r.next;
  }
  return out;
}

// Your commits per month, from GitHub's weekly contributor stats (one request per repo). GitHub
// answers 202 while it works them out, so this waits and asks again.
async function commitMonths(gh, repo, login, tries) {
  for (let i = 0; i < tries; i++) {
    const r = await gh(`/repos/${repo.full_name}/stats/contributors`, { allow404: true });
    if (!r) return null;
    if (r.status === 202) { await sleep(1500 + i * 1000); continue; }
    if (r.status === 204 || !Array.isArray(r.body)) return {};
    const me = r.body.find((c) => c.author && c.author.login.toLowerCase() === login.toLowerCase());
    const months = {};
    for (const wk of me?.weeks || []) {
      if (!wk.c) continue;
      const k = new Date(wk.w * 1000).toISOString().slice(0, 7);
      months[k] = (months[k] || 0) + wk.c;
    }
    return months;
  }
  return null;
}

// When the stats aren't ready, the commit list (up to 300 of your commits per repo).
async function commitMonthsFromList(gh, repo, login) {
  const months = {};
  let url = `/repos/${repo.full_name}/commits?author=${encodeURIComponent(login)}&per_page=100`;
  for (let page = 0; url && page < 3; page++) {
    const r = await gh(url, { allow404: true });
    if (!r || !Array.isArray(r.body)) break;
    for (const c of r.body) {
      const k = (c.commit.author?.date || c.commit.committer?.date || '').slice(0, 7);
      if (k) months[k] = (months[k] || 0) + 1;
    }
    url = r.next;
  }
  return months;
}

function depsFrom(pkgText) {
  try {
    const p = JSON.parse(pkgText);
    return Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies })
      // tooling every JS project has says nothing about what it's built on
      .filter((d) => !/^(@types\/|eslint|prettier|typescript$|vite$|tsx$|ts-node$|nodemon$|rimraf$|husky$|lint-staged$)/.test(d));
  } catch {
    return [];
  }
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

/**
 * opts: { token?, user? (required without a token), maxRepos?, includeForks?, signal?,
 *         onProgress({ done, total, repo, message }) }
 * Resolves to work-map data: { version, name, login, generated, items, links, limited }.
 */
export async function collectGitHub(opts = {}) {
  const { token, signal } = opts;
  const gh = client(token, signal);
  const progress = (p) => opts.onProgress?.(p);
  const signedIn = Boolean(token);

  progress({ done: 0, total: 0, message: 'Finding your repos…' });
  const me = signedIn ? (await gh('/user')).body : (await gh(`/users/${encodeURIComponent(opts.user)}`)).body;
  const login = me.login;
  let repos = signedIn
    ? await all(gh, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member')
    : await all(gh, `/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`, 100);
  repos = repos
    .filter((r) => (opts.includeForks || !r.fork) && r.size > 0)
    .sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''))
    .slice(0, opts.maxRepos || (signedIn ? 150 : 20));

  const items = [];
  const texts = new Map();
  let limited = false;
  let done = 0;
  progress({ done, total: repos.length, message: `Reading ${repos.length} repos…` });
  await pool(repos, signedIn ? 6 : 3, async (repo) => {
    if (limited) return;
    try {
      let months = await commitMonths(gh, repo, login, signedIn ? 5 : 2);
      if (months === null && signedIn) months = await commitMonthsFromList(gh, repo, login);
      if (!months || !Object.keys(months).length) return;
      const item = {
        id: 'gh:' + repo.full_name,
        label: repo.name,
        kind: 'project',
        owner: repo.owner.login,
        public: !repo.private,
        url: repo.html_url,
        description: repo.description || '',
        language: repo.language || null,
        tags: [...(repo.topics || [])],
        series: { commits: months },
      };
      if (signedIn) {
        const [readme, pkg] = await Promise.all([
          gh(`/repos/${repo.full_name}/readme`, { raw: true, allow404: true }),
          gh(`/repos/${repo.full_name}/contents/package.json`, { raw: true, allow404: true }),
        ]);
        if (typeof pkg === 'string') item.tags.push(...depsFrom(pkg));
        const text = [typeof readme === 'string' ? readme.slice(0, 60000) : '', typeof pkg === 'string' ? pkg : ''].join('\n');
        if (text.trim()) texts.set(item.id, text);
      }
      items.push(item);
    } catch (err) {
      if (err instanceof RateLimited) limited = true;
      else if (err.name === 'AbortError') throw err;
    } finally {
      progress({ done: ++done, total: repos.length, repo: repo.name });
    }
  });

  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    name: me.name || login,
    login,
    generated: new Date().toISOString().slice(0, 10),
    items,
    links: mentionLinks(items, texts),
    limited,
  };
}
