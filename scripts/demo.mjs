// Writes examples/demo.html from examples/sample.json, to try the studio without any data of your own.
import { readFileSync, writeFileSync } from 'node:fs';
import { viewerHtml } from '../cli/html.js';

const data = JSON.parse(readFileSync(new URL('../examples/sample.json', import.meta.url), 'utf8'));
writeFileSync(new URL('../examples/demo.html', import.meta.url), viewerHtml(data, { anonymise: false }));
console.log('Wrote examples/demo.html');
