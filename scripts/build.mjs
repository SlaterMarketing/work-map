// Bundles the library for the CLI's HTML file and for <script> tags: dist/work-map.js (window.WorkMap).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'WorkMap',
  target: ['chrome110', 'safari16', 'firefox115'],
  outfile: 'dist/work-map.js',
  legalComments: 'none',
});
console.log('Built dist/work-map.js');
