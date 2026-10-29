// Writes examples/demo.html from examples/sample.json, to try the studio without any data of your own.
import { readFileSync, writeFileSync } from 'node:fs';
import { viewerHtml } from '../cli/html.js';

const file = process.argv[2] || 'sample.json';
const data = JSON.parse(readFileSync(new URL('../examples/' + file, import.meta.url), 'utf8'));
writeFileSync(new URL('../examples/' + file.replace('.json', '') + '-demo.html', import.meta.url), viewerHtml(data, { anonymise: false }));
console.log('Wrote demo for ' + file);
