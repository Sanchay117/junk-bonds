// Prints where each scene starts and how long it runs, in frames and seconds.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT } from '../src/script.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'public/vo/manifest.json'), 'utf8'));
let at = 0;
for (const line of SCRIPT) {
  const take = manifest.lines[line.id];
  const frames = Math.round(((line.lead ?? 0.5) + take.seconds + (line.tail ?? 0.8)) * 30);
  console.log(line.id.padEnd(6) + String(at).padStart(6) + String(frames).padStart(5) + '  ' + (at / 30).toFixed(1) + 's');
  at += frames;
}
console.log('total ' + at + ' frames, ' + (at / 30).toFixed(1) + 's');
