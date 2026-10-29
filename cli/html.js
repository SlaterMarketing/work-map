// The standalone HTML file: the bundled library, the data and the studio, in one file that works offline.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function viewerHtml(data, { anonymise = true } = {}) {
  const bundle = join(here, '..', 'dist', 'work-map.js');
  if (!existsSync(bundle)) throw new Error('dist/work-map.js is missing. Run npm run build in the work-map folder.');
  return readFileSync(join(here, 'viewer.html'), 'utf8')
    .replace('/*__BUNDLE__*/', () => readFileSync(bundle, 'utf8').replace(/<\/script/gi, '<\/script'))
    .replace('/*__DATA__*/null', () => JSON.stringify(data).replace(/</g, '\u003c'))
    .replace('/*__ANON__*/true', String(anonymise));
}
