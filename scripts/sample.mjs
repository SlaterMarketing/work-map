// Writes examples/sample.json: a made-up freelancer's three and a half years, for the demo and tests.
import { writeFileSync } from 'node:fs';
import { monthRange } from '../src/graph.js';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const months = monthRange('2023-03', '2026-10');

// [id, label, kind, from, to, intensity, extra]
const plan = [
  ['p1', 'portfolio-site', 'project', '2023-03', '2026-08', 3, { public: true, language: 'Astro', tags: ['astro', 'tailwindcss', 'mdx'] }],
  ['p2', 'orbit-api', 'project', '2023-06', '2025-04', 30, { language: 'TypeScript', tags: ['express', 'prisma', 'zod', 'stripe', 'pino'] }],
  ['p3', 'orbit-web', 'project', '2023-07', '2025-06', 24, { language: 'TypeScript', tags: ['react', 'next', 'zod', 'stripe', 'tailwindcss'] }],
  ['p4', 'orbit-mobile', 'project', '2024-02', '2025-03', 12, { language: 'Dart', tags: ['flutter'] }],
  ['p5', 'northwind-portal', 'project', '2023-10', '2024-09', 16, { language: 'TypeScript', description: 'Customer portal for Northwind', tags: ['react', 'next', 'tailwindcss', 'prisma'] }],
  ['p6', 'tinyfeed', 'project', '2024-01', '2026-10', 6, { public: true, language: 'Go', tags: ['cobra', 'sqlite'] }],
  ['p7', 'ledgerly-app', 'project', '2025-01', '2026-10', 34, { language: 'TypeScript', tags: ['react', 'next', 'prisma', 'stripe', 'zod', 'tailwindcss'] }],
  ['p8', 'ledgerly-site', 'project', '2025-03', '2026-10', 8, { language: 'Astro', tags: ['astro', 'tailwindcss', 'mdx'] }],
  ['p9', 'ledgerly-worker', 'project', '2025-06', '2026-10', 14, { language: 'Python', tags: ['celery', 'redis', 'pydantic'] }],
  ['p10', 'brightside-booking', 'project', '2025-08', '2026-06', 10, { language: 'PHP', description: 'Booking flow for Brightside Dental', tags: ['laravel', 'stripe'] }],
  ['p11', 'pixel-quest', 'project', '2024-06', '2024-11', 9, { public: true, language: 'Lua', tags: ['love2d'] }],
  ['p12', 'acme-shopify-theme', 'project', '2024-04', '2025-02', 7, { language: 'Liquid', description: 'Shopify theme for Acme Studio' }],
  ['c1', 'Northwind', 'client', '2023-09', '2024-10', 3, { domain: 'northwind.io' }],
  ['c2', 'Acme Studio', 'client', '2024-03', '2025-03', 2, { domain: 'acmestudio.co' }],
  ['c3', 'Brightside Dental', 'client', '2025-07', '2026-07', 2, { domain: 'brightside-dental.com' }],
  ['c4', 'Ledgerly', 'client', '2024-11', '2026-10', 4, { domain: 'ledgerly.com' }],
  ['c5', 'Harbour & Co', 'client', '2024-05', '2024-12', 1, { domain: 'harbourandco.com' }],
];

const items = plan.map(([id, label, kind, from, to, k, extra]) => {
  const series = {};
  for (const m of months) {
    if (m < from || m > to) continue;
    const v = Math.round(k * (0.3 + rand() * 1.4) * (rand() < 0.15 ? 0 : 1));
    if (v > 0) series[m] = v;
  }
  return { id, label, kind, ...extra, series: kind === 'client' ? { meetings: series } : { commits: series } };
});

const data = { version: 1, name: 'Sam Rivera', generated: '2026-10-28', items, links: [{ source: 'p9', target: 'p7', kind: 'mention', weight: 0.6 }] };
writeFileSync(new URL('../examples/sample.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(`Wrote examples/sample.json: ${items.length} items`);
