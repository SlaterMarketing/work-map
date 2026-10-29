// Opens examples/demo.html in Chrome and saves screenshots of the map and of video frames, then
// exports the whole video. Usage: node scripts/check.mjs <out-dir> [format]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = process.argv[2] || '.';
const format = process.argv[3] || 'vertical';
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(pathToFileURL(new URL('../examples/demo.html', import.meta.url).pathname.slice(1)).href);
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'map.png') });

const shots = await page.evaluate(async (format) => {
  const data = window.__data || null;
  const g = WorkMap.buildGraph(JSON.parse(document.querySelector('script:last-of-type').textContent.match(/mountStudio\([^,]+, (\{.*\}), \{/s)[1]));
  const v = WorkMap.createVideo(g, { format, byline: g.name, credit: 'Made with slatermarketing.co.uk/work-map' });
  const c = Object.assign(document.createElement('canvas'), { width: v.width, height: v.height });
  const ctx = c.getContext('2d');
  const at = [1, 3.5, 0.3, 0.55, 0.8, -1].map((x) => (x < 0 ? v.frames - 1 : x < 1 ? Math.round(v.frames * x) : Math.round(x * v.fps)));
  const res = { duration: v.duration, frames: v.frames, pngs: [] };
  for (const f of at) { v.draw(ctx, f); res.pngs.push(c.toDataURL('image/png')); }
  const t0 = performance.now();
  const ex = await WorkMap.exportVideo(v);
  res.export = { type: ex.type, bytes: ex.blob.size, seconds: (performance.now() - t0) / 1000 };
  return res;
}, format);
shots.pngs.forEach((d, i) => writeFileSync(join(out, `frame-${format}-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
console.log(JSON.stringify({ duration: shots.duration, frames: shots.frames, export: shots.export, errors }, null, 1));
await browser.close();
