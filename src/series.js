// The kinds of activity a map can count, how much each makes a node grow, and what the video
// calls them. Anything not listed still works: it counts 1 per unit and is labelled by its name.

export const SERIES = {
  deals: { label: 'deals won', one: 'deal won', weight: 10 },
  revenue: { label: 'revenue won', money: true, weight: 0 },
  opportunities: { label: 'deals worked', one: 'deal worked', weight: 3 },
  meetings: { label: 'meetings', one: 'meeting', weight: 4 },
  commits: { label: 'commits', one: 'commit', weight: 1 },
  emails: { label: 'emails sent', one: 'email sent', weight: 1 },
  campaigns: { label: 'campaigns', one: 'campaign', weight: 6 },
  sends: { label: 'marketing emails', one: 'marketing email', weight: 0 },
  spend: { label: 'ad spend', money: true, weight: 0 },
  posts: { label: 'posts', one: 'post', weight: 3 },
  connections: { label: 'new connections', one: 'new connection', weight: 1 },
  activities: { label: 'activities', one: 'activity', weight: 2 },
};

// The order the video's counters appear in, after the project and company counts.
export const STAT_ORDER = ['deals', 'revenue', 'meetings', 'commits', 'emails', 'campaigns', 'sends', 'spend', 'connections', 'posts', 'opportunities', 'activities'];

export const seriesWeight = (name) => SERIES[name]?.weight ?? 1;
export const seriesLabel = (name, n = 2) => (n === 1 ? SERIES[name]?.one : SERIES[name]?.label) || name.replace(/[_-]+/g, ' ');

export function formatMoney(n, currency = '') {
  const v = Math.round(n);
  const s = v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : v.toLocaleString('en-GB');
  return currency + s;
}
